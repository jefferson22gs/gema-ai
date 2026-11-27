import { randomToken, sha256Hex } from "@/lib/crypto";
import type { Database, Queryable } from "@/lib/db/types";
import { addDaysToDateString, isValidTimezone, localDateString, zonedToUtc } from "@/lib/time";
import { DomainError, type ServiceDeps } from "../context";
import { availableSlots, isOfferedSlot, parseWeeklyHours, type BookingRules, type WeeklyHours } from "../booking/slots";

export interface BookingPageRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  min_notice_hours: number;
  max_days_ahead: number;
  timezone: string;
  weekly_hours: WeeklyHours;
  active: boolean;
}

export interface BookingPageInput {
  slug: string;
  title: string;
  description?: string | null;
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  timezone: string;
  weeklyHours: unknown;
  active: boolean;
}

const RESERVED = new Set(["admin", "api", "app", "agenda", "gema", "suporte", "login", "cadastro", "planos", "demo"]);

export async function listBookingPages({ q, ctx }: ServiceDeps): Promise<BookingPageRow[]> {
  return q.query<BookingPageRow>(
    `select id, slug, title, description, duration_minutes, buffer_minutes, min_notice_hours, max_days_ahead, timezone, weekly_hours, active
     from booking_pages where workspace_id = $1 and owner_id = $2 order by created_at`,
    [ctx.workspaceId, ctx.userId],
  );
}

