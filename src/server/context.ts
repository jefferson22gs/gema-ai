import type { Queryable } from "@/lib/db/types";

/** Contexto de execução de uma ação: quem age, em qual workspace, timezone e relógio do servidor. */
export interface ActorContext {
  userId: string;
  workspaceId: string;
  timezone: string;
  now: Date;
  /** Origem da ação (painel, WhatsApp, automação). */
  channel: "dashboard" | "whatsapp" | "automation";
}

export interface ServiceDeps {
  q: Queryable;
  ctx: ActorContext;
}

export class DomainError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid" | "conflict" | "forbidden" | "limit" | "not_configured",
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/** Auditoria como usuário (ator forçado a auth.uid() pela função write_audit). */
export async function auditAsUser(
  q: Queryable,
  entry: { workspaceId: string; action: string; resourceType?: string; resourceId?: string; metadata?: Record<string, unknown> },
) {
  await q.query("select public.write_audit($1, 'user', $2, $3, $4, $5)", [
    entry.workspaceId, entry.action, entry.resourceType ?? null, entry.resourceId ?? null, JSON.stringify(entry.metadata ?? {}),
  ]);
}

/** Auditoria de sistema/admin/webhook (service role). */
export async function auditAsService(
  q: Queryable,
  entry: { workspaceId: string | null; actorId: string | null; actorType: "system" | "admin" | "support" | "webhook"; action: string; resourceType?: string; resourceId?: string; metadata?: Record<string, unknown> },
) {
  await q.query(
    `insert into audit_logs (workspace_id, actor_id, actor_type, action, resource_type, resource_id, metadata)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [entry.workspaceId, entry.actorId, entry.actorType, entry.action, entry.resourceType ?? null, entry.resourceId ?? null, JSON.stringify(entry.metadata ?? {})],
  );
}
