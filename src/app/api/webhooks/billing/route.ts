import { db } from "@/lib/db";
import { applyBillingEvent, billingProvider } from "@/server/billing/provider";
import { json, readRawBody } from "@/server/http";
import { logWebhook } from "@/server/webhooks/log";

export async function POST(req: Request) {
  const provider = billingProvider();
  const raw = await readRawBody(req);
  if (raw === null) return json({ error: "payload muito grande" }, 413);
  const verified = provider.verifyWebhook(raw, req.headers);
  if (!verified.ok) {
    await logWebhook(db, { provider: `billing:${provider.name}`, providerEventId: null, signatureValid: false, status: "rejected", reason: verified.reason });
    return json({ error: "assinatura inválida" }, provider.name === "none" ? 503 : 401);
  }
  const result = await applyBillingEvent(db, provider.name, verified.event);
  return json({ status: result });
}
