import { AdminTable } from "@/components/admin/table";
import { Alert } from "@/components/ui/primitives";
import { auditAdminView, billingEvents } from "@/server/admin/queries";
import { billingProvider } from "@/server/billing/provider";
import { requirePlatformAdmin } from "@/server/session";

export default async function Financeiro() {
  const s = await requirePlatformAdmin();
  await auditAdminView(s.userId, "financeiro");
  const rows = await billingEvents();
  return (
    <div className="space-y-4">
      {billingProvider().name === "none" ? <Alert tone="warning" title="Billing: Não configurado">Nenhum provedor de pagamento ativo. Nenhuma cobrança real é processada.</Alert> : null}
      <AdminTable
        headers={["Quando", "Provedor", "Evento", "Processado", "Erro"]}
        rows={rows.map((r) => [new Date(r.created_at).toLocaleString("pt-BR"), r.provider, r.event_type, r.processed_at ? "sim" : "não", r.error ?? "—"])}
        empty="Nenhum evento de cobrança recebido."
      />
    </div>
  );
}
