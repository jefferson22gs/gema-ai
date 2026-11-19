import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createRule, nextScheduledRun, runDueAutomations } from "@/server/automations/engine";
import { dispatchOutbox, inQuietHours } from "@/server/notifications/dispatcher";
import { dispatchDueReminders } from "@/server/services/reminders";
import { buildBriefing } from "@/server/services/briefing";
import { zonedToUtc } from "@/lib/time";
import { asUser, createTestDb, createUser } from "../db/harness";
import { pgliteDatabase } from "../support/pglite-db";

let pg: PGlite;
let db: Database;
let alice: { id: string; personalWorkspaceId: string };
let bob: { id: string; personalWorkspaceId: string };

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  alice = await createUser(pg, "alice@auto.test");
  bob = await createUser(pg, "bob@auto.test");
});

describe("briefing (critério 9)", () => {
  it("sem dados: identifica lacunas e não inventa números", async () => {
    const now = new Date("2026-11-19T10:00:00Z");
    const b = await db.asUser(alice.id, (q) => buildBriefing({ q, ctx: { userId: alice.id, workspaceId: alice.personalWorkspaceId, timezone: "America/Sao_Paulo", now, channel: "dashboard" } }));
    expect(b.kpis).toEqual({ eventsToday: 0, openTasks: 0, monthExpenseCents: 0, billsDueCount: 0 });
    expect(b.gaps).toContain("Nenhum lançamento financeiro neste mês.");
    expect(b.facts).toEqual([]);
  });

  it("agrega apenas dados autorizados (não vê dados de outro tenant)", async () => {
    await asUser(pg, bob.id, (tx) =>
      tx.query("insert into transactions (workspace_id, owner_id, kind, description, amount_cents, occurred_on) values ($1, $2, 'expense', 'Secreto', 99900, '2026-11-10')", [bob.personalWorkspaceId, bob.id]),
    );
    await asUser(pg, alice.id, (tx) =>
      tx.query("insert into transactions (workspace_id, owner_id, kind, description, amount_cents, occurred_on, status, due_on) values ($1, $2, 'expense', 'Luz', 15000, '2026-11-18', 'pending', '2026-11-21')", [alice.personalWorkspaceId, alice.id]),
    );
    const now = new Date("2026-11-19T10:00:00Z");
    // Mesmo tentando ler o workspace de Bob com o ator Alice, RLS retorna vazio.
    const leak = await db.asUser(alice.id, (q) => buildBriefing({ q, ctx: { userId: alice.id, workspaceId: bob.personalWorkspaceId, timezone: "America/Sao_Paulo", now, channel: "dashboard" } }));
    expect(leak.month.expenseCents).toBe(0);
    const own = await db.asUser(alice.id, (q) => buildBriefing({ q, ctx: { userId: alice.id, workspaceId: alice.personalWorkspaceId, timezone: "America/Sao_Paulo", now, channel: "dashboard" } }));
    expect(own.month.expenseCents).toBe(15000);
    expect(own.kpis.billsDueCount).toBe(1);
  });
});

