import { handleWhatsAppWebhook } from "@/server/messaging/webhook-route";
import { whaileysProvider } from "@/server/runtime";

/**
 * Webhook do motor Whaileys. Assinatura HMAC validada antes de qualquer uso do corpo (inválida => 401).
 * Mensagens são enfileiradas e processadas fora do request; a dedupe por key.id cobre reentregas.
 */
export async function POST(req: Request) {
  return handleWhatsAppWebhook(req, whaileysProvider(), "Whaileys", 12_000_000);
}
