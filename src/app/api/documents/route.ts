import { db } from "@/lib/db";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { auditAsUser } from "@/server/context";
import { errorResponse, json, rateLimit, sameOrigin } from "@/server/http";
import { storagePathFor, validateUpload } from "@/server/services/documents";
import { getSession } from "@/server/session";

/**
 * Upload autenticado: valida tamanho, MIME declarado e assinatura do conteúdo; grava no bucket
 * privado em <workspace>/<owner>/<uuid>-<nome>. Metadados inseridos sob RLS do usuário.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Origem inválida." }, 403);
  const s = await getSession();
  if (!s) return json({ error: "Não autenticado." }, 401);
  const storage = createSupabaseAdminClient();
  if (!storage) return json({ error: "Armazenamento não configurado (SUPABASE_SERVICE_ROLE_KEY)." }, 503);
  if (!(await rateLimit(`upload:${s.userId}`, 20, 600))) return json({ error: "Muitos envios. Aguarde." }, 429);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return json({ error: "Arquivo ausente." }, 400);
  const kind = ["receipt", "invoice", "contract", "id", "other"].includes(String(form?.get("kind"))) ? String(form?.get("kind")) : "other";

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { mime, safeName } = validateUpload(file.name, file.type, bytes);
    // Plano: limite de storage por workspace.
    const [usage] = await db.asService((q) =>
      q.query<{ used: number; limit_mb: number }>(
        `select coalesce((select sum(size_bytes) from documents where workspace_id = $1 and deleted_at is null), 0)::bigint as used,
                (p.limits ->> 'storage_mb')::int as limit_mb
         from workspaces w join plans p on p.id = w.plan_id where w.id = $1`,
        [s.workspace.id],
      ),
    );
    if (usage && usage.used + bytes.byteLength > usage.limit_mb * 1024 * 1024) return json({ error: "Limite de armazenamento do plano atingido." }, 413);

    const path = storagePathFor(s.workspace.id, s.userId, safeName);
    const up = await storage.storage.from("documents").upload(path, bytes, { contentType: mime, upsert: false });
    if (up.error) return json({ error: "Falha ao armazenar o arquivo." }, 502);

    const doc = await db.asUser(s.userId, async (q) => {
      const [row] = await q.query<{ id: string }>(
        `insert into documents (workspace_id, owner_id, storage_path, file_name, mime_type, size_bytes, kind)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [s.workspace.id, s.userId, path, safeName, mime, bytes.byteLength, kind],
      );
      await auditAsUser(q, { workspaceId: s.workspace.id, action: "document.uploaded", resourceType: "document", resourceId: row.id });
      return row;
    });
    return json({ id: doc.id }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
