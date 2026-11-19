import { hmacSha256Base64, hmacSha256Hex, safeEqual } from "@/lib/crypto";

export type VerifyResult = { ok: true } | { ok: false; reason: string };

const TOLERANCE_SECONDS = 5 * 60;

/** Meta (WhatsApp Cloud API): header X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app_secret, corpo bruto). */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): VerifyResult {
  if (!header?.startsWith("sha256=")) return { ok: false, reason: "assinatura ausente" };
  const expected = `sha256=${hmacSha256Hex(appSecret, rawBody)}`;
  return safeEqual(expected, header) ? { ok: true } : { ok: false, reason: "assinatura inválida" };
}

/**
 * Resend (Svix): headers svix-id, svix-timestamp, svix-signature ("v1,<base64> ...").
 * Segredo "whsec_<base64>". Assinatura = HMAC-SHA256(secret, `${id}.${timestamp}.${body}`).
 */
export function verifySvixSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifyResult {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "headers svix ausentes" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return { ok: false, reason: "timestamp fora da janela (replay)" };
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = hmacSha256Base64(key, `${id}.${timestamp}.${rawBody}`);
  const provided = signature.split(" ").map((s) => s.split(",")[1]).filter(Boolean);
  return provided.some((p) => safeEqual(p, expected)) ? { ok: true } : { ok: false, reason: "assinatura inválida" };
}

/** Segredo compartilhado em header (Evolution API / Brevo): comparação em tempo constante. */
export function verifySharedSecret(provided: string | null, expected: string): VerifyResult {
  if (!provided) return { ok: false, reason: "segredo ausente" };
  return safeEqual(provided, expected) ? { ok: true } : { ok: false, reason: "segredo inválido" };
}

/** Billing genérico: header "t=<ts>,v1=<hex>" com HMAC-SHA256(secret, `${t}.${body}`). */
export function verifyTimestampedHmac(rawBody: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): VerifyResult {
  if (!header) return { ok: false, reason: "assinatura ausente" };
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const ts = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(ts)) return { ok: false, reason: "assinatura malformada" };
  if (Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return { ok: false, reason: "timestamp fora da janela (replay)" };
  return safeEqual(hmacSha256Hex(secret, `${parts.t}.${rawBody}`), parts.v1) ? { ok: true } : { ok: false, reason: "assinatura inválida" };
}
