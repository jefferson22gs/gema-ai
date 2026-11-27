import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import type { ActorContext } from "@/server/context";
import { bookPublic, cancelPublic, listBookingPages, listUpcomingBookings, publicAvailability, saveBookingPage } from "@/server/services/booking";
import { asAnon, asUser, createTestDb, createUser } from "./harness";
import { pgliteDatabase } from "../support/pglite-db";

let pg: PGlite;
let db: Database;
let ana: { id: string; personalWorkspaceId: string };
let beto: { id: string; personalWorkspaceId: string };
const ctx = (u: { id: string; personalWorkspaceId: string }): ActorContext => ({ userId: u.id, workspaceId: u.personalWorkspaceId, timezone: "America/Sao_Paulo", now: new Date(), channel: "dashboard" });

/** Próxima segunda-feira às 10:00 de São Paulo (sempre no futuro e dentro da janela). */
function nextMonday10(): Date {
  const d = new Date();
  const add = ((8 - d.getUTCDay()) % 7) || 7;
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add, 13, 0, 0));
  return m;
}
const ALL_WEEK = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [["08:00", "18:00"]]]));
const page = { slug: "ana-consultoria", title: "Conversa de 30 min", durationMinutes: 30, bufferMinutes: 0, minNoticeHours: 1, maxDaysAhead: 14, timezone: "America/Sao_Paulo", weeklyHours: ALL_WEEK, active: true };

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  ana = await createUser(pg, "ana@agenda.test");
  beto = await createUser(pg, "beto@agenda.test");
  await pg.query("update profiles set full_name = 'Ana Souza' where id = $1", [ana.id]);
});

