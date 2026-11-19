import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { applyEmailWebhook } from "@/server/email/service";
import { json, readRawBody } from "@/server/http";
import { logWebhook, markWebhook } from "@/server/webhooks/log";
import { verifySharedSecret } from "@/server/webhooks/verify";

const STATUS: Record<string, "delivered" | "bounced" | "failed"> = {
  delivered: "delivered",
  hard_bounce: "bounced",
  soft_bounce: "bounced",
  blocked: "failed",
  invalid_email: "failed",
  error: "failed",
  spam: "failed",
};

/** Brevo: segredo compartilhado no header Authorization: Bearer <BREVO_WEBHOOK_SECRET> (configurado no painel Brevo). */
export async function POST(req: Request) {
  const secret = env.brevoWebhookSecret();
  if (!secret) return json({ error: "Webhook Brevo não configurado." }, 503);
  const raw = await readRawBody(req);
  if (raw === null) return json({ error: "payload muito grande" }, 413);
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const check = verifySharedSecret(provided, secret);
  if (!check.ok) {
    await logWebhook(db, { provider: "brevo", providerEventId: null, signatureValid: false, status: "rejected", reason: check.reason });
    return json({ error: "assinatura inválida" }, 401);
  }
  const event = JSON.parse(raw) as { event?: string; "message-id"?: string; id?: number; ts_event?: number };
  const eventId = event["message-id"] && event.event ? `${event["message-id"]}:${event.event}` : null;
  const log = await logWebhook(db, { provider: "brevo", providerEventId: eventId, signatureValid: true, status: "received", payload: { event: event.event } });
  if (log.duplicate) return json({ status: "duplicate" });
  const status = event.event ? STATUS[event.event] : undefined;
  if (status && event["message-id"]) {
    await applyEmailWebhook(db, "brevo", event["message-id"], status);
    await markWebhook(db, log.id, "processed");
  } else {
    await markWebhook(db, log.id, "ignored");
  }
  return json({ status: "ok" });
}
