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

// ---------------------------------------------------------------- Vinculação inbound (código enviado pelo usuário)

const LINK_TTL_MINUTES = 15;
const LINK_MAX_FAILS_PER_ADDRESS = 5; // por hora
/** Formato "GEMA-1234-5678": reconhecível na mensagem e com 10^8 combinações. */
const LINK_RE = /\bGEMA[-\s]?(\d{4})[-\s]?(\d{4})\b/i;

export function extractLinkCode(text: string | undefined): string | null {
  const m = text ? LINK_RE.exec(text) : null;
  return m ? `GEMA-${m[1]}-${m[2]}` : null;
}

/** Gera código de uso único no painel (mostrado uma vez). Cancela códigos anteriores do usuário. */
export async function createLinkCode(db: Database, userId: string, workspaceId: string, provider: MessagingProvider["name"]): Promise<{ code: string; expiresAt: Date }> {
  if (provider === "dashboard") throw new DomainError("invalid", "Canal inválido.");
  const member = await db.asUser(userId, (q) => q.query("select 1 from workspace_members where workspace_id = $1 and user_id = $2", [workspaceId, userId]));
  if (!member.length) throw new DomainError("forbidden", "Workspace inválido.");
  const code = `GEMA-${randomNumericCode(4)}-${randomNumericCode(4)}`;
  const expiresAt = new Date(Date.now() + LINK_TTL_MINUTES * 60_000);
  await db.asService(async (q) => {
    await q.query("update channel_link_codes set cancelled_at = now() where user_id = $1 and used_at is null and cancelled_at is null", [userId]);
    await q.query(
      "insert into channel_link_codes (user_id, workspace_id, provider, code_hash, expires_at) values ($1, $2, $3, $4, $5)",
      [userId, workspaceId, provider, sha256Hex(code), expiresAt],
    );
    await q.query(
      "insert into audit_logs (workspace_id, actor_id, actor_type, action, resource_type) values ($1, $2, 'user', 'whatsapp.link_code.created', 'channel_link_code')",
      [workspaceId, userId],
    );
  });
  return { code, expiresAt };
}

export type InboundLinkResult =
  | { status: "linked"; userId: string; replaced: boolean }
  | { status: "invalid" | "expired" | "blocked" | "conflict" };

/**
 * Processa mensagem com código vinda de um número (remetente já autenticado pelo webhook do provedor).
 * Regras: uso único; expiração; até 5 falhas/hora por número; número já vinculado a OUTRA conta ⇒ conflito
 * (precisa desvincular lá antes); troca de número do mesmo usuário revoga o vínculo anterior.
 */
export async function consumeLinkCode(db: Database, provider: MessagingProvider["name"], address: string, code: string): Promise<InboundLinkResult> {
  return db.asService(async (q) => {
    const [fails] = await q.query<{ n: number }>(
      "select count(*)::int as n from channel_link_attempts where provider = $1 and address = $2 and not success and created_at > now() - interval '1 hour'",
      [provider, address],
    );
    if (fails.n >= LINK_MAX_FAILS_PER_ADDRESS) return { status: "blocked" };
    const rows = await q.query<{ id: string; user_id: string; workspace_id: string; expires_at: Date; used_at: Date | null; cancelled_at: Date | null }>(
      "select id, user_id, workspace_id, expires_at, used_at, cancelled_at from channel_link_codes where code_hash = $1 and provider = $2 for update",
      [sha256Hex(code.toUpperCase()), provider],
    );
    const row = rows[0];
    const fail = async (status: "invalid" | "expired" | "conflict") => {
      await q.query("insert into channel_link_attempts (provider, address, success) values ($1, $2, false)", [provider, address]);
      if (row) await q.query("update channel_link_codes set attempts = attempts + 1 where id = $1", [row.id]);
      return { status } as const;
    };
    if (!row || row.used_at || row.cancelled_at) return fail("invalid");
    if (new Date(row.expires_at).getTime() <= Date.now()) return fail("expired");

    const other = await q.query("select 1 from channel_accounts where provider = $1 and address = $2 and status = 'verified' and user_id <> $3", [provider, address, row.user_id]);
    if (other.length) return fail("conflict");

    const previous = await q.query<{ id: string }>(
      `update channel_accounts set status = 'revoked', revoked_at = now(), revoked_reason = 'número alterado pelo titular'
       where user_id = $1 and provider = $2 and status = 'verified' and address <> $3 returning id`,
      [row.user_id, provider, address],
    );
    await q.query("delete from channel_accounts where user_id = $1 and provider = $2 and status = 'pending_verification'", [row.user_id, provider]);
    const existing = await q.query<{ id: string }>("select id from channel_accounts where user_id = $1 and provider = $2 and address = $3 and status = 'verified'", [row.user_id, provider, address]);
    if (!existing.length) {
      await q.query(
        `insert into channel_accounts (workspace_id, user_id, provider, address, status, verified_at, opted_in_at, link_method)
         values ($1, $2, $3, $4, 'verified', now(), now(), 'inbound_code')`,
        [row.workspace_id, row.user_id, provider, address],
      );
    }
    await q.query("update channel_link_codes set used_at = now(), used_by_address = $2 where id = $1", [row.id, address]);
    await q.query("insert into channel_link_attempts (provider, address, success) values ($1, $2, true)", [provider, address]);
    await q.query("update profiles set phone_e164 = $2, phone_verified_at = now() where id = $1", [row.user_id, address]);
    await q.query("insert into consent_records (user_id, consent_type, granted, version, source) values ($1, 'whatsapp_optin', true, '2026-11', 'whatsapp_inbound_code')", [row.user_id]);
    await q.query(
      "insert into audit_logs (workspace_id, actor_id, actor_type, action, resource_type, metadata) values ($1, $2, 'user', 'whatsapp.linked', 'channel_account', $3)",
      [row.workspace_id, row.user_id, JSON.stringify({ method: "inbound_code", replaced: previous.length > 0 })],
    );
    return { status: "linked", userId: row.user_id, replaced: previous.length > 0 };
  });
}

/** Desvinculação pelo titular (revoga e audita). */
export async function unlinkChannel(db: Database, userId: string, channelId: string): Promise<boolean> {
  return db.asService(async (q) => {
    const rows = await q.query<{ workspace_id: string }>(
      "update channel_accounts set status = 'revoked', revoked_at = now(), revoked_reason = 'desvinculado pelo titular' where id = $1 and user_id = $2 and status = 'verified' returning workspace_id",
      [channelId, userId],
    );
    if (rows.length) {
      await q.query("insert into audit_logs (workspace_id, actor_id, actor_type, action, resource_type, resource_id) values ($1, $2, 'user', 'whatsapp.unlinked', 'channel_account', $3)", [rows[0].workspace_id, userId, channelId]);
    }
    return rows.length > 0;
  });
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
