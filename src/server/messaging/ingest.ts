import type { Database } from "@/lib/db/types";
import { cancelExecution, confirmExecution, listPendingConfirmations } from "../ai/executor";
import type { AiModel } from "../ai/model";
import { handleUserMessage, type IncomingUserMessage } from "../ai/orchestrator";
import type { GoogleGateway } from "../integrations/google/types";
import { logWebhook, markWebhook } from "../webhooks/log";
import { consumeLinkCode, extractLinkCode, type InboundLinkResult } from "./verification";
import { enqueue } from "../jobs/queue";
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
/** Ids dos botões coincidem com as palavras aceitas no texto: clique, "1"/"2" ou digitação funcionam igual. */
const CONFIRM_BUTTONS = [
  { id: "confirmar", title: "✅ Confirmar" },
  { id: "cancelar", title: "Cancelar" },
];

interface Reply {
  text: string;
  /** true quando há ação aguardando confirmação: envia botões Confirmar/Cancelar. */
  confirm?: boolean;
}

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
/** Processamento síncrono (aceite + processamento no mesmo request). Usado em testes e como fallback. */
export async function ingestWebhook(deps: IngestDeps, rawBody: string, headers: Headers): Promise<IngestOutcome> {
  const accepted = await verifyAndLog(deps, rawBody, headers);
  if (accepted.status !== "accepted") return { status: accepted.status, reason: accepted.reason, replies: [] };
  const replies: IngestOutcome["replies"] = [];
  for (const event of accepted.events) {
    const r = await processInboundEvent(deps, event);
    if (r) replies.push(r);
  }
  await markWebhook(deps.db, accepted.logId, replies.length ? "processed" : "ignored");
  return { status: replies.length ? "processed" : "ignored", replies };
}

/**
 * Aceite assíncrono (WA-05): verifica assinatura, registra, deduplica e ENFILEIRA um job por mensagem
 * (`whatsapp.inbound`, dedupe por provider+id). O webhook responde 2xx em milissegundos; o worker
 * processa com retry/backoff/dead-letter.
 */
export async function acceptWebhook(deps: Pick<IngestDeps, "db" | "provider">, rawBody: string, headers: Headers): Promise<{ status: "rejected" | "ignored" | "duplicate" | "queued"; queued: number }> {
  const accepted = await verifyAndLog(deps, rawBody, headers);
  if (accepted.status !== "accepted") return { status: accepted.status, queued: 0 };
  let queued = 0;
  for (const event of accepted.events) {
    if (event.fromMe) continue;
    const r = await deps.db.asService((q) =>
      enqueue(q, "whatsapp.inbound", { provider: deps.provider.name, event: { ...event, timestamp: event.timestamp.toISOString() } }, {
        dedupeKey: `wa:${deps.provider.name}:${event.providerMessageId}`,
        maxAttempts: 4,
      }),
    );
    if (r.created) queued++;
  }
  await markWebhook(deps.db, accepted.logId, queued ? "processed" : "ignored");
  return { status: queued ? "queued" : "ignored", queued };
}

/** Processa um evento já verificado (worker da fila ou modo síncrono) e responde pelo canal. */
export async function processInboundEvent(deps: IngestDeps, event: InboundMessage): Promise<IngestOutcome["replies"][number] | null> {
  const reply = await handleInbound(deps, event);
  if (!reply) return null;
  const sent = reply.confirm
    ? await deps.provider.sendInteractiveIfSupported(event.from, reply.text, CONFIRM_BUTTONS)
    : await deps.provider.sendText(event.from, reply.text);
  return { to: event.from, text: reply.text, delivered: sent.ok };
}

