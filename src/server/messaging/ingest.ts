import type { Database } from "@/lib/db/types";
import { cancelExecution, confirmExecution, listPendingConfirmations } from "../ai/executor";
import type { AiModel } from "../ai/model";
import { handleUserMessage } from "../ai/orchestrator";
import type { GoogleGateway } from "../integrations/google/types";
import { logWebhook, markWebhook } from "../webhooks/log";
import type { InboundMessage, MessagingProvider } from "./types";

export interface IngestDeps {
  db: Database;
  provider: MessagingProvider;
  model: AiModel | null;
  google: GoogleGateway | null;
  now?: () => Date;
}

export interface IngestOutcome {
  status: "rejected" | "ignored" | "processed" | "duplicate";
  reason?: string;
  replies: { to: string; text: string; delivered: boolean }[];
}

const CONFIRM = /^(1|sim|s|confirmo|confirmar|ok|pode)\b/i;
const CANCEL = /^(2|n[aã]o|n|cancelar|cancela)\b/i;

interface ChannelOwner {
  user_id: string;
  workspace_id: string;
  timezone: string;
  assistant_name: string;
}

/**
 * Pipeline de entrada de canal:
 * 1) verifica assinatura/segredo (inválido => 401 + log); 2) replay protection por id;
 * 3) ignora mensagens do próprio bot; 4) resolve titular SOMENTE por channel_account verificada
 * (telefone isolado no payload não autentica ninguém); 5) dedupe por provider_message_id;
 * 6) confirmação/cancelamento de ações pendentes ou orquestração da IA; 7) resposta pelo mesmo canal.
 */
export async function ingestWebhook(deps: IngestDeps, rawBody: string, headers: Headers): Promise<IngestOutcome> {
  const received = await deps.provider.receive(rawBody, headers);
  if (!received.verified) {
    await logWebhook(deps.db, { provider: deps.provider.name, providerEventId: null, signatureValid: false, status: "rejected", reason: received.reason });
    return { status: "rejected", reason: received.reason, replies: [] };
  }
  const log = await logWebhook(deps.db, {
    provider: deps.provider.name,
    providerEventId: received.eventId ?? null,
    signatureValid: true,
    status: received.events.length ? "received" : "ignored",
    reason: received.reason,
    payload: { count: received.events.length, types: received.events.map((e) => e.type) },
  });
  if (log.duplicate) return { status: "duplicate", replies: [] };
  if (!received.events.length) return { status: "ignored", reason: received.reason, replies: [] };

  const replies: IngestOutcome["replies"] = [];
  let processed = 0;
  for (const event of received.events) {
    const reply = await handleInbound(deps, event);
    if (reply) {
      const sent = await deps.provider.sendText(event.from, reply);
      replies.push({ to: event.from, text: reply, delivered: sent.ok });
      processed++;
    }
  }
  await markWebhook(deps.db, log.id, processed ? "processed" : "ignored");
  return { status: processed ? "processed" : "ignored", replies };
}

async function handleInbound(deps: IngestDeps, event: InboundMessage): Promise<string | null> {
  if (event.fromMe) return null; // anti-loop: nunca responde a si mesmo
  const owner = await resolveOwner(deps.db, deps.provider.name, event.from);
  if (!owner) {
    // Número desconhecido/não verificado: não processa nem responde (evita spam e vazamento).
    return null;
  }
  const ctx = {
    userId: owner.user_id,
    workspaceId: owner.workspace_id,
    timezone: owner.timezone,
    now: deps.now?.() ?? new Date(),
    channel: "whatsapp" as const,
  };
  await deps.db.asService((q) =>
    q.query("update channel_accounts set last_inbound_at = $3 where provider = $1 and address = $2 and status = 'verified'", [deps.provider.name, event.from, ctx.now]),
  );

  const text = event.text?.trim() ?? "";
  if (text && (CONFIRM.test(text) || CANCEL.test(text))) {
    const pending = await listPendingConfirmations({ db: deps.db, ctx });
    if (pending.length) {
      if (CANCEL.test(text)) {
        for (const p of pending) await cancelExecution({ db: deps.db, ctx, google: deps.google }, p.id);
        return "Ok, cancelei as ações pendentes. Nada foi executado.";
      }
      const results = [];
      for (const p of pending) results.push(await confirmExecution({ db: deps.db, ctx, google: deps.google }, p.id));
      return results.map((r) => `${r.status === "succeeded" ? "✓" : r.status === "awaiting_confirmation" ? "⏸" : "✗"} ${r.message}`).join("\n");
    }
  }

  let media: { mimeType: string; base64: string } | undefined;
  if ((event.type === "audio" || event.type === "image") && deps.provider.downloadMedia) {
    const m = await deps.provider.downloadMedia(event);
    if (!m) return "Não consegui baixar o arquivo enviado. Pode tentar novamente ou escrever o pedido?";
    media = { mimeType: m.mimeType, base64: m.base64 };
  }
  if (!text && !media) return null;

  try {
    const result = await handleUserMessage(
      { db: deps.db, ctx, model: deps.model, google: deps.google, assistantName: owner.assistant_name },
      { text: text || undefined, media, provider: deps.provider.name === "meta_cloud" ? "meta_cloud" : "evolution", providerMessageId: event.providerMessageId },
    );
    if (result.duplicate) return null; // já respondido anteriormente
    const needsConfirm = result.outcomes.some((o) => o.status === "awaiting_confirmation");
    return needsConfirm ? `${result.reply}\n\nResponda 1) Confirmar ou 2) Cancelar.` : result.reply;
  } catch (e) {
    return e instanceof Error && /mídia|grande|vazia/.test(e.message) ? e.message : "Não consegui processar sua mensagem agora.";
  }
}

async function resolveOwner(db: Database, provider: string, address: string): Promise<ChannelOwner | null> {
  const rows = await db.asService((q) =>
    q.query<ChannelOwner>(
      `select c.user_id, c.workspace_id, p.timezone, p.assistant_name
       from channel_accounts c
       join profiles p on p.id = c.user_id
       join workspace_members m on m.workspace_id = c.workspace_id and m.user_id = c.user_id
       where c.provider = $1 and c.address = $2 and c.status = 'verified'`,
      [provider, address],
    ),
  );
  return rows[0] ?? null;
}
