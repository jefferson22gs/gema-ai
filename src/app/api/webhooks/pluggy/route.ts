import { db } from "@/lib/db";
import { enqueue } from "@/server/jobs/queue";
import { json, readRawBody } from "@/server/http";
import { bankProvider } from "@/server/runtime";
import { logWebhook } from "@/server/webhooks/log";

/**
 * Webhook Pluggy: assinatura `X-Pluggy-Signature` (HMAC do corpo cru, janela 5 min), dedupe por eventId.
 * Não confiamos no payload: só enfileiramos uma sincronização da conexão, que relê o item na API.
 * Responde rápido (a Pluggy exige 2xx em até 10 s). Assinatura inválida => 401 (não é retentada).
 */
const SYNC_EVENTS = new Set(["item/updated", "item/error", "item/login_succeeded", "transactions/created", "transactions/updated", "transactions/deleted"]);

export async function POST(req: Request) {
  const provider = bankProvider();
  if (!provider) return json({ error: "Open Finance não configurado." }, 503);
  const raw = await readRawBody(req, 200_000);
  if (raw === null) return json({ error: "payload muito grande" }, 413);
  const verified = provider.verifyWebhook(raw, req.headers);
  if (!verified.ok) {
    await logWebhook(db, { provider: "pluggy", providerEventId: null, signatureValid: false, status: "rejected", reason: verified.reason });
    return json({ error: "assinatura inválida" }, 401);
  }
  const ev = verified.event;
  const log = await logWebhook(db, { provider: "pluggy", providerEventId: ev.eventId, signatureValid: true, status: "received", payload: { event: ev.event, itemId: ev.itemId } });
  if (log.duplicate) return json({ status: "duplicate" });
  if (!ev.itemId) return json({ status: "ignored" });

  const [conn] = await db.asService((q) =>
    q.query<{ id: string }>("select id from bank_connections where provider = 'pluggy' and external_item_id = $1 and revoked_at is null", [ev.itemId]),
  );
  if (!conn) return json({ status: "ignored" });
  if (ev.event === "item/deleted") {
    await db.asService((q) => q.query("update bank_connections set status = 'revoked', revoked_at = coalesce(revoked_at, now()) where id = $1", [conn.id]));
    return json({ status: "processed" });
  }
  if (SYNC_EVENTS.has(ev.event)) {
    // Uma sincronização por janela de 2 min por conexão (eventos em rajada viram um único job).
    const bucket = Math.floor(Date.now() / 120_000);
    await db.asService((q) => enqueue(q, "open_finance.sync", { connectionId: conn.id, trigger: "webhook" }, { dedupeKey: `of:wh:${conn.id}:${bucket}` }));
  }
  return json({ status: "queued" });
}
