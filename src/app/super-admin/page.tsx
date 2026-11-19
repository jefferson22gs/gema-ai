import type { Metadata } from "next";
import { Metric } from "@/components/admin/table";
import { formatCents } from "@/lib/money";
import { auditAdminView, overviewMetrics } from "@/server/admin/queries";
import { requirePlatformAdmin } from "@/server/session";

export const metadata: Metadata = { title: "Super Admin" };

export default async function SuperAdminHome() {
  const s = await requirePlatformAdmin();
  await auditAdminView(s.userId, "overview");
  const m = await overviewMetrics();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Metric label="Usuários" value={m.users} />
      <Metric label="Workspaces" value={m.workspaces} />
      <Metric label="Assinaturas ativas" value={m.active_subs} />
      <Metric label="Em teste" value={m.trialing} />
      <Metric label="Pagamento pendente" value={m.past_due} tone={m.past_due ? "warning" : undefined} />
      <Metric label="MRR (assinaturas ativas)" value={formatCents(m.mrr_cents)} />
      <Metric label="Custo Gemini estimado (mês)" value={`US$ ${m.ai_cost_month.toFixed(2)}`} />
      <Metric label="Chamadas de IA (mês)" value={m.ai_calls_month} />
      <Metric label="E-mails (mês)" value={m.emails_month} />
      <Metric label="Jobs com falha" value={m.failed_jobs} tone={m.failed_jobs ? "danger" : undefined} />
      <Metric label="Webhooks rejeitados (24h)" value={m.webhook_rejects_24h} tone={m.webhook_rejects_24h ? "warning" : undefined} />
      <Metric label="Notificações em dead-letter" value={m.outbox_dead} tone={m.outbox_dead ? "danger" : undefined} />
    </div>
  );
}
