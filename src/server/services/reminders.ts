import { nextOccurrence, type Recurrence } from "@/lib/time";
import { DomainError, type ServiceDeps } from "../context";
import type { Queryable } from "@/lib/db/types";

export interface ReminderRow {
  id: string;
  title: string;
  remind_at: Date;
  timezone: string;
  recurrence: Recurrence | null;
  local_time: string | null;
  channels: string[];
  active: boolean;
  last_fired_at: Date | null;
}

const COLUMNS = "id, title, remind_at, timezone, recurrence, local_time, channels, active, last_fired_at";

export async function createReminder(
  deps: ServiceDeps,
  input: { title: string; remindAt: Date; recurrence?: Recurrence; channels?: string[]; idempotencyKey?: string },
): Promise<{ reminder: ReminderRow; created: boolean }> {
  const title = input.title.trim();
  if (!title) throw new DomainError("invalid", "Título obrigatório.");
  if (!input.recurrence && input.remindAt.getTime() <= deps.ctx.now.getTime()) throw new DomainError("invalid", "O horário do lembrete já passou.");
  const localTime = input.recurrence
    ? new Intl.DateTimeFormat("en-GB", { timeZone: deps.ctx.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(input.remindAt)
    : null;
  const rows = await deps.q.query<{ id: string }>(
    `insert into reminders (workspace_id, owner_id, title, remind_at, timezone, recurrence, local_time, channels, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (workspace_id, idempotency_key) do nothing returning id`,
    [deps.ctx.workspaceId, deps.ctx.userId, title, input.remindAt, deps.ctx.timezone, input.recurrence ?? null, localTime,
      input.channels ?? ["dashboard"], input.idempotencyKey ?? null],
  );
  const created = rows.length > 0;
  const id = created
    ? rows[0].id
    : (await deps.q.query<{ id: string }>("select id from reminders where workspace_id = $1 and idempotency_key = $2", [deps.ctx.workspaceId, input.idempotencyKey]))[0]?.id;
  const [reminder] = await deps.q.query<ReminderRow>(`select ${COLUMNS} from reminders where id = $1`, [id]);
  return { reminder, created };
}

export async function listReminders({ q, ctx }: ServiceDeps, onlyActive = true): Promise<ReminderRow[]> {
  return q.query<ReminderRow>(
    `select ${COLUMNS} from reminders where workspace_id = $1 and ($2 = false or active) order by remind_at limit 200`,
    [ctx.workspaceId, onlyActive],
  );
}

export async function deactivateReminder({ q, ctx }: ServiceDeps, id: string) {
  await q.query("update reminders set active = false where id = $1 and workspace_id = $2", [id, ctx.workspaceId]);
}

/**
 * Processa lembretes vencidos (service role). Cada ocorrência gera exatamente uma notificação
 * (dedupe_key = reminder:<id>:<instante ISO>) e o lembrete avança para a próxima ocorrência local.
 * `FOR UPDATE SKIP LOCKED` evita processamento concorrente do mesmo lembrete.
 */
export async function dispatchDueReminders(q: Queryable, now: Date, limit = 100): Promise<{ fired: number; skipped: number }> {
  const due = await q.query<ReminderRow & { workspace_id: string; owner_id: string }>(
    `select ${COLUMNS}, workspace_id, owner_id from reminders
     where active and remind_at <= $1 order by remind_at limit $2 for update skip locked`,
    [now, limit],
  );
  let fired = 0;
  let skipped = 0;
  for (const r of due) {
    const occurrence = new Date(r.remind_at);
    const inserted = await q.query(
      `insert into notification_outbox (workspace_id, user_id, kind, title, body, channels, dedupe_key, data)
       values ($1, $2, 'reminder', $3, $4, $5, $6, $7)
       on conflict (user_id, dedupe_key) do nothing returning id`,
      [r.workspace_id, r.owner_id, "Lembrete", r.title, r.channels, `reminder:${r.id}:${occurrence.toISOString()}`, JSON.stringify({ reminderId: r.id, occurrence: occurrence.toISOString() })],
    );
    if (inserted.length) fired++;
    else skipped++;
    if (r.recurrence && r.local_time) {
      const next = nextOccurrence(occurrence, r.recurrence, r.local_time.slice(0, 5), r.timezone, now);
      await q.query("update reminders set remind_at = $2, last_fired_at = $3 where id = $1", [r.id, next, now]);
    } else {
      await q.query("update reminders set active = false, last_fired_at = $2 where id = $1", [r.id, now]);
    }
  }
  return { fired, skipped };
}
