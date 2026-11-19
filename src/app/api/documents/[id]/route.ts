import { db } from "@/lib/db";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { auditAsUser } from "@/server/context";
import { json, sameOrigin } from "@/server/http";
import { getDocument } from "@/server/services/documents";
import { actorContext, getSession } from "@/server/session";

/** URL assinada temporária (60 s) — somente após checagem de acesso sob RLS. */
export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  const s = await getSession();
  if (!s) return json({ error: "Não autenticado." }, 401);
  const storage = createSupabaseAdminClient();
  if (!storage) return json({ error: "Armazenamento não configurado." }, 503);
  const actor = actorContext(s);
  const doc = await db.asUser(s.userId, (q) => getDocument({ q, ctx: actor }, id));
  if (!doc) return json({ error: "Documento não encontrado." }, 404);
  const signed = await storage.storage.from("documents").createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
  if (signed.error || !signed.data) return json({ error: "Falha ao gerar link." }, 502);
  await db.asUser(s.userId, (q) => auditAsUser(q, { workspaceId: actor.workspaceId, action: "document.accessed", resourceType: "document", resourceId: id }));
  return Response.redirect(signed.data.signedUrl, 302);
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  if (!sameOrigin(req)) return json({ error: "Origem inválida." }, 403);
  const { id } = await ctx.params;
  const s = await getSession();
  if (!s) return json({ error: "Não autenticado." }, 401);
  const storage = createSupabaseAdminClient();
  const actor = actorContext(s);
  const removed = await db.asUser(s.userId, async (q) => {
    const rows = await q.query<{ storage_path: string }>(
      "update documents set deleted_at = now() where id = $1 and workspace_id = $2 and owner_id = $3 and deleted_at is null returning storage_path",
      [id, actor.workspaceId, s.userId],
    );
    if (rows.length) await auditAsUser(q, { workspaceId: actor.workspaceId, action: "document.deleted", resourceType: "document", resourceId: id });
    return rows[0];
  });
  if (!removed) return json({ error: "Documento não encontrado." }, 404);
  await storage?.storage.from("documents").remove([removed.storage_path]);
  return json({ ok: true });
}
