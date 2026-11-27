import { handleWhatsAppWebhook } from "@/server/messaging/webhook-route";
import { evolutionProvider } from "@/server/runtime";

export async function POST(req: Request) {
  // Mídia chega em base64 no próprio webhook (webhookBase64): limite maior.
  return handleWhatsAppWebhook(req, evolutionProvider(), "Evolution API", 12_000_000);
}
