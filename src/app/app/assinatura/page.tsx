import type { Metadata } from "next";
import { Suspense } from "react";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { billingProvider } from "@/server/billing/provider";
import { listPlans } from "@/server/services/workspaces";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Assinatura" };

const STATUS = { trialing: ["Em teste", "gold"], active: ["Ativa", "success"], past_due: ["Pagamento pendente", "warning"], cancelled: ["Cancelada", "danger"] } as const;

async function Subscription() {
  const s = await requireSession();
  const { sub, plans, usage, features } = await db.asUser(s.userId, async (q) => ({
    // Recursos efetivos: plano + estado da assinatura (mesma regra aplicada no servidor).
    features: await q.query<{ key: string; label: string; core: boolean; ok: boolean }>(
      "select key, label, core, app.entitled($1, key) as ok from plan_features order by sort_order",
      [s.workspace.id],
    ),
    sub: (await q.query<{ status: keyof typeof STATUS; plan_id: string; trial_ends_at: Date | null; current_period_end: Date | null; grace_until: Date | null }>(
      "select status, plan_id, trial_ends_at, current_period_end, grace_until from subscriptions where workspace_id = $1",
      [s.workspace.id],
    ))[0],
    plans: await listPlans(q),
    usage: (await q.query<{ messages: number; tokens: number }>(
      "select count(*)::bigint as messages, coalesce(sum(input_tokens + output_tokens), 0)::bigint as tokens from ai_usage where workspace_id = $1 and created_at >= date_trunc('month', now())",
      [s.workspace.id],
    ))[0],
  }));
  const plan = plans.find((p) => p.id === sub?.plan_id);
  const billing = billingProvider();
  return (
    <div className="space-y-6">
      {billing.name === "none" ? (
        <Alert tone="warning" title="Cobrança: Não configurada">Nenhum provedor de pagamento foi configurado. Não há cobranças sendo processadas; mudanças de plano dependem da ativação do billing.</Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Plano atual" action={sub ? <Badge tone={STATUS[sub.status][1]}>{STATUS[sub.status][0]}</Badge> : null} />
          <CardBody className="space-y-2 text-sm">
            <p className="text-xl font-semibold">{plan?.name ?? sub?.plan_id}</p>
            {plan ? <p className="text-muted">{formatCents(plan.price_cents)}/mês</p> : null}
            {sub?.trial_ends_at && sub.status === "trialing" ? <p className="text-muted">Teste até {formatDateTime(sub.trial_ends_at, s.profile.timezone)}</p> : null}
            {sub?.grace_until ? <p className="text-warning">Período de carência até {formatDateTime(sub.grace_until, s.profile.timezone)}</p> : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Uso no mês" />
          <CardBody className="space-y-3 text-sm">
            {plan ? (
              <>
                <UsageBar label="Mensagens de IA" used={usage.messages} limit={plan.limits.ai_messages_month} />
                <UsageBar label="Tokens de IA" used={usage.tokens} limit={plan.limits.ai_tokens_month} />
              </>
            ) : null}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Recursos deste workspace" description="Recursos essenciais nunca são bloqueados: seus dados continuam acessíveis mesmo sem assinatura ativa." />
        <CardBody className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <p key={f.key} className="flex items-center gap-2">
              <Badge tone={f.ok ? "success" : "neutral"}>{f.ok ? "Liberado" : "Fora do plano"}</Badge>
              <span className={f.ok ? "" : "text-muted"}>{f.label}</span>
            </p>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Planos disponíveis" />
        <CardBody className="grid gap-3 md:grid-cols-4">
          {plans.map((p) => (
            <div key={p.id} className={`rounded-lg border p-4 ${p.id === sub?.plan_id ? "border-gold/60" : "border-border"}`}>
              <p className="font-medium">{p.name}</p>
              <p className="text-sm text-muted">{formatCents(p.price_cents)}/mês</p>
              <p className="mt-2 text-xs text-subtle">{p.description}</p>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  return (
    <div>
      <div className="mb-1 flex justify-between"><span>{label}</span><span className="tabular-nums text-muted">{used.toLocaleString("pt-BR")} / {limit.toLocaleString("pt-BR")}</span></div>
      <div className="h-2 rounded-full bg-surface-2"><div className={`h-2 rounded-full ${pct >= 90 ? "bg-danger" : "bg-gold"}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export default function AssinaturaPage() {
  return (
    <>
      <PageHeader title="Assinatura" />
      <Suspense fallback={<Skeleton className="h-80" />}><Subscription /></Suspense>
    </>
  );
}
