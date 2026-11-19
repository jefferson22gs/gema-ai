import { AdminTable } from "@/components/admin/table";
import { auditAdminView, webhookHealth } from "@/server/admin/queries";
import { requirePlatformAdmin } from "@/server/session";

export default async function Monitoramento() {
  const s = await requirePlatformAdmin();
  await auditAdminView(s.userId, "monitoramento");
  const rows = await webhookHealth();
  return (
    <AdminTable
      headers={["Webhook", "Recebidos (7d)", "Assinatura inválida", "Falhas", "Último"]}
      rows={rows.map((r) => [r.provider, r.total, r.rejected, r.failed, r.last_at ? new Date(r.last_at).toLocaleString("pt-BR") : "—"])}
      empty="Nenhum webhook recebido nos últimos 7 dias."
    />
  );
}
