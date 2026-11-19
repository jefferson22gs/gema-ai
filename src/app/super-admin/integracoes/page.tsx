import { AdminTable } from "@/components/admin/table";
import { StatusPill } from "@/components/ui/primitives";
import { integrationConfig } from "@/lib/env";
import { auditAdminView } from "@/server/admin/queries";
import { requirePlatformAdmin } from "@/server/session";

export default async function Integracoes() {
  const s = await requirePlatformAdmin();
  await auditAdminView(s.userId, "integracoes");
  return (
    <AdminTable
      headers={["Integração", "Configuração", "Variáveis ausentes", "Observação"]}
      rows={integrationConfig().map((i) => [i.label, <StatusPill key="s" status={i.configured ? "connected" : "not_configured"} />, i.missing.join(", ") || "—", i.note ?? "—"])}
    />
  );
}