describe("página pública de agendamento (AG-02)", () => {
  it("cria página com validação; endereço único; reservados recusados", async () => {
    await expect(db.asUser(ana.id, (q) => saveBookingPage({ q, ctx: ctx(ana) }, { ...page, slug: "A b" }))).rejects.toThrow(/Endereço inválido/);
    await expect(db.asUser(ana.id, (q) => saveBookingPage({ q, ctx: ctx(ana) }, { ...page, slug: "admin" }))).rejects.toThrow(/Endereço inválido/);
    await expect(db.asUser(ana.id, (q) => saveBookingPage({ q, ctx: ctx(ana) }, { ...page, weeklyHours: {} }))).rejects.toThrow(/ao menos um dia/);
    await expect(db.asUser(ana.id, (q) => saveBookingPage({ q, ctx: ctx(ana) }, { ...page, timezone: "Lua/Base" }))).rejects.toThrow(/Fuso/);
    await db.asUser(ana.id, (q) => saveBookingPage({ q, ctx: ctx(ana) }, page));
    await expect(db.asUser(beto.id, (q) => saveBookingPage({ q, ctx: ctx(beto) }, page))).rejects.toThrow(/já está em uso/);
    expect(await db.asUser(beto.id, (q) => listBookingPages({ q, ctx: ctx(beto) }))).toEqual([]);
  });

  it("visitante vê só horários livres; compromissos do dono bloqueiam sem expor título", async () => {
    const start = nextMonday10();
    await asUser(pg, ana.id, (tx) => tx.query(
      "insert into calendar_events (workspace_id, owner_id, title, description, starts_at, ends_at) values ($1, $2, 'Consulta médica sigilosa', 'detalhes', $3, $4)",
      [ana.personalWorkspaceId, ana.id, start, new Date(start.getTime() + 3_600_000)],
    ));
    const av = await db.asAnon((q) => publicAvailability(q, "ana-consultoria", new Date()));
    expect(av?.page.hostName).toBe("Ana");
    const all = av!.days.flatMap((d) => d.slots.map((s) => s.getTime()));
    expect(all).not.toContain(start.getTime());
    expect(all).not.toContain(start.getTime() + 30 * 60_000);
    expect(all).toContain(start.getTime() + 60 * 60_000);
    const busy = await asAnon(pg, (tx) => tx.query("select * from public.booking_busy_public('ana-consultoria', now(), now() + interval '20 days')"));
    expect(JSON.stringify(busy.rows)).not.toMatch(/sigilosa|detalhes/);
    expect(Object.keys(busy.rows[0] as object).sort()).toEqual(["ends_at", "starts_at"]);
    // Tabelas diretamente: nada para o anônimo.
    await expect(asAnon(pg, (tx) => tx.query("select * from booking_pages"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(pg, (tx) => tx.query("select * from calendar_events"))).rejects.toThrow();
    expect(await db.asAnon((q) => publicAvailability(q, "nao-existe", new Date()))).toBeNull();
  });

  it("reserva cria evento, notifica o dono e é idempotente pela chave do cliente", async () => {
    const slot = new Date(nextMonday10().getTime() + 2 * 3_600_000); // 12:00
    const req = { slug: "ana-consultoria", startsAt: slot.toISOString(), name: " Carla  Dias ", email: "Carla@Ex.com", note: "Sobre o projeto", clientKey: "form-abc12345" };
    const r1 = await bookPublic(db, req, new Date());
    expect(r1).toMatchObject({ created: true });
    expect(r1.cancelToken).toBeTruthy();
    const r2 = await bookPublic(db, req, new Date());
    expect(r2).toMatchObject({ bookingId: r1.bookingId, created: false, cancelToken: null });
    const [ev] = (await pg.query<{ title: string; owner_id: string }>("select e.title, e.owner_id from bookings b join calendar_events e on e.id = b.calendar_event_id where b.id = $1", [r1.bookingId])).rows;
    expect(ev).toEqual({ title: "Agendamento: Carla Dias", owner_id: ana.id });
    const [n] = (await pg.query<{ n: number }>("select count(*)::int as n from notification_outbox where user_id = $1 and kind = 'booking.created'", [ana.id])).rows;
    expect(n.n).toBe(1);
    const mine = await db.asUser(ana.id, (q) => listUpcomingBookings({ q, ctx: ctx(ana) }));
    expect(mine[0]).toMatchObject({ guest_email: "carla@ex.com", guest_name: "Carla Dias" });
    expect(await db.asUser(beto.id, (q) => listUpcomingBookings({ q, ctx: ctx(beto) }))).toEqual([]);
  });

  it("duas reservas concorrentes no mesmo horário: só uma vence", async () => {
    const slot = new Date(nextMonday10().getTime() + 4 * 3_600_000); // 14:00
    const results = await Promise.allSettled(["k1", "k2", "k3"].map((k) =>
      bookPublic(db, { slug: "ana-consultoria", startsAt: slot.toISOString(), name: `Pessoa ${k}`, email: `${k}@ex.com`, clientKey: `concorrente-${k}` }, new Date())));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.every((r) => /acabou de ser reservado/.test(String(r.reason)))).toBe(true);
    const [c] = (await pg.query<{ n: number }>("select count(*)::int as n from bookings where starts_at = $1 and status = 'confirmed'", [slot])).rows;
    expect(c.n).toBe(1);
  });

  it("recusa horário fora da grade, passado, sobreposto parcialmente e dados inválidos", async () => {
    const base = nextMonday10();
    const book = (startsAt: Date, extra = {}) => bookPublic(db, { slug: "ana-consultoria", startsAt: startsAt.toISOString(), name: "Zé Silva", email: "ze@ex.com", clientKey: `k-${startsAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`, ...extra }, new Date());
    await expect(book(new Date(base.getTime() + 7 * 60_000))).rejects.toThrow(/não é oferecido/);
    await expect(book(new Date(base.getTime() + 11 * 3_600_000))).rejects.toThrow(/não é oferecido/); // 21:00
    await expect(book(new Date(Date.now() - 86_400_000))).rejects.toThrow();
    await expect(book(new Date(base.getTime() + 30 * 60_000))).rejects.toThrow(/acabou de ser reservado/); // 10:30, colide com o compromisso
    await expect(book(new Date(base.getTime() + 5 * 3_600_000), { email: "sem-arroba" })).rejects.toThrow(/E-mail/);
    await expect(book(new Date(base.getTime() + 5 * 3_600_000), { name: "x" })).rejects.toThrow(/nome/);
  });

  it("cancelamento pelo token libera o horário; token errado não cancela; página inativa some", async () => {
    const slot = new Date(nextMonday10().getTime() + 6 * 3_600_000); // 16:00
    const r = await bookPublic(db, { slug: "ana-consultoria", startsAt: slot.toISOString(), name: "Davi Lima", email: "davi@ex.com", clientKey: "cancelar-0001" }, new Date());
    expect(await cancelPublic(db, "x".repeat(32))).toBe(false);
    expect(await cancelPublic(db, r.cancelToken!)).toBe(true);
    expect(await cancelPublic(db, r.cancelToken!)).toBe(false);
    const [ev] = (await pg.query<{ status: string }>("select e.status from bookings b join calendar_events e on e.id = b.calendar_event_id where b.id = $1", [r.bookingId])).rows;
    expect(ev.status).toBe("cancelled");
    const again = await bookPublic(db, { slug: "ana-consultoria", startsAt: slot.toISOString(), name: "Eva Reis", email: "eva@ex.com", clientKey: "cancelar-0002" }, new Date());
    expect(again.created).toBe(true);
    const [p] = await db.asUser(ana.id, (q) => listBookingPages({ q, ctx: ctx(ana) }));
    await db.asUser(ana.id, (q) => saveBookingPage({ q, ctx: ctx(ana) }, { ...page, active: false }, p.id));
    expect(await db.asAnon((q) => publicAvailability(q, "ana-consultoria", new Date()))).toBeNull();
    await expect(bookPublic(db, { slug: "ana-consultoria", startsAt: slot.toISOString(), name: "Fê Lopes", email: "fe@ex.com", clientKey: "inativa-0001" }, new Date())).rejects.toThrow(/indisponível/);
  });
});
