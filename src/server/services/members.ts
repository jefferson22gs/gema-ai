import type { Queryable } from "@/lib/db/types";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { DomainError } from "../context";
import { requireEntitlement, requireUnderLimit } from "../billing/plans";

export const ROLES = ["admin", "manager", "finance", "accountant", "member", "family", "viewer"] as const;
export type InviteRole = (typeof ROLES)[number];

export const ROLE_LABEL: Record<string, string> = {
  owner: "Proprietário", admin: "Administrador", manager: "Gestor", finance: "Financeiro", accountant: "Contador",
  member: "Colaborador", family: "Familiar", viewer: "Visualizador",
};

export const MODULES = ["finance", "banking", "calendar", "tasks", "contacts", "documents", "automations", "crm", "fiscal", "reports", "members", "settings"] as const;
export const ACTIONS = ["read", "write", "delete", "export", "manage"] as const;

const INVITE_TTL_DAYS = 7;

/** Cria convite (sob RLS: exige members.manage). Retorna o token em claro UMA vez para o link. */
export async function createInvitation(
  q: Queryable,
  input: { workspaceId: string; invitedBy: string; email: string; role: InviteRole; permissions?: Record<string, Record<string, boolean>> },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("invalid", "E-mail inválido.");
  if (!ROLES.includes(input.role)) throw new DomainError("invalid", "Papel inválido.");
  const [ws] = await q.query<{ kind: string }>("select kind from workspaces where id = $1", [input.workspaceId]);
  if (!ws) throw new DomainError("not_found", "Workspace não encontrado.");
  if (ws.kind === "personal") throw new DomainError("invalid", "O workspace pessoal não aceita membros. Crie um workspace de família ou empresa.");
  await requireEntitlement(q, input.workspaceId, "team", "Convidar membros");
  const [counts] = await q.query<{ n: number }>(
    `select ((select count(*) from workspace_members where workspace_id = $1)
           + (select count(*) from workspace_invitations where workspace_id = $1 and lower(email) <> $2
                and accepted_at is null and revoked_at is null and expires_at > now()))::int as n`,
    [input.workspaceId, email],
  );
  await requireUnderLimit(q, input.workspaceId, "members", counts.n, "membros (incluindo convites pendentes)");
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  // Convite anterior pendente para o mesmo e-mail é revogado (um convite ativo por pessoa).
  await q.query("update workspace_invitations set revoked_at = now() where workspace_id = $1 and lower(email) = $2 and accepted_at is null and revoked_at is null", [input.workspaceId, email]);
  const [row] = await q.query<{ id: string }>(
    `insert into workspace_invitations (workspace_id, email, role, token_hash, invited_by, expires_at, permissions)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [input.workspaceId, email, input.role, sha256Hex(token), input.invitedBy, expiresAt, JSON.stringify(input.permissions ?? {})],
  );
  await q.query("select public.write_audit($1, 'user', 'workspace.invitation.created', 'workspace_invitation', $2, $3)", [input.workspaceId, row.id, JSON.stringify({ role: input.role })]);
  return { id: row.id, token, expiresAt };
}

export async function acceptInvitation(q: Queryable, token: string): Promise<string> {
  try {
    const [row] = await q.query<{ workspace_id: string }>("select public.accept_invitation($1) as workspace_id", [sha256Hex(token)]);
    return row.workspace_id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/expirado/.test(msg)) throw new DomainError("invalid", "Este convite expirou. Peça um novo ao administrador.");
    if (/outro e-mail/.test(msg)) throw new DomainError("forbidden", "Este convite foi enviado para outro e-mail. Entre com a conta convidada.");
    if (/inválido|utilizado/.test(msg)) throw new DomainError("invalid", "Convite inválido ou já utilizado.");
    throw e;
  }
}

export async function listInvitations(q: Queryable, workspaceId: string) {
  return q.query<{ id: string; email: string; role: string; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null; created_at: Date }>(
    "select id, email, role, expires_at, accepted_at, revoked_at, created_at from workspace_invitations where workspace_id = $1 order by created_at desc limit 50",
    [workspaceId],
  );
}

export async function revokeInvitation(q: Queryable, workspaceId: string, id: string) {
  const rows = await q.query("update workspace_invitations set revoked_at = now() where id = $1 and workspace_id = $2 and accepted_at is null returning id", [id, workspaceId]);
  return rows.length > 0;
}

export async function updateMemberRole(q: Queryable, workspaceId: string, userId: string, role: InviteRole) {
  if (!ROLES.includes(role)) throw new DomainError("invalid", "Papel inválido.");
  const rows = await q.query("update workspace_members set role = $3 where workspace_id = $1 and user_id = $2 and role <> 'owner' returning user_id", [workspaceId, userId, role]);
  if (!rows.length) throw new DomainError("forbidden", "Sem permissão para alterar este membro.");
  await q.query("select public.write_audit($1, 'user', 'workspace.member.role_changed', 'workspace_member', $2, $3)", [workspaceId, userId, JSON.stringify({ role })]);
}

/** Remoção/revogação de acesso de um membro (teste 9). Dados privados dele continuam dele. */
export async function removeMember(q: Queryable, workspaceId: string, userId: string) {
  const rows = await q.query("delete from workspace_members where workspace_id = $1 and user_id = $2 and role <> 'owner' returning user_id", [workspaceId, userId]);
  if (!rows.length) throw new DomainError("forbidden", "Sem permissão para remover este membro.");
  await q.query("select public.write_audit($1, 'user', 'workspace.member.removed', 'workspace_member', $2, '{}'::jsonb)", [workspaceId, userId]);
}

export async function myPermissions(q: Queryable, workspaceId: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const m of MODULES) {
    const rows = await q.query<{ a: string }>(
      "select a from unnest($2::text[]) as a where app.can($1, $3, a)",
      [workspaceId, [...ACTIONS], m],
    );
    out[m] = rows.map((r) => r.a);
  }
  return out;
}
