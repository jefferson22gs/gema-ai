import { createHmac, timingSafeEqual } from "node:crypto";
import { jidToE164, type InboundMessage, type InteractiveButton, type MessagingProvider, type ProviderHealth, type ReceiveResult, type SendResult } from "./types";

export interface WhaileysConfig {
  apiUrl: string;
  instance: string;
  token: string;
  webhookSecret: string;
}

type FetchLike = typeof fetch;

const REPLAY_WINDOW_MS = 5 * 60_000;
const MAX_TEXT = 4000;

/**
 * Valida o webhook do motor Whaileys: HMAC-SHA256 hex de `${timestamp}.${corpoCru}` com o segredo,
 * timestamp em ms dentro de 5 minutos (anti-replay), comparação em tempo constante.
 */
export function verifyWhaileysSignature(raw: string, ts: string | null, sig: string | null, secret: string, nowMs = Date.now()): boolean {
  if (!secret || !ts || !sig || !/^\d{13}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(nowMs - Number(ts)) > REPLAY_WINDOW_MS) return false;
  return timingSafeEqual(createHmac("sha256", secret).update(`${ts}.${raw}`).digest(), Buffer.from(sig, "hex"));
}

interface WhaileysPayload {
  instanceKey?: string;
  key?: { id?: string; remoteJid?: string; fromMe?: boolean; senderPn?: string };
  message?: Record<string, unknown>;
  media?: { mimetype?: string; data?: string };
}

/** Extrai o texto ou o id escolhido (botão, lista, native flow) da mensagem. */
export function extractWhaileysText(message: Record<string, unknown> | undefined): { text?: string; interactive: boolean } {
  if (!message) return { interactive: false };
  const m = message as {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    buttonsResponseMessage?: { selectedButtonId?: string };
    templateButtonReplyMessage?: { selectedId?: string };
    listResponseMessage?: { singleSelectReply?: { selectedRowId?: string } };
    interactiveResponseMessage?: { nativeFlowResponseMessage?: { paramsJson?: string } };
    imageMessage?: { caption?: string };
  };
  const button = m.buttonsResponseMessage?.selectedButtonId ?? m.templateButtonReplyMessage?.selectedId;
  if (button) return { text: button, interactive: true };
  const row = m.listResponseMessage?.singleSelectReply?.selectedRowId;
  if (row) return { text: row, interactive: true };
  const params = m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (params) {
    try {
      const id = (JSON.parse(params) as { id?: unknown }).id;
      if (typeof id === "string") return { text: id, interactive: true };
    } catch {
      // paramsJson malformado: trata como mensagem sem texto
    }
  }
  return { text: m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption, interactive: false };
}

/**
 * Motor Whaileys (Baileys com botões/listas) hospedado em host persistente próprio.
 * Recebe texto, cliques e mídia (inline no webhook); envia texto, botões (até 3) e listas.
 * Não envia mídia. Conector NÃO oficial do WhatsApp: ver aviso em docs/WHATSAPP_PROVIDERS.md.
 */
export class WhaileysProvider implements MessagingProvider {
  readonly name = "baileys_whaileys" as const;
  private readonly base: string;

  constructor(private readonly cfg: WhaileysConfig, private readonly fetchImpl: FetchLike = fetch, private readonly now: () => number = Date.now) {
    this.base = `${cfg.apiUrl.replace(/\/+$/, "")}/sessions/${encodeURIComponent(cfg.instance)}`;
  }

