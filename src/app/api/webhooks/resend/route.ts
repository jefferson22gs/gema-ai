import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { applyEmailWebhook } from "@/server/email/service";
import { json, readRawBody } from "@/server/http";
import { logWebhook, markWebhook } from "@/server/webhooks/log";
import { verifySvixSignature } from "@/server/webhooks/verify";

const STATUS: Record<string, "delivered" | "bounced" | "failed"> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "failed",
  "email.failed": "failed",
};

export async function POST(req: Request) {
  const secret = env.resendWebhookSecret();
  if (!secret) return json({ error: "Webhook Resend não configurado." }, 503);
  const raw = await readRawBody(req);
  if (raw === null) return json({ error: "payload muito grande" }, 413);
  const eventId = req.headers.get("svix-id");
  const check = verifySvixSignature(raw, { id: eventId, timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, secret);
  if (!check.ok) {
    await logWebhook(db, { provider: "resend", providerEventId: null, signatureValid: false, status: "rejected", reason: check.reason });
    return json({ error: "assinatura inválida" }, 401);
  }
  const event = JSON.parse(raw) as { type?: string; data?: { email_id?: string } };
  const log = await logWebhook(db, { provider: "resend", providerEventId: eventId, signatureValid: true, status: "received", payload: { type: event.type } });
  if (log.duplicate) return json({ status: "duplicate" });
  const status = event.type ? STATUS[event.type] : undefined;
  if (status && event.data?.email_id) {
    await applyEmailWebhook(db, "resend", event.data.email_id, status);
    await markWebhook(db, log.id, "processed");
  } else {
    await markWebhook(db, log.id, "ignored");
  }
  return json({ status: "ok" });
}
