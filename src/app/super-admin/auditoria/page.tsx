import { AdminTable } from "@/components/admin/table";
import { auditAdminView, recentAudit } from "@/server/admin/queries";
import { requirePlatformAdmin } from "@/server/session";

export default async function Auditoria() {
  const s = await requirePlatformAdmin();
  await auditAdminView(s.userId, "auditoria");
  const rows = await recentAudit(150);
  return (
    <AdminTable
      headers={["Quando", "Ator", "Ação", "Recurso", "Workspace"]}
      rows={rows.map((r) => [new Date(r.created_at).toLocaleString("pt-BR"), r.actor_type, r.action, r.resource_type ?? "—", r.workspace_id?.slice(0, 8) ?? "—"])}
    />
  );
}
