import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { enqueue, requeueDead, retryDelaySeconds, runJobs } from "@/server/jobs/queue";
import { createTestDb } from "../db/harness";
import { pgliteDatabase } from "../support/pglite-db";

let pg: PGlite;
let db: Database;
const T0 = new Date("2026-11-27T12:00:00Z");

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
});

beforeEach(async () => {
  await pg.exec("delete from system_jobs");
});

describe("fila persistente (recuperação de falhas — teste 60)", () => {
  it("enfileiramento idempotente por dedupe_key", async () => {
    const a = await db.asService((q) => enqueue(q, "x", { n: 1 }, { dedupeKey: "k1", runAfter: T0 }));
    const b = await db.asService((q) => enqueue(q, "x", { n: 2 }, { dedupeKey: "k1", runAfter: T0 }));
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
  });

  it("executa com sucesso uma única vez", async () => {
    const seen: unknown[] = [];
    await db.asService((q) => enqueue(q, "ok", { v: 42 }, { runAfter: T0 }));
    const r = await runJobs(db, { ok: async (p) => { seen.push(p.v); } }, T0);
    expect(r).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(await runJobs(db, { ok: async () => { seen.push("de novo"); } }, T0)).toMatchObject({ claimed: 0 });
    expect(seen).toEqual([42]);
  });

  it("falha => retry com backoff; esgotado => dead-letter; requeue manual", async () => {
    await db.asService((q) => enqueue(q, "flaky", {}, { runAfter: T0, maxAttempts: 2 }));
    const fail = { flaky: async () => { throw new Error("provedor indisponível"); } };
    expect(await runJobs(db, fail, T0)).toMatchObject({ retried: 1, dead: 0 });
    // Antes do backoff vencer, não roda de novo.
    expect(await runJobs(db, fail, new Date(T0.getTime() + 10_000))).toMatchObject({ claimed: 0 });
    const later = new Date(T0.getTime() + retryDelaySeconds(1) * 1000 + 1000);
    expect(await runJobs(db, fail, later)).toMatchObject({ dead: 1 });
    const [job] = (await pg.query<{ id: string; status: string; last_error: string }>("select id, status, last_error from system_jobs")).rows;
    expect(job).toMatchObject({ status: "dead", last_error: "provedor indisponível" });
    expect(await db.asService((q) => requeueDead(q, job.id))).toBe(true);
    expect(await runJobs(db, { flaky: async () => {} }, new Date(Date.now() + 1000))).toMatchObject({ succeeded: 1 });
  });

  it("job sem handler não some: vai para retry e depois dead-letter", async () => {
    await db.asService((q) => enqueue(q, "desconhecido", {}, { runAfter: T0, maxAttempts: 1 }));
    expect(await runJobs(db, {}, T0)).toMatchObject({ unknownKind: 1, dead: 1 });
  });

  it("lock expirado (worker morreu) volta para a fila", async () => {
    await pg.query("insert into system_jobs (kind, payload, status, attempts, locked_at, run_after) values ('ok', '{}', 'running', 1, $1, $1)", [new Date(T0.getTime() - 20 * 60_000)]);
    expect(await runJobs(db, { ok: async () => {} }, T0)).toMatchObject({ succeeded: 1 });
  });

  it("backoff exponencial com teto de 1 h", () => {
    expect([1, 2, 3, 10].map(retryDelaySeconds)).toEqual([30, 60, 120, 3600]);
  });
});
