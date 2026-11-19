import { AdminTable } from "@/components/admin/table";
import { Badge } from "@/components/ui/primitives";
import { auditAdminView, featureFlags, supportCases } from "@/server/admin/queries";
import { requirePlatformAdmin } from "@/server/session";

export default async function Configuracoes() {
  const s = await requirePlatformAdmin();
  await auditAdminView(s.userId, "configuracoes");
  const [flags, cases] = await Promise.all([featureFlags(), supportCases()]);
  return (
    <div className="space-y-6">
      <h2 className="text-sm font-semibold">Feature flags</h2>
      <AdminTable
        headers={["Chave", "Descrição", "Estado"]}
        rows={flags.map((f) => [f.key, f.description, <Badge key="flag" tone={f.enabled ? "success" : "neutral"}>{f.enabled ? "ligada" : "desligada"}</Badge>])}
      />
      <h2 className="text-sm font-semibold">Chamados de suporte</h2>
      <AdminTable
        headers={["Aberto em", "Assunto", "Status", "Acesso a dados autorizado até"]}
        rows={cases.map((c) => [
          new Date(c.created_at).toLocaleString("pt-BR"), c.subject, c.status,
          c.data_access_granted_until ? new Date(c.data_access_granted_until).toLocaleString("pt-BR") : "Não autorizado",
        ])}
        empty="Nenhum chamado."
      />
      <p className="text-xs text-subtle">Feature flags mudam por migration ou SQL auditado. Acesso a dados de cliente só com autorização registrada no chamado.</p>
    </div>
  );
}
