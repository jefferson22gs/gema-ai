import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { purgeExpiredIdempotencyKeys, readIdempotencyKey, requestHash, withIdempotency } from "@/server/idempotency";
import { asUser, createTestDb, createUser } from "./harness";
import { pgliteDatabase } from "../support/pglite-db";

let pg: PGlite;
let db: Database;
let ana: { id: string };
let beto: { id: string };

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  ana = await createUser(pg, "ana@idem.test");
  beto = await createUser(pg, "beto@idem.test");
});

const req = (key?: string) => new Request("http://x/api", { method: "POST", headers: key === undefined ? {} : { "idempotency-key": key } });

describe("Idempotency-Key (F1-06)", () => {
  it("valida o cabeçalho", () => {
    expect(readIdempotencyKey(req())).toEqual({ key: null });
    expect(readIdempotencyKey(req("abc")).error).toMatch(/inválida/);
    expect(readIdempotencyKey(req("bad key with spaces")).error).toBeDefined();
    expect(readIdempotencyKey(req('"7f3c1d2e-aaaa-bbbb"')).key).toBe("7f3c1d2e-aaaa-bbbb");
  });

  it("mesma chave e corpo: executa uma vez e repete a resposta", async () => {
    let runs = 0;
    const call = () => withIdempotency(db, { userId: ana.id, scope: "teste", key: "chave-0001", hash: requestHash(["a"]) }, async () => {
      runs++;
      return { status: 201, body: { id: `doc-${runs}` } };
    });
    const first = await call();
    const second = await call();
    expect(runs).toBe(1);
    expect(first).toEqual({ status: 201, body: { id: "doc-1" }, replayed: false });
    expect(second).toEqual({ status: 201, body: { id: "doc-1" }, replayed: true });
  });

  it("mesma chave com outro corpo: 422 sem executar", async () => {
    let ran = false;
    const r = await withIdempotency(db, { userId: ana.id, scope: "teste", key: "chave-0001", hash: requestHash(["b"]) }, async () => { ran = true; return { status: 201, body: {} }; });
    expect(r.status).toBe(422);
    expect(ran).toBe(false);
  });

  it("chave é por usuário e por escopo", async () => {
    const r1 = await withIdempotency(db, { userId: beto.id, scope: "teste", key: "chave-0001", hash: requestHash(["b"]) }, async () => ({ status: 200, body: "beto" }));
    const r2 = await withIdempotency(db, { userId: ana.id, scope: "outro", key: "chave-0001", hash: requestHash(["b"]) }, async () => ({ status: 200, body: "outro" }));
    expect([r1.replayed, r2.replayed]).toEqual([false, false]);
  });

  it("em processamento: 409; travada há mais de 2 min: retoma", async () => {
    await pg.query("insert into idempotency_keys (user_id, scope, key, request_hash) values ($1, 'proc', 'chave-proc', $2)", [ana.id, requestHash(["x"])]);
    const busy = await withIdempotency(db, { userId: ana.id, scope: "proc", key: "chave-proc", hash: requestHash(["x"]) }, async () => ({ status: 200, body: 1 }));
    expect(busy.status).toBe(409);
    await pg.query("update idempotency_keys set locked_until = now() - interval '1 second' where key = 'chave-proc'");
    const resumed = await withIdempotency(db, { userId: ana.id, scope: "proc", key: "chave-proc", hash: requestHash(["x"]) }, async () => ({ status: 200, body: 1 }));
    expect(resumed).toMatchObject({ status: 200, replayed: false });
  });

  it("erro 5xx ou exceção libera a chave para nova tentativa", async () => {
    const opts = { userId: ana.id, scope: "falha", key: "chave-falha", hash: requestHash(["y"]) };
    expect((await withIdempotency(db, opts, async () => ({ status: 502, body: { error: "x" } }))).status).toBe(502);
    await expect(withIdempotency(db, opts, async () => { throw new Error("caiu"); })).rejects.toThrow("caiu");
    const ok = await withIdempotency(db, opts, async () => ({ status: 201, body: "ok" }));
    expect(ok).toMatchObject({ status: 201, replayed: false });
    // Erro de negócio (4xx) é resposta definitiva e é repetido.
    const o4 = { ...opts, key: "chave-4xx" };
    await withIdempotency(db, o4, async () => ({ status: 413, body: { error: "limite" } }));
    expect(await withIdempotency(db, o4, async () => ({ status: 201, body: "não" }))).toMatchObject({ status: 413, replayed: true });
  });

  it("sem chave executa sempre; expiradas são removidas e liberam reuso", async () => {
    let runs = 0;
    for (let i = 0; i < 2; i++) await withIdempotency(db, { userId: ana.id, scope: "x", key: null, hash: "" }, async () => ({ status: 200, body: ++runs }));
    expect(runs).toBe(2);
    await pg.query("update idempotency_keys set expires_at = now() - interval '1 minute' where key = 'chave-0001' and user_id = $1 and scope = 'teste'", [ana.id]);
    const again = await withIdempotency(db, { userId: ana.id, scope: "teste", key: "chave-0001", hash: requestHash(["novo"]) }, async () => ({ status: 201, body: "novo" }));
    expect(again).toMatchObject({ body: "novo", replayed: false });
    await pg.query("update idempotency_keys set expires_at = now() - interval '1 minute'");
    expect(await purgeExpiredIdempotencyKeys(db)).toBeGreaterThan(0);
  });

  it("tabela inacessível ao cliente (respostas não vazam)", async () => {
    await expect(asUser(pg, ana.id, (tx) => tx.query("select * from idempotency_keys"))).rejects.toThrow(/permission denied/);
  });
});
