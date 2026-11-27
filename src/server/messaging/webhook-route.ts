import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import { clientIp, json, rateLimit, readRawBody } from "../http";
import { JOB_HANDLERS } from "../jobs/handlers";
import { runJobs } from "../jobs/queue";
import { acceptWebhook } from "./ingest";
import type { MessagingProvider } from "./types";

/**
 * Rota comum de webhooks de WhatsApp: verifica e ENFILEIRA (responde 2xx rápido) e, após a resposta,
 * drena a fila com `after()` para baixa latência. Se o worker falhar, o cron reprocessa (retry/DLQ).
 */
export async function handleWhatsAppWebhook(req: Request, provider: MessagingProvider | null, label: string, maxBytes = 1_000_000) {
  if (!provider) return json({ error: `${label} não configurado.` }, 503);
  if (!(await rateLimit(`wh:${provider.name}:${clientIp(req)}`, 600))) return json({ error: "rate limited" }, 429);
  const raw = await readRawBody(req, maxBytes);
  if (raw === null) return json({ error: "payload muito grande" }, 413);
  try {
    const r = await acceptWebhook({ db, provider }, raw, req.headers);
    if (r.status === "rejected") return json({ error: "assinatura inválida" }, 401);
    if (r.queued) after(() => runJobs(db, JOB_HANDLERS, new Date(), 10).then(() => undefined).catch(() => undefined));
    return json({ status: r.status, queued: r.queued });
  } catch (e) {
    console.error(`[webhook:${provider.name}]`, e instanceof Error ? e.message : e);
    // Erro interno: 500 para o provedor reentregar (a dedupe por mensagem evita duplicidade).
    return json({ error: "erro interno" }, 500);
  }
}