describe("lembrete recorrente (critério 10)", () => {
  it("gera uma notificação por ocorrência, mesmo com o job rodando duas vezes, e respeita DST", async () => {
    const tz = "America/New_York";
    await pg.query("update profiles set timezone = $2 where id = $1", [alice.id, tz]);
    const first = zonedToUtc("2026-03-07", "07:00", tz);
    await asUser(pg, alice.id, (tx) =>
      tx.query(
        "insert into reminders (workspace_id, owner_id, title, remind_at, timezone, recurrence, local_time) values ($1, $2, 'Remédio', $3, $4, 'daily', '07:00')",
        [alice.personalWorkspaceId, alice.id, first, tz],
      ),
    );
    const t1 = new Date("2026-03-07T12:05:00Z");
    expect(await db.asService((q) => dispatchDueReminders(q, t1))).toEqual({ fired: 1, skipped: 0 });
    expect(await db.asService((q) => dispatchDueReminders(q, t1))).toEqual({ fired: 0, skipped: 0 });
    const [{ remind_at }] = (await pg.query<{ remind_at: Date }>("select remind_at from reminders where title = 'Remédio'")).rows;
    expect(remind_at.toISOString()).toBe("2026-03-08T11:00:00.000Z"); // 07:00 EDT
    const t2 = new Date("2026-03-08T11:01:00Z");
    expect(await db.asService((q) => dispatchDueReminders(q, t2))).toEqual({ fired: 1, skipped: 0 });
    const keys = (await pg.query<{ dedupe_key: string }>("select dedupe_key from notification_outbox where kind = 'reminder' order by created_at")).rows.map((r) => r.dedupe_key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    await pg.query("update profiles set timezone = 'America/Sao_Paulo' where id = $1", [alice.id]);
  });
});

describe("automações", () => {
  it("briefing diário às 07:00 local roda uma vez por dia", async () => {
    const tz = "America/Sao_Paulo";
    const now = new Date("2026-11-19T09:00:00Z"); // 06:00 SP
    await db.asUser(alice.id, (q) => createRule(q, { workspaceId: alice.personalWorkspaceId, ownerId: alice.id, template: "daily_briefing", channels: ["dashboard"], timezone: tz, now }));
    const [{ next_run_at }] = (await pg.query<{ next_run_at: Date }>("select next_run_at from automation_rules where template = 'daily_briefing'")).rows;
    expect(next_run_at.toISOString()).toBe("2026-11-19T10:00:00.000Z");

    const at = new Date("2026-11-19T10:00:30Z");
    expect(await runDueAutomations(db, at)).toEqual({ ran: 1, skipped: 0, failed: 0 });
    expect(await runDueAutomations(db, at)).toEqual({ ran: 0, skipped: 0, failed: 0 }); // não está mais vencida
    const outbox = await pg.query("select 1 from notification_outbox where kind = 'briefing'");
    expect(outbox.rows).toHaveLength(1);
  });

  it("resumo semanal agenda para o dia da semana configurado", () => {
    const next = nextScheduledRun({ template: "weekly_summary", config: { time: "18:00", weekday: 0 } }, "America/Sao_Paulo", new Date("2026-11-19T15:00:00Z"));
    expect(next.toISOString()).toBe("2026-11-22T21:00:00.000Z"); // domingo 18:00 SP
  });
});

describe("dispatcher de notificações", () => {
  it("quiet hours atravessando a meia-noite", () => {
    expect(inQuietHours(new Date("2026-11-20T02:00:00Z"), "America/Sao_Paulo", "22:00", "07:00")).toBe(true); // 23:00
    expect(inQuietHours(new Date("2026-11-19T15:00:00Z"), "America/Sao_Paulo", "22:00", "07:00")).toBe(false);
  });

  it("falha no WhatsApp faz fallback para e-mail sem duplicar; retries não reenviam", async () => {
    await pg.query("update user_preferences set quiet_hours_start = null, quiet_hours_end = null where user_id = $1", [bob.id]);
    await pg.query("insert into channel_accounts (workspace_id, user_id, provider, address, status, verified_at, opted_in_at) values ($1, $2, 'evolution', '+5511900001111', 'verified', now(), now())", [bob.personalWorkspaceId, bob.id]);
    await pg.query("update user_preferences set channels = '{\"email\": true, \"whatsapp\": true, \"push\": false, \"dashboard\": true}' where user_id = $1", [bob.id]);
    await pg.query("update notification_outbox set status = 'sent'");
    await pg.query(
      "insert into notification_outbox (workspace_id, user_id, kind, title, body, channels, dedupe_key, next_attempt_at) values ($1, $2, 'reminder', 'Lembrete', 'Pagar boleto', '{dashboard,whatsapp}', 'k-1', '2026-11-19T14:00:00Z')",
      [bob.personalWorkspaceId, bob.id],
    );

    const emails: string[] = [];
    const deps = {
      db,
      now: new Date("2026-11-19T15:00:00Z"),
      sendEmail: async (req: { to: string; eventKey: string }) => {
        emails.push(`${req.to}|${req.eventKey}`);
        return { status: "accepted" as const, provider: "resend", providerMessageId: "re_1", attempts: [] };
      },
      whatsapp: {
        name: "evolution" as const,
        sendText: async () => ({ ok: false, error: "instância desconectada" }),
      } as never,
      sendPush: null,
    };
    const r = await dispatchOutbox(deps);
    expect(r.processed).toBe(1);
    expect(emails).toEqual(["bob@auto.test|k-1"]);
    const deliveries = (await pg.query<{ channel: string; status: string }>("select channel, status from notification_deliveries order by created_at")).rows;
    expect(deliveries).toEqual([
      { channel: "dashboard", status: "delivered" },
      { channel: "whatsapp", status: "failed" },
      { channel: "email", status: "accepted" },
    ]);
    const [{ status }] = (await pg.query<{ status: string }>("select status from notification_outbox where dedupe_key = 'k-1'")).rows;
    expect(status).toBe("partial");
    await dispatchOutbox(deps);
    expect(emails).toHaveLength(1);
  });
});
