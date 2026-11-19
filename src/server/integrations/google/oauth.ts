import { createHash } from "node:crypto";
import type { Database } from "@/lib/db/types";
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from "@/lib/crypto";

/** Escopos mínimos por produto (incremental: o usuário autoriza só o que ativar). */
export const GOOGLE_SCOPES = {
  calendar: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"],
  contacts: ["https://www.googleapis.com/auth/contacts"],
} as const;

export type GoogleProduct = keyof typeof GOOGLE_SCOPES;
const PROVIDER: Record<GoogleProduct, "google_calendar" | "google_contacts"> = { calendar: "google_calendar", contacts: "google_contacts" };

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
}

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope: string;
}

type FetchLike = typeof fetch;

/** Inicia o fluxo: state aleatório (hash persistido, uso único, 10 min) + PKCE S256. */
export async function startGoogleOAuth(db: Database, cfg: GoogleOAuthConfig, userId: string, workspaceId: string, product: GoogleProduct): Promise<string> {
  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  await db.asService((q) =>
    q.query(
      `insert into oauth_states (state_hash, user_id, workspace_id, provider, code_verifier, expires_at)
       values ($1, $2, $3, $4, $5, now() + interval '10 minutes')`,
      [sha256Hex(state), userId, workspaceId, PROVIDER[product], encryptSecret(verifier, cfg.encryptionKey)],
    ),
  );
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES[product].join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export type CallbackResult = { ok: true; provider: string; workspaceId: string } | { ok: false; error: string };

/**
 * Callback: valida state (pertence ao usuário da sessão, não expirado, uso único), troca o code
 * com PKCE, cifra tokens (AES-256-GCM) e marca a integração como conectada.
 */
export async function completeGoogleOAuth(
  db: Database,
  cfg: GoogleOAuthConfig,
  sessionUserId: string,
  params: { state: string | null; code: string | null; error: string | null },
  fetchImpl: FetchLike = fetch,
): Promise<CallbackResult> {
  if (params.error) return { ok: false, error: params.error === "access_denied" ? "Autorização negada pelo usuário." : "Erro retornado pelo Google." };
  if (!params.state || !params.code) return { ok: false, error: "Parâmetros ausentes." };

  const [st] = await db.asService((q) =>
    q.query<{ user_id: string; workspace_id: string; provider: string; code_verifier: string }>(
      "delete from oauth_states where state_hash = $1 and expires_at > now() returning user_id, workspace_id, provider, code_verifier",
      [sha256Hex(params.state!)],
    ),
  );
  if (!st) return { ok: false, error: "Sessão de autorização inválida ou expirada." };
  if (st.user_id !== sessionUserId) return { ok: false, error: "Autorização iniciada por outro usuário." };

  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
      code_verifier: decryptSecret(st.code_verifier, cfg.encryptionKey),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const token = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!res.ok || !token.access_token) {
    await setIntegrationStatus(db, st.user_id, st.workspace_id, st.provider, "error", token.error ?? `HTTP ${res.status}`);
    return { ok: false, error: "Falha ao trocar o código de autorização." };
  }

  const stored: StoredTokens = {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: Date.now() + (token.expires_in ?? 3600) * 1000,
    scope: token.scope ?? "",
  };
  await db.asService(async (q) => {
    const [integ] = await q.query<{ id: string }>(
      `insert into integrations (workspace_id, user_id, provider, status, scopes, connected_at, last_error)
       values ($1, $2, $3, 'connected', $4, now(), null)
       on conflict (workspace_id, user_id, provider) do update set status = 'connected', scopes = excluded.scopes, connected_at = now(), last_error = null
       returning id`,
      [st.workspace_id, st.user_id, st.provider, stored.scope.split(" ").filter(Boolean)],
    );
    // Preserva refresh_token anterior se o Google não reenviar.
    const [prev] = await q.query<{ ciphertext: string }>("select ciphertext from encrypted_oauth_tokens where integration_id = $1", [integ.id]);
    if (!stored.refresh_token && prev) {
      stored.refresh_token = (JSON.parse(decryptSecret(prev.ciphertext, cfg.encryptionKey)) as StoredTokens).refresh_token;
    }
    await q.query(
      `insert into encrypted_oauth_tokens (integration_id, ciphertext, expires_at) values ($1, $2, $3)
       on conflict (integration_id) do update set ciphertext = excluded.ciphertext, expires_at = excluded.expires_at`,
      [integ.id, encryptSecret(JSON.stringify(stored), cfg.encryptionKey), new Date(stored.expires_at)],
    );
    await q.query(
      "insert into audit_logs (workspace_id, actor_id, actor_type, action, resource_type, resource_id) values ($1, $2, 'user', 'integration.connected', 'integration', $3)",
      [st.workspace_id, st.user_id, st.provider],
    );
  });
  return { ok: true, provider: st.provider, workspaceId: st.workspace_id };
}

