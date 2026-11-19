import { verifySharedSecret } from "../webhooks/verify";
import { buttonsAsText, jidToE164, type InboundMessage, type MessagingProvider, type ProviderHealth, type ReceiveResult, type SendResult } from "./types";

export interface EvolutionConfig {
  baseUrl: string;
  /** Token da PRÓPRIA instância (não a chave global): a Evolution o aceita só para esta instância. */
  instanceToken: string;
  instance: string;
  webhookSecret: string;
  /** Botões nativos dependem da versão/conta; desativado por padrão (fallback textual). Para botões, usar Whaileys. */
  interactiveEnabled?: boolean;
}

type FetchLike = typeof fetch;

interface EvolutionMessageData {
  key?: { id?: string; remoteJid?: string; fromMe?: boolean; remoteJidAlt?: string; senderPn?: string };
  message?: Record<string, unknown> & { base64?: string };
  messageType?: string;
  messageTimestamp?: number;
}

/** Remetente em E.164: `remoteJid` de telefone; se for `@lid`, usa `remoteJidAlt`/`senderPn`. */
export function evolutionSender(key: EvolutionMessageData["key"]): string | null {
  const jid = key?.remoteJid ?? "";
  if (jid.endsWith("@s.whatsapp.net")) return jidToE164(jid);
  const alt = key?.remoteJidAlt ?? key?.senderPn;
  return alt ? jidToE164(alt) : null;
}

/**
 * Adaptador Evolution API v2 (validado contra a 2.3.7 da VM compartilhada: rotas e formato do webhook).
 * Webhook autenticado pelo header `x-evo-secret` (a Evolution não assina o corpo); o campo `apikey`
 * do corpo é ignorado. Mídia chega em base64 no próprio webhook (`webhookBase64: true`).
 * A sessão WhatsApp roda em host persistente, NUNCA na Vercel.
 */
export class EvolutionProvider implements MessagingProvider {
  readonly name = "evolution" as const;

  constructor(private readonly cfg: EvolutionConfig, private readonly fetchImpl: FetchLike = fetch) {}

  private url(path: string) {
    return `${this.cfg.baseUrl.replace(/\/$/, "")}${path}/${encodeURIComponent(this.cfg.instance)}`;
  }

  private async call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await this.fetchImpl(this.url(path), {
        method,
        headers: { apikey: this.cfg.instanceToken, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      let json: Record<string, unknown> = {};
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch {
        // sem corpo
      }
      return { status: res.status, json };
    } finally {
      clearTimeout(timer);
    }
  }

  async receive(rawBody: string, headers: Headers): Promise<ReceiveResult> {
    // Segredo configurado no webhook da instância (header x-evo-secret). Sem segredo no servidor, nunca aceita.
    const check = verifySharedSecret(headers.get("x-evo-secret"), this.cfg.webhookSecret);
    if (!this.cfg.webhookSecret || !check.ok) return { verified: false, reason: check.ok ? "segredo não configurado" : check.reason, events: [] };

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { verified: true, reason: "json inválido", events: [] };
    }
    // O campo `apikey` do corpo é deliberadamente ignorado (nunca usado nem registrado).
    if (payload.instance !== this.cfg.instance) return { verified: true, reason: "instância diferente", events: [] };
    const event = String(payload.event ?? "").toLowerCase().replace("_", ".");
    if (event !== "messages.upsert") return { verified: true, reason: `evento ignorado: ${event}`, events: [] };

    const items = Array.isArray(payload.data) ? payload.data : [payload.data];
    const events: InboundMessage[] = [];
    for (const raw of items) {
      const d = raw as EvolutionMessageData;
      const id = d?.key?.id;
      const jid = d?.key?.remoteJid ?? "";
      if (!id || !jid || jid.endsWith("@g.us") || jid === "status@broadcast") continue; // ignora grupos e status
      const from = evolutionSender(d.key);
      if (!from) continue;
      const m = d.message ?? {};
      const image = m.imageMessage as { mimetype?: string; caption?: string } | undefined;
      const audio = m.audioMessage as { mimetype?: string } | undefined;
      const document = m.documentMessage as { mimetype?: string; caption?: string } | undefined;
      const text =
        (m.conversation as string | undefined) ??
        ((m.extendedTextMessage as { text?: string } | undefined)?.text) ??
        ((m.buttonsResponseMessage as { selectedButtonId?: string; selectedDisplayText?: string } | undefined)?.selectedButtonId) ??
        ((m.listResponseMessage as { singleSelectReply?: { selectedRowId?: string } } | undefined)?.singleSelectReply?.selectedRowId) ??
        image?.caption ??
        document?.caption;
      const mediaMime = (audio ?? image)?.mimetype?.split(";")[0];
      events.push({
        provider: "evolution",
        providerMessageId: id,
        from,
        fromMe: Boolean(d.key?.fromMe),
        type: audio ? "audio" : image ? "image" : text ? "text" : "other",
        text,
        mediaRef: audio || image ? { id, mimeType: mediaMime } : undefined,
        // Com webhookBase64 a mídia já vem no evento; sem ela, downloadMedia busca na API.
        inlineMedia: (audio || image) && typeof m.base64 === "string" && mediaMime ? { mimeType: mediaMime, base64: m.base64 } : undefined,
        timestamp: d.messageTimestamp ? new Date(Number(d.messageTimestamp) * 1000) : new Date(),
      });
    }
    return { verified: true, events, eventId: events[0]?.providerMessageId ?? null };
  }

