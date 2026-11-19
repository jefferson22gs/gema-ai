/**
 * MessagingProvider — contrato único de canais (WhatsApp Evolution, Meta Cloud API, Baileys/Whaileys, painel).
 * Todo evento recebido é normalizado para `InboundMessage` antes de chegar ao domínio.
 */
export type MessagingProviderName = "evolution" | "meta_cloud" | "baileys_whaileys" | "dashboard";

export interface InboundMessage {
  provider: MessagingProviderName;
  providerMessageId: string;
  /** Endereço do remetente em E.164 (WhatsApp) ou id interno (painel). */
  from: string;
  /** Mensagem enviada pela própria conta/bot (nunca deve ser processada — evita loop). */
  fromMe: boolean;
  type: "text" | "audio" | "image" | "interactive_reply" | "other";
  text?: string;
  /** Referência de mídia específica do provedor (baixada somente se necessário). */
  mediaRef?: { id: string; mimeType?: string };
  /** Mídia já entregue no próprio webhook (ex.: Whaileys), dispensando download. */
  inlineMedia?: { mimeType: string; base64: string };
  timestamp: Date;
}

export interface ReceiveResult {
  verified: boolean;
  reason?: string;
  events: InboundMessage[];
  /** Id do evento do provedor para replay protection (quando existir). */
  eventId?: string | null;
}

export interface InteractiveButton {
  id: string;
  title: string;
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  /** Recurso não suportado pelo provedor/config (ex.: botões) — usar fallback textual. */
  unsupported?: boolean;
}

export interface ProviderHealth {
  status: "connected" | "disconnected" | "not_configured" | "error";
  detail?: string;
}

export interface MessagingProvider {
  readonly name: MessagingProviderName;
  receive(rawBody: string, headers: Headers): Promise<ReceiveResult>;
  sendText(to: string, text: string): Promise<SendResult>;
  sendInteractiveIfSupported(to: string, text: string, buttons: InteractiveButton[]): Promise<SendResult>;
  sendMediaIfSupported(to: string, media: { url: string; mimeType: string; caption?: string }): Promise<SendResult>;
  /** Baixa mídia recebida (áudio/imagem) em base64, quando suportado. */
  downloadMedia?(msg: InboundMessage): Promise<{ base64: string; mimeType: string } | null>;
  ack(msg: InboundMessage): Promise<void>;
  /** Informa números esperados ao provedor (resolve remetentes identificados só por LID). */
  registerKnownPhones?(phonesE164: string[]): Promise<void>;
  health(): Promise<ProviderHealth>;
  disconnect(): Promise<void>;
}

/** Fallback textual para botões: "1) Confirmar  2) Cancelar". */
export function buttonsAsText(text: string, buttons: InteractiveButton[]): string {
  return `${text}\n\n${buttons.map((b, i) => `${i + 1}) ${b.title}`).join("\n")}\nResponda com o número ou o texto da opção.`;
}

/** Normaliza JID/telefone do WhatsApp para E.164 ("5511999998888@s.whatsapp.net" => "+5511999998888"). */
export function jidToE164(jid: string): string | null {
  const digits = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}