async function setIntegrationStatus(db: Database, userId: string, workspaceId: string, provider: string, status: string, error: string | null) {
  await db.asService((q) =>
    q.query(
      `insert into integrations (workspace_id, user_id, provider, status, last_error) values ($1, $2, $3, $4, $5)
       on conflict (workspace_id, user_id, provider) do update set status = excluded.status, last_error = excluded.last_error`,
      [workspaceId, userId, provider, status, error],
    ),
  );
}

/** Token de acesso válido (renova com refresh_token quando necessário). null se não conectado. */
export async function getAccessToken(db: Database, cfg: GoogleOAuthConfig, userId: string, workspaceId: string, product: GoogleProduct, fetchImpl: FetchLike = fetch): Promise<string | null> {
  const [row] = await db.asService((q) =>
    q.query<{ id: string; ciphertext: string }>(
      `select i.id, t.ciphertext from integrations i join encrypted_oauth_tokens t on t.integration_id = i.id
       where i.user_id = $1 and i.workspace_id = $2 and i.provider = $3 and i.status = 'connected'`,
      [userId, workspaceId, PROVIDER[product]],
    ),
  );
  if (!row) return null;
  const tokens = JSON.parse(decryptSecret(row.ciphertext, cfg.encryptionKey)) as StoredTokens;
  if (tokens.expires_at - 60_000 > Date.now()) return tokens.access_token;
  if (!tokens.refresh_token) {
    await setIntegrationStatus(db, userId, workspaceId, PROVIDER[product], "error", "Token expirado sem refresh_token; reconecte.");
    return null;
  }
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: tokens.refresh_token, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15_000),
  });
  const fresh = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !fresh.access_token) {
    await setIntegrationStatus(db, userId, workspaceId, PROVIDER[product], "error", fresh.error === "invalid_grant" ? "Autorização revogada no Google; reconecte." : "Falha ao renovar token.");
    return null;
  }
  const updated: StoredTokens = { ...tokens, access_token: fresh.access_token, expires_at: Date.now() + (fresh.expires_in ?? 3600) * 1000 };
  await db.asService((q) =>
    q.query("update encrypted_oauth_tokens set ciphertext = $2, expires_at = $3 where integration_id = $1", [row.id, encryptSecret(JSON.stringify(updated), cfg.encryptionKey), new Date(updated.expires_at)]),
  );
  return updated.access_token;
}

/** Revoga no Google (best-effort) e REMOVE tokens localmente. */
export async function revokeGoogle(db: Database, cfg: GoogleOAuthConfig, userId: string, workspaceId: string, product: GoogleProduct, fetchImpl: FetchLike = fetch) {
  const [row] = await db.asService((q) =>
    q.query<{ id: string; ciphertext: string | null }>(
      `select i.id, t.ciphertext from integrations i left join encrypted_oauth_tokens t on t.integration_id = i.id
       where i.user_id = $1 and i.workspace_id = $2 and i.provider = $3`,
      [userId, workspaceId, PROVIDER[product]],
    ),
  );
  if (!row) return;
  if (row.ciphertext) {
    try {
      const t = JSON.parse(decryptSecret(row.ciphertext, cfg.encryptionKey)) as StoredTokens;
      await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refresh_token ?? t.access_token)}`, { method: "POST", signal: AbortSignal.timeout(10_000) });
    } catch {
      // revogação remota é best-effort; tokens locais são removidos de qualquer forma
    }
  }
  await db.asService(async (q) => {
    await q.query("delete from encrypted_oauth_tokens where integration_id = $1", [row.id]);
    await q.query("update integrations set status = 'revoked', scopes = '{}' where id = $1", [row.id]);
    await q.query("insert into audit_logs (workspace_id, actor_id, actor_type, action, resource_type, resource_id) values ($1, $2, 'user', 'integration.revoked', 'integration', $3)", [workspaceId, userId, PROVIDER[product]]);
  });
}
