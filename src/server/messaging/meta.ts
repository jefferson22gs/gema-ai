import { verifyMetaSignature } from "../webhooks/verify";
import type { InboundMessage, MessagingProvider, ProviderHealth, ReceiveResult, SendResult } from "./types";

export interface MetaCloudConfig {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  graphVersion?: string;
}

type FetchLike = typeof fetch;

/**
 * WhatsApp Cloud API oficial (Meta). Mensagens livres só dentro da janela de atendimento de 24h;
 * fora dela, apenas templates aprovados (ver docs/WHATSAPP_PROVIDERS.md).
 */
export class MetaCloudProvider implements MessagingProvider {
  readonly name = "meta_cloud" as const;
  private readonly base: string;

  constructor(private readonly cfg: MetaCloudConfig, private readonly fetchImpl: FetchLike = fetch) {
    this.base = `https://graph.facebook.com/${cfg.graphVersion ?? "v21.0"}`;
  }

  private async graph(method: string, path: string, body?: unknown) {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.cfg.accessToken}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      // sem corpo
    }
    return { status: res.status, json };
  }

  async receive(rawBody: string, headers: Headers): Promise<ReceiveResult> {
    const check = verifyMetaSignature(rawBody, headers.get("x-hub-signature-256"), this.cfg.appSecret);
    if (!check.ok) return { verified: false, reason: check.reason, events: [] };
    let payload: { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string }; messages?: Record<string, unknown>[] } }[] }[] };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { verified: true, reason: "json inválido", events: [] };
    }
    const events: InboundMessage[] = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (value?.metadata?.phone_number_id && value.metadata.phone_number_id !== this.cfg.phoneNumberId) continue;
        for (const m of value?.messages ?? []) {
          const msg = m as {
            id: string; from: string; timestamp?: string; type: string;
            text?: { body?: string }; audio?: { id: string; mime_type?: string }; image?: { id: string; mime_type?: string; caption?: string };
            interactive?: { button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
            button?: { text?: string };
          };
          const interactive = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
          events.push({
            provider: "meta_cloud",
            providerMessageId: msg.id,
            from: `+${msg.from.replace(/\D/g, "")}`,
            fromMe: false,
            type: msg.type === "text" ? "text" : msg.type === "audio" ? "audio" : msg.type === "image" ? "image" : interactive || msg.button ? "interactive_reply" : "other",
            text: msg.text?.body ?? interactive?.title ?? msg.button?.text ?? msg.image?.caption,
            mediaRef: msg.audio ? { id: msg.audio.id, mimeType: msg.audio.mime_type } : msg.image ? { id: msg.image.id, mimeType: msg.image.mime_type } : undefined,
            timestamp: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date(),
          });
        }
      }
    }
    return { verified: true, events, eventId: events[0]?.providerMessageId ?? null };
  }

  private async send(body: Record<string, unknown>): Promise<SendResult> {
    try {
      const { status, json } = await this.graph("POST", `/${this.cfg.phoneNumberId}/messages`, { messaging_product: "whatsapp", ...body });
      const id = (json.messages as { id?: string }[] | undefined)?.[0]?.id;
      if (status < 300 && id) return { ok: true, providerMessageId: id };
      const err = (json.error as { message?: string } | undefined)?.message ?? `HTTP ${status}`;
      return { ok: false, error: err };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "erro de rede" };
    }
  }

  sendText(to: string, text: string) {
    return this.send({ to: to.replace(/^\+/, ""), type: "text", text: { body: text.slice(0, 4096) } });
  }

  sendInteractiveIfSupported(to: string, text: string, buttons: { id: string; title: string }[]) {
    // Cloud API suporta até 3 botões de resposta rápida.
    return this.send({
      to: to.replace(/^\+/, ""),
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: text.slice(0, 1024) },
        action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
      },
    });
  }

  sendMediaIfSupported(to: string, media: { url: string; mimeType: string; caption?: string }) {
    const type = media.mimeType.startsWith("image") ? "image" : media.mimeType.startsWith("audio") ? "audio" : "document";
    return this.send({ to: to.replace(/^\+/, ""), type, [type]: { link: media.url, caption: type === "audio" ? undefined : media.caption } });
  }

  async downloadMedia(msg: InboundMessage): Promise<{ base64: string; mimeType: string } | null> {
    if (!msg.mediaRef) return null;
    try {
      const meta = await this.graph("GET", `/${msg.mediaRef.id}`);
      const url = meta.json.url as string | undefined;
      if (!url) return null;
      const res = await this.fetchImpl(url, { headers: { authorization: `Bearer ${this.cfg.accessToken}` }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return { base64: buf.toString("base64"), mimeType: (meta.json.mime_type as string) ?? msg.mediaRef.mimeType ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async ack(msg: InboundMessage): Promise<void> {
    await this.graph("POST", `/${this.cfg.phoneNumberId}/messages`, { messaging_product: "whatsapp", status: "read", message_id: msg.providerMessageId }).catch(() => undefined);
  }

  async health(): Promise<ProviderHealth> {
    try {
      const { status, json } = await this.graph("GET", `/${this.cfg.phoneNumberId}?fields=verified_name,quality_rating`);
      return status < 300 ? { status: "connected", detail: String(json.verified_name ?? "") } : { status: "error", detail: `HTTP ${status}` };
    } catch (e) {
      return { status: "error", detail: e instanceof Error ? e.message : "erro de rede" };
    }
  }

  async disconnect(): Promise<void> {
    // Cloud API: desconexão é administrativa no Meta Business Manager; nada a fazer via API aqui.
  }
}
