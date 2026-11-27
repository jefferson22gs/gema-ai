import { CouponForm, PlanForm } from "@/components/admin/plan-forms";
import { AdminTable } from "@/components/admin/table";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { auditAdminView } from "@/server/admin/queries";
import { LIMIT_KEYS, listAllPlans, listCoupons, listFeatures } from "@/server/billing/plans";
import { requirePlatformAdmin } from "@/server/session";

export default async function Planos() {
  const s = await requirePlatformAdmin();
  await auditAdminView(s.userId, "planos");
  const { plans, features, coupons, subs } = await db.asService(async (q) => ({
    plans: await listAllPlans(q),
    features: await listFeatures(q),
    coupons: await listCoupons(q),
    subs: await q.query<{ plan_id: string; n: number }>("select plan_id, count(*)::int as n from subscriptions where status in ('active', 'trialing', 'past_due') group by plan_id"),
  }));
  const count = Object.fromEntries(subs.map((r) => [r.plan_id, r.n]));
  return (
    <div className="space-y-6">
      <AdminTable
        headers={["Plano", "Mensal", "Anual", "Teste", "Assinaturas", "Estado"]}
        rows={plans.map((p) => [
          p.name,
          formatCents(p.price_cents),
          p.price_yearly_cents === null ? "—" : formatCents(p.price_yearly_cents),
          `${p.trial_days} dias`,
          count[p.id] ?? 0,
          <span key="st" className="flex gap-1">
            <Badge tone={p.active ? "success" : "neutral"}>{p.active ? "ativo" : "inativo"}</Badge>
            {p.is_public ? <Badge tone="gold">público</Badge> : null}
          </span>,
        ])}
      />
      <p className="text-xs text-subtle">
        Preços, limites e recursos são lidos do banco e aplicados no servidor. Toda alteração fica na auditoria com valores antes/depois.
        Alterar preço não reajusta cobranças já emitidas: isso depende do provedor de pagamento (ainda não configurado).
      </p>
      {plans.map((p) => (
        <details key={p.id} className="rounded-xl border border-border bg-surface">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium">Editar {p.name} <span className="text-subtle">({p.id})</span></summary>
          <div className="border-t border-border p-5"><PlanForm plan={p} features={features} limitKeys={LIMIT_KEYS} /></div>
        </details>
      ))}
      <details className="rounded-xl border border-border bg-surface">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium">Novo plano</summary>
        <div className="border-t border-border p-5"><PlanForm features={features} limitKeys={LIMIT_KEYS} /></div>
      </details>
      <Card>
        <CardHeader title="Cupons" description="Validados no servidor (validade, usos, plano e ciclo). O desconto só é cobrado quando houver provedor de pagamento." />
        <CardBody className="space-y-6">
          <AdminTable
            headers={["Código", "Desconto", "Duração", "Usos", "Validade", "Estado"]}
            rows={coupons.map((c) => [
              c.code,
              c.percent_off !== null ? `${c.percent_off}%` : formatCents(c.amount_off_cents ?? 0),
              c.duration_months ? `${c.duration_months} meses` : "1 ciclo",
              `${c.redeemed_count}${c.max_redemptions ? ` / ${c.max_redemptions}` : ""}`,
              c.valid_until ? new Date(c.valid_until).toLocaleDateString("pt-BR") : "sem prazo",
              <Badge key="st" tone={c.active ? "success" : "neutral"}>{c.active ? "ativo" : "inativo"}</Badge>,
            ])}
            empty="Nenhum cupom."
          />
          <CouponForm plans={plans.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }))} />
        </CardBody>
      </Card>
    </div>
  );
}
