import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { handleWhatsAppWebhook } from "@/server/messaging/webhook-route";
import { metaProvider } from "@/server/runtime";

/** Verificação de assinatura do webhook pela Meta (hub.challenge). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = env.metaVerifyToken();
  const provided = url.searchParams.get("hub.verify_token");
  if (url.searchParams.get("hub.mode") === "subscribe" && token && provided && safeEqual(provided, token)) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  return handleWhatsAppWebhook(req, metaProvider(), "WhatsApp Cloud API");
}
