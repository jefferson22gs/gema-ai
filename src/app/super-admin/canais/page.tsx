import { AdminTable } from "@/components/admin/table";
import { Alert, StatusPill } from "@/components/ui/primitives";
import { auditAdminView, channelStats } from "@/server/admin/queries";
import type { ProviderHealth } from "@/server/messaging/types";
import { evolutionProvider, metaProvider } from "@/server/runtime";
import { requirePlatformAdmin } from "@/server/session";

function pill(h?: ProviderHealth) {
  return <StatusPill status={!h ? "not_configured" : h.status === "connected" ? "connected" : h.status === "disconnected" ? "pending" : "error"} />;
}

export default async function Canais() {
  const s = await requirePlatformAdmin();
  await auditAdminView(s.userId, "canais");
  const [evoHealth, metaHealth, stats] = await Promise.all([evolutionProvider()?.health(), metaProvider()?.health(), channelStats()]);
  return (
    <div className="space-y-6">
      <AdminTable
        headers={["Provedor", "Saúde", "Detalhe"]}
        rows={[
          ["WhatsApp Cloud API (Meta)", pill(metaHealth), metaHealth?.detail ?? "Não configurado"],
          ["Evolution API (host externo)", pill(evoHealth), evoHealth?.detail ?? "Não configurado"],
          ["Baileys/Whaileys", <StatusPill key="b" status="not_configured" />, "Repositório de origem sem código verificável"],
        ]}
      />
      <Alert tone="warning" title="QR code e sessão">O pareamento da instância Evolution é feito no próprio host persistente, com acesso administrativo restrito. O QR não é armazenado nem exibido aqui.</Alert>
      <AdminTable headers={["Provedor", "Status de vínculo", "Quantidade"]} rows={stats.map((r) => [r.provider, r.status, r.n])} />
    </div>
  );
}