  private async call(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { "x-api-key": this.cfg.token, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  }

  async receive(rawBody: string, headers: Headers): Promise<ReceiveResult> {
    if (!verifyWhaileysSignature(rawBody, headers.get("x-whaileys-timestamp"), headers.get("x-whaileys-signature"), this.cfg.webhookSecret, this.now())) {
      return { verified: false, reason: "assinatura inválida ou fora da janela", events: [] };
    }
    let p: WhaileysPayload;
    try {
      p = JSON.parse(rawBody) as WhaileysPayload;
    } catch {
      return { verified: true, reason: "json inválido", events: [] };
    }
    if (p.instanceKey !== this.cfg.instance) return { verified: true, reason: "instância diferente", events: [] };
    const id = p.key?.id;
    const jid = p.key?.remoteJid ?? "";
    if (!id || !jid) return { verified: true, reason: "evento sem mensagem", events: [] };
    if (jid.endsWith("@g.us") || jid === "status@broadcast") return { verified: true, reason: "grupo/status ignorado", events: [], eventId: id };

    // Remetente: JID de telefone; se vier só LID, usa senderPn (quando o motor conseguir resolver).
    const from = jid.endsWith("@s.whatsapp.net") ? jidToE164(jid) : p.key?.senderPn ? jidToE164(p.key.senderPn) : null;
    if (!from) return { verified: true, reason: "remetente sem telefone resolvido (LID)", events: [], eventId: id };

    const { text, interactive } = extractWhaileysText(p.message);
    const msg = p.message ?? {};
    const mime = p.media?.mimetype;
    const hasAudio = "audioMessage" in msg;
    const hasImage = "imageMessage" in msg;
    const inlineMedia = p.media?.data && mime && (hasAudio || hasImage) ? { mimeType: mime.split(";")[0], base64: p.media.data } : undefined;

    const event: InboundMessage = {
      provider: this.name,
      providerMessageId: id,
      from,
      fromMe: Boolean(p.key?.fromMe),
      type: interactive ? "interactive_reply" : hasAudio ? "audio" : hasImage ? "image" : text ? "text" : "other",
      text,
      inlineMedia,
      timestamp: new Date(this.now()),
    };
    return { verified: true, events: [event], eventId: id };
  }

  private async send(body: Record<string, unknown>): Promise<SendResult> {
    try {
      const { status, json } = await this.call("/send", body);
      if (status < 300 && typeof json.messageId === "string") return { ok: true, providerMessageId: json.messageId };
      if (status === 409) return { ok: false, error: "Sessão do WhatsApp desconectada." };
      return { ok: false, error: typeof json.error === "string" ? json.error : `HTTP ${status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "erro de rede" };
    }
  }

  sendText(to: string, text: string) {
    return this.send({ to: to.replace(/^\+/, ""), text: text.slice(0, MAX_TEXT) });
  }

  /** Botões com as opções também numeradas no texto: se o aparelho não exibir botões, "1"/"2" funcionam. */
  sendInteractiveIfSupported(to: string, text: string, buttons: InteractiveButton[]) {
    const numbered = `${text}\n\n${buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n")}`.slice(0, MAX_TEXT);
    return this.send({
      to: to.replace(/^\+/, ""),
      text: numbered,
      buttons: buttons.slice(0, 3).map((b) => ({ id: b.id, title: b.title.slice(0, 20) })),
    });
  }

  async sendMediaIfSupported(): Promise<SendResult> {
    return { ok: false, unsupported: true, error: "O motor Whaileys não envia mídia." };
  }

  async downloadMedia(msg: InboundMessage) {
    return msg.inlineMedia ?? null;
  }

  async ack(): Promise<void> {
    // O motor não exige confirmação de leitura.
  }

  async registerKnownPhones(phonesE164: string[]): Promise<void> {
    const phones = phonesE164.map((p) => p.replace(/^\+/, "")).filter((p) => /^\d{8,15}$/.test(p)).slice(0, 50);
    if (!phones.length) return;
    await this.call("/known-phones", { phones }).catch(() => undefined);
  }

  async health(): Promise<ProviderHealth> {
    try {
      const { status, json } = await this.call("");
      if (status >= 300) return { status: "error", detail: `HTTP ${status}` };
      const state = typeof json.state === "string" ? json.state : "desconhecido";
      return state === "open" ? { status: "connected", detail: "sessão aberta" } : { status: "disconnected", detail: state };
    } catch (e) {
      return { status: "error", detail: e instanceof Error ? e.message : "erro de rede" };
    }
  }

  async disconnect(): Promise<void> {
    await this.call("", undefined, "DELETE");
  }
}
