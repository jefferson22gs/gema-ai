import type { Database } from "@/lib/db/types";
import { randomNumericCode, sha256Hex, safeEqual } from "@/lib/crypto";
import { normalizePhoneE164 } from "../services/contacts";
import { DomainError } from "../context";
import type { MessagingProvider } from "./types";

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

/**
 * Vincula número de WhatsApp à conta SOMENTE após comprovação de posse:
 * envia código pelo próprio canal e exige que o usuário autenticado o informe no painel.
 */
export async function startPhoneVerification(
  deps: { db: Database; provider: MessagingProvider },
  userId: string,
  workspaceId: string,
  rawPhone: string,
): Promise<{ sent: boolean; error?: string }> {
  const phone = normalizePhoneE164(rawPhone);
  if (!phone) throw new DomainError("invalid", "Telefone inválido.");
  const member = await deps.db.asUser(userId, (q) => q.query("select 1 from workspace_members where workspace_id = $1 and user_id = $2", [workspaceId, userId]));
  if (!member.length) throw new DomainError("forbidden", "Workspace inválido.");

  const taken = await deps.db.asService((q) =>
    q.query("select 1 from channel_accounts where provider = $1 and address = $2 and status = 'verified' and user_id <> $3", [deps.provider.name, phone, userId]),
  );
  if (taken.length) throw new DomainError("conflict", "Este número já está vinculado a outra conta.");

  const code = randomNumericCode(6);
  await deps.db.asService(async (q) => {
    await q.query("delete from channel_accounts where user_id = $1 and provider = $2 and status = 'pending_verification'", [userId, deps.provider.name]);
    await q.query(
      `insert into channel_accounts (workspace_id, user_id, provider, address, status, verification_code_hash, verification_expires_at)
       values ($1, $2, $3, $4, 'pending_verification', $5, now() + make_interval(mins => $6))`,
      [workspaceId, userId, deps.provider.name, phone, sha256Hex(`${phone}:${code}`), CODE_TTL_MINUTES],
    );
  });
  // Permite ao provedor associar respostas identificadas só por LID a este número.
  await deps.provider.registerKnownPhones?.([phone]);
  const sent = await deps.provider.sendText(phone, `GEMA AI: seu código de verificação é ${code}. Ele expira em ${CODE_TTL_MINUTES} minutos. Se não foi você, ignore.`);
  return sent.ok ? { sent: true } : { sent: false, error: sent.error ?? "falha no envio" };
}

export async function confirmPhoneVerification(
  db: Database,
  provider: MessagingProvider["name"],
  userId: string,
  code: string,
): Promise<boolean> {
  return db.asService(async (q) => {
    const rows = await q.query<{ id: string; address: string; verification_code_hash: string; verification_attempts: number }>(
      `select id, address, verification_code_hash, verification_attempts from channel_accounts
       where user_id = $1 and provider = $2 and status = 'pending_verification' and verification_expires_at > now()
       for update`,
      [userId, provider],
    );
    const row = rows[0];
    if (!row || row.verification_attempts >= MAX_ATTEMPTS) return false;
    if (!safeEqual(sha256Hex(`${row.address}:${code.trim()}`), row.verification_code_hash)) {
      await q.query("update channel_accounts set verification_attempts = verification_attempts + 1 where id = $1", [row.id]);
      return false;
    }
    await q.query("update channel_accounts set status = 'revoked' where provider = $1 and address = $2 and status = 'verified' and user_id = $3", [provider, row.address, userId]);
    await q.query(
      `update channel_accounts set status = 'verified', verified_at = now(), opted_in_at = now(), verification_code_hash = null where id = $1`,
      [row.id],
    );
    await q.query("update profiles set phone_e164 = $2, phone_verified_at = now() where id = $1", [userId, row.address]);
    await q.query("insert into consent_records (user_id, consent_type, granted, version, source) values ($1, 'whatsapp_optin', true, '2026-11', 'whatsapp_verification')", [userId]);
    return true;
  });
}
