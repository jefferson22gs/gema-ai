import { AdminTable } from "@/components/admin/table";
import { auditAdminView, automationStats } from "@/server/admin/queries";
import { requirePlatformAdmin } from "@/server/session";

export default async function Automacoes() {
  const s = await requirePlatformAdmin();
  await auditAdminView(s.userId, "automacoes");
  const rows = await automationStats();
  return <AdminTable headers={["Modelo", "Status", "Execuções (30 dias)"]} rows={rows.map((r) => [r.template, r.status, r.n])} />;
}
