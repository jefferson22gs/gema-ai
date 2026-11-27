import { z } from "zod";
import { db } from "@/lib/db";
import { enqueue } from "@/server/jobs/queue";
import { errorResponse, json, rateLimit, sameOrigin } from "@/server/http";
import { upsertConnection } from "@/server/open-finance/sync";
import { bankProvider } from "@/server/runtime";
import { getSession } from "@/server/session";

/**
 * Chamado pelo widget após conexão bem-sucedida. O itemId vindo do navegador NÃO é confiável:
 * o servidor consulta o item na Pluggy e grava em nome do usuário da sessão; a sincronização
 * roda na fila (idempotente por item).
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Origem inválida." }, 403);
  const s = await getSession();
  if (!s) return json({ error: "Não autenticado." }, 401);
  const provider = bankProvider();
  if (!provider) return json({ error: "Open Finance não configurado." }, 503);
  if (!(await rateLimit(`of:items:${s.userId}`, 10, 600))) return json({ error: "Muitas tentativas." }, 429);
  const parsed = z.object({ itemId: z.string().min(1).max(100) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Requisição inválida." }, 400);
  try {
    const item = await provider.getItem(parsed.data.itemId);
    const conn = await upsertConnection(db, { workspaceId: s.workspace.id, ownerId: s.userId, provider: provider.name, item });
    await db.asService((q) => enqueue(q, "open_finance.sync", { connectionId: conn.id, trigger: "initial" }, { dedupeKey: `of:initial:${conn.id}` }));
    return json({ connectionId: conn.id, status: conn.status }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
