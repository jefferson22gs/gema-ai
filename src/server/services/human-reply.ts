import type { Database } from "@/lib/db/types";
import { DomainError } from "../context";
import type { MessagingProvider } from "../messaging/types";

/**
 * Resposta manual do atendente humano (modo "human" ou "copilot"). Exige que a conversa esteja em
 * modo humano/copiloto E atribuída a quem envia — a IA, nesses modos, nunca envia (ver orchestrator).
 */
export async function sendHumanReply(
  db: Database,
  provider: MessagingProvider | null,
  input: { userId: string; conversationId: string; text: string; expectedVersion: number },
): Promise<{ delivered: boolean; error?: string }> {
  const text = input.text.trim();
  if (!text) throw new DomainError("invalid", "Mensagem vazia.");
  const [conv] = await db.asUser(input.userId, (q) =>
    q.query<{ id: string; workspace_id: string; channel: string; mode: string; assigned_to: string | null; lock_version: number }>(
      "select id, workspace_id, channel, mode, assigned_to, lock_version from conversations where id = $1 and owner_id = $2",
      [input.conversationId, input.userId],
    ),
  );
  if (!conv) throw new DomainError("not_found", "Conversa não encontrada.");
  if ((conv.mode !== "human" && conv.mode !== "copilot") || conv.assigned_to !== input.userId) {
    throw new DomainError("conflict", "Assuma a conversa (modo humano) antes de responder.");
  }
  if (conv.lock_version !== input.expectedVersion) throw new DomainError("conflict", "A conversa foi alterada em outra sessão. Recarregue a página.");

  let delivered = true;
  let error: string | undefined;
  if (conv.channel === "whatsapp") {
    const [acct] = await db.asService((q) =>
      q.query<{ address: string }>("select address from channel_accounts where user_id = $1 and status = 'verified' order by verified_at desc limit 1", [input.userId]),
    );
    if (!provider || !acct) {
      delivered = false;
      error = "Canal WhatsApp indisponível.";
    } else {
      const r = await provider.sendText(acct.address, text);
      delivered = r.ok;
      error = r.error;
    }
  }
  await db.asUser(input.userId, (q) =>
    q.query(
      `insert into messages (conversation_id, workspace_id, owner_id, role, content, author_id, author_kind, delivery_status)
       values ($1, $2, $3, 'assistant', $4, $3, 'human_agent', $5)`,
      [conv.id, conv.workspace_id, input.userId, text, delivered ? "sent" : "failed"],
    ),
  );
  return { delivered, error };
}
