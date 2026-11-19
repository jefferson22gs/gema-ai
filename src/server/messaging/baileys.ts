import type { MessagingProvider, ProviderHealth, ReceiveResult, SendResult } from "./types";

/**
 * BaileysWhaileysProvider — STUB DE CONTRATO.
 * O repositório https://github.com/jefferson22gs/baileys_whaileys_button_list.git estava vazio na
 * verificação de 19/11/2026. Nenhuma classe/função dele é presumida aqui. Este adaptador só será
 * implementado após código real disponível, revisão de compatibilidade e de termos do WhatsApp.
 * Conectores não oficiais podem levar a bloqueio do número — ver docs/WHATSAPP_PROVIDERS.md.
 */
export class BaileysWhaileysProvider implements MessagingProvider {
  readonly name = "baileys_whaileys" as const;
  private static readonly reason = "Adaptador Baileys/Whaileys não implementado: repositório de origem sem código verificável.";

  async receive(): Promise<ReceiveResult> {
    return { verified: false, reason: BaileysWhaileysProvider.reason, events: [] };
  }
  async sendText(): Promise<SendResult> {
    return { ok: false, error: BaileysWhaileysProvider.reason, unsupported: true };
  }
  async sendInteractiveIfSupported(): Promise<SendResult> {
    return { ok: false, error: BaileysWhaileysProvider.reason, unsupported: true };
  }
  async sendMediaIfSupported(): Promise<SendResult> {
    return { ok: false, error: BaileysWhaileysProvider.reason, unsupported: true };
  }
  async ack(): Promise<void> {}
  async health(): Promise<ProviderHealth> {
    return { status: "not_configured", detail: BaileysWhaileysProvider.reason };
  }
  async disconnect(): Promise<void> {}
}
