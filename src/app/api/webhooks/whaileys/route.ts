import { db } from "@/lib/db";
import { clientIp, json, rateLimit, readRawBody } from "@/server/http";
import { ingestWebhook } from "@/server/messaging/ingest";
import { aiModel, googleGateway, whaileysProvider } from "@/server/runtime";

/**
 * Webhook do motor Whaileys. Assinatura HMAC validada antes de qualquer uso do corpo (inválida => 401).
 * Erros de negócio não viram 5xx (o motor reentrega até 3× em 5xx); a dedupe por key.id cobre reentregas.
 */
export async function POST(req: Request) {
  const provider = whaileysProvider();
  if (!provider) return json({ error: "Whaileys não configurado." }, 503);
  if (!(await rateLimit(`wh:whaileys:${clientIp(req)}`, 300))) return json({ error: "rate limited" }, 429);
  const raw = await readRawBody(req, 12_000_000); // mídia até 8 MB em base64
  if (raw === null) return json({ error: "payload muito grande" }, 413);
  try {
    const result = await ingestWebhook({ db, provider, model: aiModel(), google: googleGateway() }, raw, req.headers);
    if (result.status === "rejected") return json({ error: "assinatura inválida" }, 401);
    return json({ status: result.status });
  } catch (e) {
    console.error("[whaileys] falha ao processar", e instanceof Error ? e.message : e);
    return json({ status: "error_logged" });
  }
}
