import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Criptografia simétrica AES-256-GCM para tokens OAuth (server-only).
 * Chave: OAUTH_ENCRYPTION_KEY em base64 (32 bytes). Formato: v<versão>.<iv>.<tag>.<ciphertext> (base64url).
 */
const KEY_VERSION = 1;

function decodeKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("OAUTH_ENCRYPTION_KEY deve ter 32 bytes em base64");
  return key;
}

export function encryptSecret(plaintext: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", decodeKey(keyB64), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [`v${KEY_VERSION}`, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, keyB64: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== `v${KEY_VERSION}` || !iv || !tag || !data) throw new Error("payload cifrado inválido");
  const decipher = createDecipheriv("aes-256-gcm", decodeKey(keyB64), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256Hex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function hmacSha256Base64(secret: string | Buffer, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

/** Comparação em tempo constante (evita timing attacks em segredos/assinaturas). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Código numérico de verificação (ex.: posse de telefone). */
export function randomNumericCode(digits = 6): string {
  const max = 10 ** digits;
  const n = randomBytes(4).readUInt32BE(0) % max;
  return String(n).padStart(digits, "0");
}
