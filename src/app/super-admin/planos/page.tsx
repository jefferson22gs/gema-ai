import { AdminTable } from "@/components/admin/table";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { auditAdminView } from "@/server/admin/queries";
import { listPlans } from "@/server/services/workspaces";
import { requirePlatformAdmin } from "@/server/session";

export default async function Planos() {
  const s = await requirePlatformAdmin();
  await auditAdminView(s.userId, "planos");
  const plans = await db.asService((q) => listPlans(q));
  return (
    <>
      <AdminTable
        headers={["Plano", "Preço", "Msgs IA/mês", "Tokens/mês", "Storage", "Automações", "Membros", "WhatsApp/mês"]}
        rows={plans.map((p) => [p.name, formatCents(p.price_cents), p.limits.ai_messages_month, p.limits.ai_tokens_month, `${p.limits.storage_mb} MB`, p.limits.automations, p.limits.members, p.limits.whatsapp_messages_month])}
      />
      <p className="mt-3 text-xs text-subtle">Planos e limites são versionados em supabase/migrations. Alterações comerciais devem passar por migration revisada.</p>
    </>
  );
}
