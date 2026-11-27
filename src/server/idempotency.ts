import { createHash } from "node:crypto";
import type { Database } from "@/lib/db/types";

/**
 * Idempotência por cabeçalho `Idempotency-Key` (padrão IETF draft-ietf-httpapi-idempotency-key-header).
 * - mesma chave + mesmo corpo: devolve a resposta gravada (cabeçalho `Idempotent-Replayed: true`);
 * - mesma chave + corpo diferente: 422;
 * - chave em processamento: 409 (o cliente tenta de novo depois);
 * - 5xx ou exceção: a chave é liberada para nova tentativa (nada foi confirmado).
 * Sem cabeçalho, a requisição segue normalmente.
 */

export const IDEMPOTENCY_HEADER = "idempotency-key";
const KEY_RE = /^[A-Za-z0-9_\-:.]{8,128}$/;

export interface StoredResponse {
  status: number;
  body: unknown;
}

export function requestHash(parts: (string | Uint8Array)[]): string {
  const h = createHash("sha256");
  for (const p of parts) {
    h.update(typeof p === "string" ? Buffer.from(p, "utf8") : p);
    h.update("\u0000");
  }
  return h.digest("hex");
}

export function readIdempotencyKey(req: Request): { key: string | null; error?: string } {
  const raw = req.headers.get(IDEMPOTENCY_HEADER);
  if (raw === null) return { key: null };
  const key = raw.trim().replace(/^"|"$/g, "");
  return KEY_RE.test(key) ? { key } : { key: null, error: "Idempotency-Key inválida (8–128 caracteres: letras, números, _ - : .)." };
}

type Outcome = { kind: "run" } | { kind: "replay"; response: StoredResponse } | { kind: "conflict"; status: 409 | 422; message: string };

async function claim(db: Database, userId: string, scope: string, key: string, hash: string): Promise<Outcome> {
  return db.asService(async (q) => {
    // Chave vencida é descartada antes (não bloqueia reuso após 24 h).
    await q.query("delete from idempotency_keys where user_id = $1 and scope = $2 and key = $3 and expires_at < now()", [userId, scope, key]);
    const inserted = await q.query(
      "insert into idempotency_keys (user_id, scope, key, request_hash) values ($1, $2, $3, $4) on conflict (user_id, scope, key) do nothing returning id",
      [userId, scope, key, hash],
    );
    if (inserted.length) return { kind: "run" };
    const [row] = await q.query<{ request_hash: string; status: string; response_status: number | null; response_body: unknown; stale: boolean }>(
      "select request_hash, status, response_status, response_body, locked_until < now() as stale from idempotency_keys where user_id = $1 and scope = $2 and key = $3 for update",
      [userId, scope, key],
    );
    if (row.request_hash !== hash) return { kind: "conflict", status: 422, message: "Esta Idempotency-Key já foi usada com outro conteúdo." };
    if (row.status === "completed") return { kind: "replay", response: { status: row.response_status ?? 200, body: row.response_body } };
    if (!row.stale) return { kind: "conflict", status: 409, message: "Requisição com esta chave ainda em processamento. Tente novamente em instantes." };
    // Processamento anterior travou (processo caiu): retoma.
    await q.query("update idempotency_keys set locked_until = now() + interval '2 minutes' where user_id = $1 and scope = $2 and key = $3", [userId, scope, key]);
    return { kind: "run" };
  });
}

export async function withIdempotency(
  db: Database,
  opts: { userId: string; scope: string; key: string | null; hash: string },
  run: () => Promise<StoredResponse>,
): Promise<StoredResponse & { replayed: boolean }> {
  if (!opts.key) return { ...(await run()), replayed: false };
  const outcome = await claim(db, opts.userId, opts.scope, opts.key, opts.hash);
  if (outcome.kind === "replay") return { ...outcome.response, replayed: true };
  if (outcome.kind === "conflict") return { status: outcome.status, body: { error: outcome.message, code: "idempotency" }, replayed: false };
  const release = () => db.asService((q) => q.query("delete from idempotency_keys where user_id = $1 and scope = $2 and key = $3 and status = 'processing'", [opts.userId, opts.scope, opts.key]));
  let res: StoredResponse;
  try {
    res = await run();
  } catch (e) {
    await release();
    throw e;
  }
  if (res.status >= 500) {
    await release();
    return { ...res, replayed: false };
  }
  await db.asService((q) => q.query(
    "update idempotency_keys set status = 'completed', response_status = $4, response_body = $5 where user_id = $1 and scope = $2 and key = $3",
    [opts.userId, opts.scope, opts.key, res.status, JSON.stringify(res.body ?? null)],
  ));
  return { ...res, replayed: false };
}

export function idempotentJson(r: StoredResponse & { replayed: boolean }): Response {
  return new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(r.replayed ? { "idempotent-replayed": "true" } : {}) },
  });
}

export async function purgeExpiredIdempotencyKeys(db: Database): Promise<number> {
  const rows = await db.asService((q) => q.query("delete from idempotency_keys where expires_at < now() returning id"));
  return rows.length;
}