async function verifyAndLog(
  deps: Pick<IngestDeps, "db" | "provider">,
  rawBody: string,
  headers: Headers,
): Promise<{ status: "rejected" | "ignored" | "duplicate"; reason?: string } | { status: "accepted"; events: InboundMessage[]; logId: number | null; reason?: string }> {
  const received = await deps.provider.receive(rawBody, headers);
  if (!received.verified) {
    await logWebhook(deps.db, { provider: deps.provider.name, providerEventId: null, signatureValid: false, status: "rejected", reason: received.reason });
    return { status: "rejected", reason: received.reason };
  }
  const log = await logWebhook(deps.db, {
    provider: deps.provider.name,
    providerEventId: received.eventId ?? null,
    signatureValid: true,
    status: received.events.length ? "received" : "ignored",
    reason: received.reason,
    payload: { count: received.events.length, types: received.events.map((e) => e.type) },
  });
  if (log.duplicate) return { status: "duplicate" };
  if (!received.events.length) return { status: "ignored", reason: received.reason };
  return { status: "accepted", events: received.events, logId: log.id, reason: received.reason };
}

async function handleInbound(deps: IngestDeps, event: InboundMessage): Promise<Reply | null> {
  if (event.fromMe) return null; // anti-loop: nunca responde a si mesmo
  if (deps.provider.name === "dashboard") return null;

  // Vinculação inbound: mensagem com código "GEMA-1234-5678" gerado no painel comprova a posse do número.
  const linkCode = extractLinkCode(event.text);
  if (linkCode) {
    const r = await consumeLinkCode(deps.db, deps.provider.name, event.from, linkCode);
    const replies: Record<InboundLinkResult["status"], string> = {
      linked: "✅ Número vinculado ao seu GEMA AI. Você já pode me pedir coisas por aqui. Para desvincular, use Integrações no painel.",
      invalid: "Código inválido ou já utilizado. Gere um novo em Integrações → WhatsApp no painel.",
      expired: "Este código expirou. Gere um novo em Integrações → WhatsApp no painel.",
      blocked: "Muitas tentativas a partir deste número. Tente novamente em 1 hora.",
      conflict: "Este número já está vinculado a outra conta GEMA AI. Desvincule por lá antes de vincular aqui.",
    };
    return { text: replies[r.status] };
  }

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
        return { text: "Ok, cancelei as ações pendentes. Nada foi executado." };
      }
      const results = [];
      for (const p of pending) results.push(await confirmExecution({ db: deps.db, ctx, google: deps.google }, p.id));
      return {
        text: results.map((r) => `${r.status === "succeeded" ? "✓" : r.status === "awaiting_confirmation" ? "⏸" : "✗"} ${r.message}`).join("\n"),
        confirm: results.some((r) => r.status === "awaiting_confirmation"),
      };
    }
  }

  let media: { mimeType: string; base64: string } | undefined;
  if ((event.type === "audio" || event.type === "image") && deps.provider.downloadMedia) {
    const m = await deps.provider.downloadMedia(event);
    if (!m) return { text: "Não consegui baixar o arquivo enviado. Pode tentar novamente ou escrever o pedido?" };
    media = { mimeType: m.mimeType, base64: m.base64 };
  }
  if (!text && !media) return null;

  try {
    const result = await handleUserMessage(
      { db: deps.db, ctx, model: deps.model, google: deps.google, assistantName: owner.assistant_name },
      { text: text || undefined, media, provider: channelProvider(deps.provider.name), providerMessageId: event.providerMessageId },
    );
    if (result.duplicate) return null; // já respondido anteriormente
    if (result.suppressed) return null; // atendimento humano, pausado ou sugestão de copiloto: nada é enviado
    return { text: result.reply, confirm: result.outcomes.some((o) => o.status === "awaiting_confirmation") };
  } catch (e) {
    return { text: e instanceof Error && /mídia|grande|vazia/.test(e.message) ? e.message : "Não consegui processar sua mensagem agora." };
  }
}

/** Provedor gravado na mensagem (base do dedupe por provider + provider_message_id). */
function channelProvider(name: MessagingProvider["name"]): IncomingUserMessage["provider"] {
  return name;
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
