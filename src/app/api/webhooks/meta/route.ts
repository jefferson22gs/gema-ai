import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { clientIp, json, rateLimit, readRawBody } from "@/server/http";
import { ingestWebhook } from "@/server/messaging/ingest";
import { aiModel, googleGateway, metaProvider } from "@/server/runtime";

/** Verificação de assinatura do webhook pela Meta (hub.challenge). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = env.metaVerifyToken();
  const provided = url.searchParams.get("hub.verify_token");
  if (url.searchParams.get("hub.mode") === "subscribe" && token && provided && safeEqual(provided, token)) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const provider = metaProvider();
  if (!provider) return json({ error: "WhatsApp Cloud API não configurada." }, 503);
  if (!(await rateLimit(`wh:meta:${clientIp(req)}`, 600))) return json({ error: "rate limited" }, 429);
  const raw = await readRawBody(req);
  if (raw === null) return json({ error: "payload muito grande" }, 413);
  const result = await ingestWebhook({ db, provider, model: aiModel(), google: googleGateway() }, raw, req.headers);
  if (result.status === "rejected") return json({ error: "assinatura inválida" }, 401);
  return json({ status: result.status });
}
