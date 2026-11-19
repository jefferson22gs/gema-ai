"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";
import type { ActionState } from "../actions";

/**
 * Exclusão de conta (LGPD). Irreversível: exige digitar EXCLUIR. Remove arquivos do Storage,
 * workspaces dos quais é o único owner e o usuário do Auth (cascade apaga dados vinculados).
 */
export async function deleteAccountAction(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  if (String(form.get("confirm") ?? "") !== "EXCLUIR") return { error: "Digite EXCLUIR para confirmar." };
  const admin = createSupabaseAdminClient();
  if (!admin) return { error: "Exclusão indisponível: SUPABASE_SERVICE_ROLE_KEY não configurada." };

  const paths = await db.asService(async (q) => {
    const docs = await q.query<{ storage_path: string }>("select storage_path from documents where owner_id = $1", [s.userId]);
    await q.query("insert into audit_logs (actor_id, actor_type, action, resource_type, resource_id) values ($1, 'user', 'account.deleted', 'user', $1)", [s.userId]);
    // Workspaces onde o usuário é o único owner são removidos (com todos os dados).
    await q.query(
      `delete from workspaces w where w.created_by = $1 and not exists (
         select 1 from workspace_members m where m.workspace_id = w.id and m.role = 'owner' and m.user_id <> $1)`,
      [s.userId],
    );
    return docs.map((d) => d.storage_path);
  });
  for (let i = 0; i < paths.length; i += 100) await admin.storage.from("documents").remove(paths.slice(i, i + 100));
  const { error } = await admin.auth.admin.deleteUser(s.userId);
  if (error) return { error: "Falha ao concluir a exclusão. Contate o suporte." };
  await (await createSupabaseServerClient())?.auth.signOut();
  redirect("/?conta=excluida");
}
