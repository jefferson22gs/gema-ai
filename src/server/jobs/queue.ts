import type { Database, Queryable } from "@/lib/db/types";

/**
 * Fila persistente sobre `system_jobs` (Postgres): enfileiramento idempotente por `dedupe_key`,
 * reserva concorrente segura (`for update skip locked`), retry com backoff exponencial e
 * dead-letter (`dead`) após `max_attempts`. Executada pelo cron (`/api/automations/dispatch`).
 * Serverless-friendly: nenhum processo permanente.
 */
export interface JobRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export type JobHandler = (payload: Record<string, unknown>, job: JobRow) => Promise<void>;

/** Jobs presos em "running" por mais que isso (worker morreu) voltam para a fila. */
const STALE_LOCK_MINUTES = 15;

export function retryDelaySeconds(attempt: number): number {
  return Math.min(30 * 2 ** (attempt - 1), 3600);
}

export async function enqueue(
  q: Queryable,
  kind: string,
  payload: Record<string, unknown>,
  opts: { dedupeKey?: string; runAfter?: Date; maxAttempts?: number } = {},
): Promise<{ id: string; created: boolean }> {
  const rows = await q.query<{ id: string }>(
    `insert into system_jobs (kind, payload, dedupe_key, run_after, max_attempts)
     values ($1, $2, $3, coalesce($4, now()), $5)
     on conflict (dedupe_key) do nothing returning id`,
    [kind, JSON.stringify(payload), opts.dedupeKey ?? null, opts.runAfter ?? null, opts.maxAttempts ?? 5],
  );
  if (rows.length) return { id: rows[0].id, created: true };
  const [existing] = await q.query<{ id: string }>("select id from system_jobs where dedupe_key = $1", [opts.dedupeKey]);
  return { id: existing.id, created: false };
}

export interface WorkResult {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
  unknownKind: number;
}

export async function runJobs(db: Database, handlers: Record<string, JobHandler>, now: Date, limit = 20): Promise<WorkResult> {
  const result: WorkResult = { claimed: 0, succeeded: 0, retried: 0, dead: 0, unknownKind: 0 };
  const jobs = await db.asService(async (q) => {
    await q.query(
      `update system_jobs set status = 'failed', locked_at = null, last_error = 'lock expirado (worker interrompido)'
       where status = 'running' and locked_at < $1::timestamptz - make_interval(mins => $2)`,
      [now, STALE_LOCK_MINUTES],
    );
    return q.query<JobRow>(
      `update system_jobs j set status = 'running', locked_at = $1, attempts = j.attempts + 1
       from (select id from system_jobs where status in ('pending', 'failed') and run_after <= $1
             order by run_after limit $2 for update skip locked) due
       where j.id = due.id
       returning j.id, j.kind, j.payload, j.attempts, j.max_attempts`,
      [now, limit],
    );
  });
  result.claimed = jobs.length;
  for (const job of jobs) {
    const handler = handlers[job.kind];
    try {
      if (!handler) {
        result.unknownKind++;
        throw new Error(`sem handler para "${job.kind}"`);
      }
      await handler(job.payload, job);
      await db.asService((q) => q.query("update system_jobs set status = 'succeeded', locked_at = null, last_error = null where id = $1", [job.id]));
      result.succeeded++;
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      const dead = job.attempts >= job.max_attempts;
      await db.asService((q) =>
        q.query(
          "update system_jobs set status = $2, locked_at = null, last_error = $3, run_after = $4 where id = $1",
          [job.id, dead ? "dead" : "failed", message, new Date(now.getTime() + retryDelaySeconds(job.attempts) * 1000)],
        ),
      );
      if (dead) result.dead++;
      else result.retried++;
    }
  }
  return result;
}

/** Reprocessamento manual de um job em dead-letter (Super Admin / runbook). */
export async function requeueDead(q: Queryable, id: string): Promise<boolean> {
  const rows = await q.query("update system_jobs set status = 'pending', attempts = 0, run_after = now(), last_error = null where id = $1 and status = 'dead' returning id", [id]);
  return rows.length > 0;
}
