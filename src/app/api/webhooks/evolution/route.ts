import { db } from "@/lib/db";
import { clientIp, json, rateLimit, readRawBody } from "@/server/http";
import { ingestWebhook } from "@/server/messaging/ingest";
import { aiModel, evolutionProvider, googleGateway } from "@/server/runtime";

export async function POST(req: Request) {
  const provider = evolutionProvider();
  if (!provider) return json({ error: "Evolution API não configurada." }, 503);
  if (!(await rateLimit(`wh:evolution:${clientIp(req)}`, 300))) return json({ error: "rate limited" }, 429);
  const raw = await readRawBody(req);
  if (raw === null) return json({ error: "payload muito grande" }, 413);
  const result = await ingestWebhook({ db, provider, model: aiModel(), google: googleGateway() }, raw, req.headers);
  if (result.status === "rejected") return json({ error: "assinatura inválida" }, 401);
  return json({ status: result.status });
}
