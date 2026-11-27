import { db } from "@/lib/db";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { auditAsUser } from "@/server/context";
import { errorResponse, json, rateLimit, sameOrigin } from "@/server/http";
import { idempotentJson, readIdempotencyKey, requestHash, withIdempotency, type StoredResponse } from "@/server/idempotency";
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
  const idem = readIdempotencyKey(req);
  if (idem.error) return json({ error: idem.error }, 400);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return json({ error: "Arquivo ausente." }, 400);
  const kind = ["receipt", "invoice", "contract", "id", "other"].includes(String(form?.get("kind"))) ? String(form?.get("kind")) : "other";

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Reenvio com a mesma Idempotency-Key (ex.: rede caiu após o upload) não duplica o documento.
    const r = await withIdempotency(
      db,
      { userId: s.userId, scope: `documents:${s.workspace.id}`, key: idem.key, hash: requestHash([file.name, kind, bytes]) },
      () => storeDocument(s, storage, file, kind, bytes),
    );
    return idempotentJson(r);
  } catch (e) {
    return errorResponse(e);
  }
}

async function storeDocument(
  s: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  storage: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  file: File,
  kind: string,
  bytes: Uint8Array,
): Promise<StoredResponse> {
  const { mime, safeName } = validateUpload(file.name, file.type, bytes);
  // Plano: limite de storage por workspace (plano + add-ons).
  const [usage] = await db.asService((q) =>
    q.query<{ used: number; limit_mb: number | null }>(
      `select coalesce((select sum(size_bytes) from documents where workspace_id = $1 and deleted_at is null), 0)::bigint as used,
              app.plan_limit($1, 'storage_mb') as limit_mb`,
      [s.workspace.id],
    ),
  );
  if (usage?.limit_mb != null && usage.used + bytes.byteLength > usage.limit_mb * 1024 * 1024) {
    return { status: 413, body: { error: "Limite de armazenamento do plano atingido." } };
  }

  const path = storagePathFor(s.workspace.id, s.userId, safeName);
  const up = await storage.storage.from("documents").upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) return { status: 502, body: { error: "Falha ao armazenar o arquivo." } };

  const doc = await db.asUser(s.userId, async (q) => {
    const [row] = await q.query<{ id: string }>(
      `insert into documents (workspace_id, owner_id, storage_path, file_name, mime_type, size_bytes, kind)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [s.workspace.id, s.userId, path, safeName, mime, bytes.byteLength, kind],
    );
    await auditAsUser(q, { workspaceId: s.workspace.id, action: "document.uploaded", resourceType: "document", resourceId: row.id });
    return row;
  });
  return { status: 201, body: { id: doc.id } };
}