  async sendText(to: string, text: string): Promise<SendResult> {
    try {
      const { status, json } = await this.call("POST", "/message/sendText", { number: to.replace(/^\+/, ""), text });
      const key = json.key as { id?: string } | undefined;
      if (status < 300) return { ok: true, providerMessageId: key?.id };
      return { ok: false, error: status === 401 ? "Token da instância inválido." : `HTTP ${status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "erro de rede" };
    }
  }

  async sendInteractiveIfSupported(to: string, text: string, buttons: { id: string; title: string }[]): Promise<SendResult> {
    if (!this.cfg.interactiveEnabled) {
      const r = await this.sendText(to, buttonsAsText(text, buttons));
      return { ...r, unsupported: true };
    }
    try {
      const { status, json } = await this.call("POST", "/message/sendButtons", {
        number: to.replace(/^\+/, ""),
        title: "GEMA AI",
        description: text,
        buttons: buttons.map((b) => ({ type: "reply", displayText: b.title, id: b.id })),
      });
      if (status < 300) return { ok: true, providerMessageId: (json.key as { id?: string } | undefined)?.id };
    } catch {
      // cai no fallback textual
    }
    const r = await this.sendText(to, buttonsAsText(text, buttons));
    return { ...r, unsupported: true };
  }

  async sendMediaIfSupported(to: string, media: { url: string; mimeType: string; caption?: string }): Promise<SendResult> {
    const mediatype = media.mimeType.startsWith("image") ? "image" : media.mimeType.startsWith("audio") ? "audio" : "document";
    try {
      const { status, json } = await this.call("POST", "/message/sendMedia", {
        number: to.replace(/^\+/, ""), mediatype, mimetype: media.mimeType, media: media.url, caption: media.caption,
      });
      return status < 300 ? { ok: true, providerMessageId: (json.key as { id?: string } | undefined)?.id } : { ok: false, error: `HTTP ${status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "erro de rede" };
    }
  }

  async downloadMedia(msg: InboundMessage): Promise<{ base64: string; mimeType: string } | null> {
    if (msg.inlineMedia) return msg.inlineMedia;
    try {
      const { status, json } = await this.call("POST", "/chat/getBase64FromMediaMessage", { message: { key: { id: msg.providerMessageId } }, convertToMp4: false });
      if (status >= 300 || typeof json.base64 !== "string") return null;
      return { base64: json.base64, mimeType: (json.mimetype as string) ?? msg.mediaRef?.mimeType ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async ack(): Promise<void> {
    // Evolution não exige ack explícito; leitura pode ser marcada via /chat/markMessageAsRead (opcional).
  }

  async health(): Promise<ProviderHealth> {
    try {
      const { status, json } = await this.call("GET", "/instance/connectionState");
      if (status >= 300) return { status: "error", detail: `HTTP ${status}` };
      const state = (json.instance as { state?: string } | undefined)?.state ?? (json.state as string | undefined);
      return state === "open" ? { status: "connected" } : { status: "disconnected", detail: state ?? "desconhecido" };
    } catch (e) {
      return { status: "error", detail: e instanceof Error ? e.message : "erro de rede" };
    }
  }

  async disconnect(): Promise<void> {
    await this.call("DELETE", "/instance/logout");
  }
}
