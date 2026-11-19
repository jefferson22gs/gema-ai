import "server-only";
import { env } from "@/lib/env";

/** Web Push (VAPID). null quando as chaves não estão configuradas. */
export function sendWebPush() {
  const pub = env.vapidPublicKey();
  const priv = env.vapidPrivateKey();
  if (!pub || !priv) return null;
  return async (sub: { endpoint: string; p256dh: string; auth: string }, payload: string) => {
    const webpush = await import("web-push");
    webpush.setVapidDetails(`mailto:${env.emailFrom()?.match(/<(.+)>/)?.[1] ?? "suporte@example.com"}`, pub, priv);
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600 });
      return { ok: true };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      return { ok: false, gone: status === 404 || status === 410 };
    }
  };
}
