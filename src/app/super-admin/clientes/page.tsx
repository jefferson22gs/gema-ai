import { AdminTable } from "@/components/admin/table";
import { Badge } from "@/components/ui/primitives";
import { auditAdminView, listClients } from "@/server/admin/queries";
import { requirePlatformAdmin } from "@/server/session";

export default async function Clientes() {
  const s = await requirePlatformAdmin();
  await auditAdminView(s.userId, "clientes");
  const rows = await listClients();
  return (
    <AdminTable
      headers={["Workspace", "Tipo", "Titular", "Plano", "Status", "Membros", "IA (mês)", "Storage", "Criado em"]}
      rows={rows.map((r) => [
        r.name, r.kind, r.owner_email, r.plan_id, <Badge key="s">{r.status ?? "—"}</Badge>, r.members, r.ai_calls,
        `${(r.storage_bytes / 1024 / 1024).toFixed(1)} MB`, new Date(r.created_at).toLocaleDateString("pt-BR"),
      ])}
    />
  );
}
