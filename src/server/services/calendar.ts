import { DomainError, type ServiceDeps } from "../context";

export interface CalendarEventRow {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: Date;
  ends_at: Date;
  all_day: boolean;
  timezone: string;
  status: "tentative" | "confirmed" | "cancelled";
  source: string;
  external_provider: string | null;
  external_id: string | null;
  sync_status: string;
  visibility: "private" | "workspace";
  attendees: { name?: string; email?: string }[];
}

const COLUMNS = `id, title, description, location, starts_at, ends_at, all_day, timezone, status, source,
  external_provider, external_id, sync_status, visibility, attendees`;

export async function listEvents({ q, ctx }: ServiceDeps, from: Date, to: Date): Promise<CalendarEventRow[]> {
  return q.query<CalendarEventRow>(
    `select ${COLUMNS} from calendar_events
     where workspace_id = $1 and status <> 'cancelled' and starts_at < $3 and ends_at > $2
     order by starts_at`,
    [ctx.workspaceId, from, to],
  );
}

export async function findConflicts({ q, ctx }: ServiceDeps, start: Date, end: Date, excludeId?: string): Promise<CalendarEventRow[]> {
  return q.query<CalendarEventRow>(
    `select ${COLUMNS} from calendar_events
     where workspace_id = $1 and status <> 'cancelled' and starts_at < $3 and ends_at > $2
       and ($4::uuid is null or id <> $4)
     order by starts_at`,
    [ctx.workspaceId, start, end, excludeId ?? null],
  );
}

/** Horários livres no intervalo, considerando eventos existentes (granularidade em minutos). */
export async function freeSlots(deps: ServiceDeps, from: Date, to: Date, minMinutes = 30): Promise<{ start: Date; end: Date }[]> {
  const busy = await listEvents(deps, from, to);
  const slots: { start: Date; end: Date }[] = [];
  let cursor = from.getTime();
  for (const ev of busy) {
    const s = new Date(ev.starts_at).getTime();
    const e = new Date(ev.ends_at).getTime();
    if (s - cursor >= minMinutes * 60_000) slots.push({ start: new Date(cursor), end: new Date(s) });
    cursor = Math.max(cursor, e);
  }
  if (to.getTime() - cursor >= minMinutes * 60_000) slots.push({ start: new Date(cursor), end: to });
  return slots;
}

export interface EventInput {
  title: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  description?: string;
  location?: string;
  attendees?: { name?: string; email?: string }[];
  visibility?: "private" | "workspace";
  source?: "local" | "ai" | "google";
  /** Permite criar mesmo com conflito (somente após confirmação explícita do usuário). */
  allowConflict?: boolean;
  idempotencyKey?: string;
}

export class ConflictError extends DomainError {
  constructor(public readonly conflicts: CalendarEventRow[]) {
    super("conflict", `Conflito com ${conflicts.length} compromisso(s).`, conflicts.map((c) => ({ id: c.id, title: c.title, starts_at: c.starts_at })));
  }
}

/** Cria evento local. Conflitos NUNCA são ignorados silenciosamente. */
export async function createEvent(deps: ServiceDeps, input: EventInput): Promise<{ event: CalendarEventRow; created: boolean }> {
  if (!(input.endsAt > input.startsAt)) throw new DomainError("invalid", "O término deve ser após o início.");
  if (!input.allowConflict) {
    const conflicts = await findConflicts(deps, input.startsAt, input.endsAt);
    if (conflicts.length > 0) throw new ConflictError(conflicts);
  }
  const rows = await deps.q.query<{ id: string }>(
    `insert into calendar_events (workspace_id, owner_id, visibility, title, description, location, starts_at, ends_at, timezone, attendees, source, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (workspace_id, idempotency_key) do nothing returning id`,
    [
      deps.ctx.workspaceId, deps.ctx.userId, input.visibility ?? "private", input.title.trim(), input.description ?? null, input.location ?? null,
      input.startsAt, input.endsAt, input.timezone, JSON.stringify(input.attendees ?? []), input.source ?? "local", input.idempotencyKey ?? null,
    ],
  );
  const created = rows.length > 0;
  const id = created
    ? rows[0].id
    : (await deps.q.query<{ id: string }>("select id from calendar_events where workspace_id = $1 and idempotency_key = $2", [deps.ctx.workspaceId, input.idempotencyKey]))[0]?.id;
  const event = await getEvent(deps, id!);
  if (!event) throw new DomainError("not_found", "Evento não encontrado após criação.");
  return { event, created };
}

export async function getEvent({ q, ctx }: ServiceDeps, id: string): Promise<CalendarEventRow | null> {
  const rows = await q.query<CalendarEventRow>(`select ${COLUMNS} from calendar_events where id = $1 and workspace_id = $2`, [id, ctx.workspaceId]);
  return rows[0] ?? null;
}

export async function updateEvent(
  deps: ServiceDeps,
  id: string,
  patch: { title?: string; startsAt?: Date; endsAt?: Date; location?: string | null; description?: string | null; allowConflict?: boolean },
): Promise<CalendarEventRow> {
  const current = await getEvent(deps, id);
  if (!current) throw new DomainError("not_found", "Compromisso não encontrado.");
  const start = patch.startsAt ?? new Date(current.starts_at);
  const end = patch.endsAt ?? (patch.startsAt ? new Date(start.getTime() + (new Date(current.ends_at).getTime() - new Date(current.starts_at).getTime())) : new Date(current.ends_at));
  if (!(end > start)) throw new DomainError("invalid", "O término deve ser após o início.");
  if (!patch.allowConflict && (patch.startsAt || patch.endsAt)) {
    const conflicts = await findConflicts(deps, start, end, id);
    if (conflicts.length) throw new ConflictError(conflicts);
  }
  const rows = await deps.q.query<{ id: string }>(
    `update calendar_events set title = $3, starts_at = $4, ends_at = $5, location = $6, description = $7,
       sync_status = case when external_id is not null then 'pending_push' else sync_status end
     where id = $1 and workspace_id = $2 returning id`,
    [id, deps.ctx.workspaceId, patch.title ?? current.title, start, end,
      patch.location === undefined ? current.location : patch.location,
      patch.description === undefined ? current.description : patch.description],
  );
  if (!rows.length) throw new DomainError("forbidden", "Sem permissão para alterar este compromisso.");
  return (await getEvent(deps, id))!;
}

export async function cancelEvent(deps: ServiceDeps, id: string): Promise<CalendarEventRow> {
  const rows = await deps.q.query<{ id: string }>(
    `update calendar_events set status = 'cancelled',
       sync_status = case when external_id is not null then 'pending_push' else sync_status end
     where id = $1 and workspace_id = $2 and status <> 'cancelled' returning id`,
    [id, deps.ctx.workspaceId],
  );
  if (!rows.length) throw new DomainError("not_found", "Compromisso não encontrado ou já cancelado.");
  return (await getEvent(deps, id))!;
}

export async function markEventSynced({ q, ctx }: ServiceDeps, id: string, provider: string, externalId: string, etag?: string) {
  await q.query(
    `update calendar_events set external_provider = $3, external_id = $4, external_etag = $5, sync_status = 'synced', sync_error = null
     where id = $1 and workspace_id = $2`,
    [id, ctx.workspaceId, provider, externalId, etag ?? null],
  );
}

export async function markEventSyncError({ q, ctx }: ServiceDeps, id: string, error: string) {
  await q.query("update calendar_events set sync_status = 'error', sync_error = $3 where id = $1 and workspace_id = $2", [id, ctx.workspaceId, error.slice(0, 500)]);
}