/** Cria ou atualiza (pelo id) a página do usuário. Slug único global, validado também no banco. */
export async function saveBookingPage(deps: ServiceDeps, input: BookingPageInput, id?: string): Promise<string> {
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug) || RESERVED.has(slug)) throw new DomainError("invalid", "Endereço inválido: use 3 a 40 letras minúsculas, números ou hífen.");
  if (!input.title.trim() || input.title.trim().length > 80) throw new DomainError("invalid", "Título obrigatório (até 80 caracteres).");
  if (!isValidTimezone(input.timezone)) throw new DomainError("invalid", "Fuso horário inválido.");
  let weekly: WeeklyHours;
  try {
    weekly = parseWeeklyHours(input.weeklyHours);
  } catch (e) {
    throw new DomainError("invalid", e instanceof Error ? e.message : "Grade inválida.");
  }
  if (!Object.keys(weekly).length) throw new DomainError("invalid", "Defina ao menos um dia com horário disponível.");
  const vals = [input.title.trim(), input.description?.trim() || null, input.durationMinutes, input.bufferMinutes, input.minNoticeHours, input.maxDaysAhead, input.timezone, JSON.stringify(weekly), input.active, slug];
  try {
    if (id) {
      const rows = await deps.q.query<{ id: string }>(
        `update booking_pages set title = $1, description = $2, duration_minutes = $3, buffer_minutes = $4, min_notice_hours = $5,
           max_days_ahead = $6, timezone = $7, weekly_hours = $8, active = $9, slug = $10 where id = $11 and owner_id = $12 returning id`,
        [...vals, id, deps.ctx.userId],
      );
      if (!rows.length) throw new DomainError("not_found", "Página não encontrada.");
      return rows[0].id;
    }
    const [row] = await deps.q.query<{ id: string }>(
      `insert into booking_pages (title, description, duration_minutes, buffer_minutes, min_notice_hours, max_days_ahead, timezone, weekly_hours, active, slug, workspace_id, owner_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [...vals, deps.ctx.workspaceId, deps.ctx.userId],
    );
    return row.id;
  } catch (e) {
    if (e instanceof DomainError) throw e;
    const msg = e instanceof Error ? e.message : "";
    if (/booking_pages_slug_key|duplicate key/.test(msg)) throw new DomainError("conflict", "Este endereço já está em uso. Escolha outro.");
    if (/check constraint/.test(msg)) throw new DomainError("invalid", "Valores fora dos limites permitidos.");
    throw e;
  }
}

export async function listUpcomingBookings({ q, ctx }: ServiceDeps) {
  return q.query<{ id: string; page_title: string; starts_at: Date; guest_name: string; guest_email: string; guest_note: string | null; status: string }>(
    `select b.id, p.title as page_title, b.starts_at, b.guest_name, b.guest_email, b.guest_note, b.status from bookings b
     join booking_pages p on p.id = b.page_id where b.owner_id = $1 and b.workspace_id = $2 and b.starts_at > now() - interval '1 day'
     order by b.starts_at limit 100`,
    [ctx.userId, ctx.workspaceId],
  );
}

// ---------------------------------------------------------------- Público (anônimo)

export interface PublicPage {
  title: string;
  description: string | null;
  hostName: string;
  rules: BookingRules;
}

export async function getPublicPage(q: Queryable, slug: string): Promise<PublicPage | null> {
  const [p] = await q.query<{ title: string; description: string | null; duration_minutes: number; buffer_minutes: number; min_notice_hours: number; max_days_ahead: number; timezone: string; weekly_hours: WeeklyHours; host_name: string }>(
    "select * from public.booking_page_public($1)", [slug],
  );
  if (!p) return null;
  return {
    title: p.title,
    description: p.description,
    hostName: p.host_name,
    rules: { durationMinutes: p.duration_minutes, bufferMinutes: p.buffer_minutes, minNoticeHours: p.min_notice_hours, maxDaysAhead: p.max_days_ahead, timezone: p.timezone, weeklyHours: p.weekly_hours },
  };
}

export async function publicAvailability(q: Queryable, slug: string, now: Date) {
  const page = await getPublicPage(q, slug);
  if (!page) return null;
  const today = localDateString(now, page.rules.timezone);
  const to = zonedToUtc(addDaysToDateString(today, Math.min(page.rules.maxDaysAhead, 60) + 1), "00:00", page.rules.timezone);
  const busy = await q.query<{ starts_at: Date; ends_at: Date }>("select * from public.booking_busy_public($1, $2, $3)", [slug, now, to]);
  return { page, days: availableSlots(page.rules, busy.map((b) => ({ start: new Date(b.starts_at), end: new Date(b.ends_at) })), now) };
}

export interface BookingRequest {
  slug: string;
  startsAt: string;
  name: string;
  email: string;
  note?: string;
  clientKey: string;
}

/**
 * Reserva pública. O servidor checa a grade (horário oferecido de verdade) e o banco garante, sob lock,
 * janela e ausência de sobreposição — duas pessoas clicando no mesmo horário: só uma reserva.
 * Retorna o token de cancelamento em claro UMA vez (guardado só o hash).
 */
export async function bookPublic(db: Database, req: BookingRequest, now: Date) {
  const name = req.name.trim().replace(/\s+/g, " ");
  const email = req.email.trim().toLowerCase();
  if (name.length < 2 || name.length > 120) throw new DomainError("invalid", "Informe seu nome.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) throw new DomainError("invalid", "E-mail inválido.");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(req.clientKey)) throw new DomainError("invalid", "Requisição inválida.");
  const start = new Date(req.startsAt);
  if (Number.isNaN(start.getTime())) throw new DomainError("invalid", "Horário inválido.");
  const page = await db.asAnon((q) => getPublicPage(q, req.slug));
  if (!page) throw new DomainError("not_found", "Página de agendamento indisponível.");
  if (!isOfferedSlot(page.rules, start)) throw new DomainError("invalid", "Este horário não é oferecido nesta agenda.");
  if (start.getTime() < now.getTime() + page.rules.minNoticeHours * 3_600_000) throw new DomainError("invalid", "Horário muito próximo. Escolha outro.");
  const token = randomToken(24);
  try {
    const [r] = await db.asAnon((q) => q.query<{ booking_id: string; created: boolean }>(
      "select * from public.book_slot($1, $2, $3, $4, $5, $6, $7)",
      [req.slug, start, name, email, req.note?.trim().slice(0, 500) || null, sha256Hex(token), req.clientKey],
    ));
    return { bookingId: r.booking_id, created: r.created, cancelToken: r.created ? token : null, startsAt: start, page };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/indisponível|23P01/.test(msg) && !/página/.test(msg)) throw new DomainError("conflict", "Este horário acabou de ser reservado. Escolha outro.");
    if (/janela/.test(msg)) throw new DomainError("invalid", "Horário fora da janela de agendamento.");
    if (/página indisponível/.test(msg)) throw new DomainError("not_found", "Página de agendamento indisponível.");
    throw e;
  }
}

export async function cancelPublic(db: Database, token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return false;
  const [r] = await db.asAnon((q) => q.query<{ ok: boolean }>("select public.cancel_booking($1) as ok", [sha256Hex(token)]));
  return r.ok;
}
