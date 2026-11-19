import { db } from "@/lib/db";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getExtractor } from "@/server/ai/extraction";
import { json, rateLimit, sameOrigin } from "@/server/http";
import { getDocument } from "@/server/services/documents";
import { actorContext, getSession } from "@/server/session";

/** Extrai dados do comprovante e grava como "pending_review" (o usuário revisa antes de lançar). */
export async function POST(req: Request, ctx: RouteContext<"/api/documents/[id]/extract">) {
  if (!sameOrigin(req)) return json({ error: "Origem inválida." }, 403);
  const { id } = await ctx.params;
  const s = await getSession();
  if (!s) return json({ error: "Não autenticado." }, 401);
  const extractor = getExtractor();
  if (!extractor) return json({ error: "Extração indisponível: Gemini não configurado." }, 503);
  const storage = createSupabaseAdminClient();
  if (!storage) return json({ error: "Armazenamento não configurado." }, 503);
  if (!(await rateLimit(`extract:${s.userId}`, 10, 600))) return json({ error: "Muitas extrações. Aguarde." }, 429);

  const actor = actorContext(s);
  const doc = await db.asUser(s.userId, (q) => getDocument({ q, ctx: actor }, id));
  if (!doc) return json({ error: "Documento não encontrado." }, 404);
  if (doc.mime_type === "text/plain") return json({ error: "Extração disponível para PDF e imagens." }, 422);

  const file = await storage.storage.from("documents").download(doc.storage_path);
  if (file.error || !file.data) return json({ error: "Falha ao ler o arquivo." }, 502);
  const base64 = Buffer.from(await file.data.arrayBuffer()).toString("base64");

  await db.asService((q) => q.query("update documents set status = 'extracting' where id = $1", [id]));
  try {
    const result = await extractor.extract({ mimeType: doc.mime_type, base64 });
    await db.asService(async (q) => {
      await q.query(
        "insert into document_extractions (document_id, workspace_id, owner_id, model, extracted, confidence) values ($1, $2, $3, $4, $5, $6)",
        [id, actor.workspaceId, s.userId, extractor.model, JSON.stringify(result), result.confidence],
      );
      await q.query("update documents set status = 'extracted' where id = $1", [id]);
    });
    return json({ extraction: result, review: "pending_review" });
  } catch {
    await db.asService((q) => q.query("update documents set status = 'failed' where id = $1", [id]));
    return json({ error: "Não foi possível extrair dados deste documento." }, 502);
  }
}
