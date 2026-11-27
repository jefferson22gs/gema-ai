import type { Database, Queryable } from "@/lib/db/types";
import { DomainError } from "../context";

/**
 * Central de Conversas. Modos:
 *  - ai: IA responde automaticamente;
 *  - human: o titular responde manualmente; IA NÃO responde;
 *  - copilot: IA gera sugestão (não enviada) e o humano decide; IA NÃO envia;
 *  - paused: ninguém responde automaticamente (mensagens ficam registradas).
 * A troca de modo é atômica (lock_version) — impede que IA e humano respondam ao mesmo tempo.
 */
export type ConversationMode = "ai" | "human" | "copilot" | "paused";

export interface InboxConversation {
  id: string;
  channel: string;
  title: string | null;
  mode: ConversationMode;
  lock_version: number;
  last_message_at: Date | null;
  tags: string[];
  unanswered: boolean;
  last_preview: string | null;
}

export async function listInbox(q: Queryable, workspaceId: string, filter: { channel?: string; mode?: ConversationMode; search?: string } = {}): Promise<InboxConversation[]> {
  return q.query<InboxConversation>(
    `select c.id, c.channel, c.title, c.mode, c.lock_version, c.last_message_at, c.tags,
       coalesce((select m.role = 'user' from messages m where m.conversation_id = c.id order by m.created_at desc limit 1), false) as unanswered,
       (select left(m.content, 120) from messages m where m.conversation_id = c.id order by m.created_at desc limit 1) as last_preview
     from conversations c
     where c.workspace_id = $1 and c.owner_id = auth.uid()
       and ($2::text is null or c.channel = $2) and ($3::text is null or c.mode = $3)
       and ($4::text is null or exists (select 1 from messages m where m.conversation_id = c.id and m.content ilike '%' || $4 || '%'))
     order by c.last_message_at desc nulls last limit 100`,
    [workspaceId, filter.channel ?? null, filter.mode ?? null, filter.search?.trim() || null],
  );
}

export async function setMode(q: Queryable, conversationId: string, mode: ConversationMode, expectedVersion: number): Promise<number> {
  try {
    const [r] = await q.query<{ v: number }>("select public.set_conversation_mode($1, $2, $3) as v", [conversationId, mode, expectedVersion]);
    return r.v;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/outra sessão/.test(msg)) throw new DomainError("conflict", "A conversa foi alterada em outra sessão. Recarregue a página.");
    if (/sem permissão/.test(msg)) throw new DomainError("forbidden", "Sem permissão.");
    throw e;
  }
}

/** Modo atual lido no momento da decisão (usado pela ingestão para não responder fora do modo IA). */
export async function currentMode(db: Database, conversationId: string): Promise<ConversationMode> {
  const [row] = await db.asService((q) => q.query<{ mode: ConversationMode }>("select mode from conversations where id = $1", [conversationId]));
  return row?.mode ?? "ai";
}

export async function addNote(q: Queryable, conversationId: string, workspaceId: string, authorId: string, body: string) {
  const text = body.trim();
  if (!text) throw new DomainError("invalid", "Nota vazia.");
  await q.query("insert into conversation_notes (conversation_id, workspace_id, author_id, body) values ($1, $2, $3, $4)", [conversationId, workspaceId, authorId, text.slice(0, 4000)]);
}

/**
 * Concede acesso temporário do suporte às conversas de um workspace. Exige chamado do próprio
 * workspace com autorização do titular ainda válida (`data_access_granted_until`) e justificativa.
 */
export async function grantSupportAccess(
  db: Database,
  input: { supportCaseId: string; operatorId: string; justification: string; hours?: number },
): Promise<{ id: string; expiresAt: Date }> {
  return db.asService(async (q) => {
    const [op] = await q.query<{ role: string }>("select role from platform_admins where user_id = $1", [input.operatorId]);
    if (!op) throw new DomainError("forbidden", "Somente operadores da plataforma.");
    const [sc] = await q.query<{ workspace_id: string; data_access_granted_until: Date | null }>(
      "select workspace_id, data_access_granted_until from support_cases where id = $1", [input.supportCaseId],
    );
    if (!sc) throw new DomainError("not_found", "Chamado não encontrado.");
    if (!sc.data_access_granted_until || new Date(sc.data_access_granted_until).getTime() <= Date.now()) {
      throw new DomainError("forbidden", "O titular não autorizou (ou a autorização expirou) o acesso aos dados neste chamado.");
    }
    if (input.justification.trim().length < 10) throw new DomainError("invalid", "Justificativa obrigatória (mín. 10 caracteres).");
    const expiresAt = new Date(Math.min(Date.now() + (input.hours ?? 2) * 3600_000, new Date(sc.data_access_granted_until).getTime()));
    const [g] = await q.query<{ id: string }>(
      `insert into support_access_grants (support_case_id, workspace_id, operator_id, justification, expires_at)
       values ($1, $2, $3, $4, $5) returning id`,
      [input.supportCaseId, sc.workspace_id, input.operatorId, input.justification.trim(), expiresAt],
    );
    await q.query(
      "insert into audit_logs (workspace_id, actor_id, actor_type, action, resource_type, resource_id, metadata) values ($1, $2, 'support', 'support.access.granted', 'support_case', $3, $4)",
      [sc.workspace_id, input.operatorId, input.supportCaseId, JSON.stringify({ grant: g.id, expires_at: expiresAt })],
    );
    return { id: g.id, expiresAt };
  });
}

/** Leitura de conversas pelo suporte: só com concessão ativa; cada leitura é auditada. */
export async function supportReadConversations(db: Database, operatorId: string, workspaceId: string) {
  return db.asService(async (q) => {
    const [grant] = await q.query<{ id: string }>(
      "select id from support_access_grants where operator_id = $1 and workspace_id = $2 and revoked_at is null and expires_at > now() and scope = 'conversations' order by expires_at desc limit 1",
      [operatorId, workspaceId],
    );
    if (!grant) throw new DomainError("forbidden", "Sem concessão de acesso ativa para este workspace.");
    await q.query(
      "insert into audit_logs (workspace_id, actor_id, actor_type, action, resource_type, resource_id) values ($1, $2, 'support', 'support.conversations.read', 'support_access_grant', $3)",
      [workspaceId, operatorId, grant.id],
    );
    return q.query<{ id: string; channel: string; mode: string; last_message_at: Date | null }>(
      "select id, channel, mode, last_message_at from conversations where workspace_id = $1 order by last_message_at desc nulls last limit 50",
      [workspaceId],
    );
  });
}
