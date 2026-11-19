import { verifySharedSecret } from "../webhooks/verify";
import { buttonsAsText, jidToE164, type InboundMessage, type MessagingProvider, type ProviderHealth, type ReceiveResult, type SendResult } from "./types";

export interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
  instance: string;
  webhookSecret: string;
  /** Botões nativos dependem da versão/conta; desativado por padrão (fallback textual). */
  interactiveEnabled?: boolean;
}

type FetchLike = typeof fetch;

/**
 * Adaptador Evolution API (v2). Endpoints conforme documentação pública da Evolution API v2
 * (ver docs/ASSUMPTIONS.md — validar contra a versão efetivamente implantada).
 * A sessão WhatsApp roda no host persistente (infra/evolution), NUNCA na Vercel.
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
        headers: { apikey: this.cfg.apiKey, "content-type": "application/json" },
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
    // Segredo enviado pela Evolution via header customizado configurado no webhook da instância.
    const check = verifySharedSecret(headers.get("x-gema-webhook-secret") ?? headers.get("apikey"), this.cfg.webhookSecret);
    if (!check.ok) return { verified: false, reason: check.reason, events: [] };

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { verified: true, reason: "json inválido", events: [] };
    }
    if (payload.instance && payload.instance !== this.cfg.instance) return { verified: true, reason: "instância diferente", events: [] };
    const event = String(payload.event ?? "").toLowerCase().replace("_", ".");
    if (event !== "messages.upsert") return { verified: true, reason: `evento ignorado: ${event}`, events: [] };

    const items = Array.isArray(payload.data) ? payload.data : [payload.data];
    const events: InboundMessage[] = [];
    for (const raw of items) {
      const d = raw as {
        key?: { id?: string; remoteJid?: string; fromMe?: boolean };
        message?: Record<string, unknown>;
        messageType?: string;
        messageTimestamp?: number;
      };
      const id = d?.key?.id;
      const jid = d?.key?.remoteJid ?? "";
      if (!id || !jid || jid.endsWith("@g.us") || jid === "status@broadcast") continue; // ignora grupos e status
      const from = jidToE164(jid);
      if (!from) continue;
      const m = d.message ?? {};
      const text =
        (m.conversation as string | undefined) ??
        ((m.extendedTextMessage as { text?: string } | undefined)?.text) ??
        ((m.buttonsResponseMessage as { selectedDisplayText?: string } | undefined)?.selectedDisplayText) ??
        ((m.listResponseMessage as { title?: string } | undefined)?.title);
      const audio = m.audioMessage as { mimetype?: string } | undefined;
      const image = m.imageMessage as { mimetype?: string; caption?: string } | undefined;
      events.push({
        provider: "evolution",
        providerMessageId: id,
        from,
        fromMe: Boolean(d.key?.fromMe),
        type: audio ? "audio" : image ? "image" : text ? "text" : "other",
        text: text ?? image?.caption,
        mediaRef: audio || image ? { id, mimeType: (audio ?? image)?.mimetype } : undefined,
        timestamp: d.messageTimestamp ? new Date(Number(d.messageTimestamp) * 1000) : new Date(),
      });
    }
    return { verified: true, events, eventId: events[0]?.providerMessageId ?? null };
  }

  async sendText(to: string, text: string): Promise<SendResult> {
    try {
      const { status, json } = await this.call("POST", "/message/sendText", { number: to.replace(/^\+/, ""), text });
      const key = json.key as { id?: string } | undefined;
      return status < 300 ? { ok: true, providerMessageId: key?.id } : { ok: false, error: `HTTP ${status}` };
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
