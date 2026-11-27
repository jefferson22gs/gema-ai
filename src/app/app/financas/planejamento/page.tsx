import type { Metadata } from "next";
import { Suspense } from "react";
import { Landmark, Target } from "lucide-react";
import { ActionForm } from "@/components/app/action-form";
import { Progress } from "@/components/app/charts";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatCents, toCents } from "@/lib/money";
import { compareDebtStrategies, listDebts, listGoals } from "@/server/services/planning";
import { actorContext, requireSession } from "@/server/session";
import { contributeGoalAction, createDebtAction, createGoalAction } from "../actions";

export const metadata: Metadata = { title: "Metas e dívidas" };

const GOAL_KIND: Record<string, string> = {
  emergency: "Reserva de emergência", property: "Imóvel", vehicle: "Veículo", travel: "Viagem", education: "Educação",
  retirement: "Aposentadoria", debt_payoff: "Quitar dívidas", custom: "Personalizada",
};

async function Planning({ searchParams }: { searchParams: PageProps<"/app/financas/planejamento">["searchParams"] }) {
  const sp = await searchParams;
  const s = await requireSession();
  const ctx = actorContext(s);
  const budget = typeof sp.orcamento === "string" ? toCents(sp.orcamento) : null;
  const { goals, debts, comparison } = await db.asUser(s.userId, async (q) => ({
    goals: await listGoals({ q, ctx }),
    debts: await listDebts({ q, ctx }),
    comparison: budget ? await compareDebtStrategies({ q, ctx }, budget) : null,
  }));
  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Metas" description="Progresso e quanto guardar por mês para cumprir o prazo." />
          <CardBody>
            {goals.length ? (
              <ul className="space-y-5">
                {goals.map((g) => (
                  <li key={g.id}>
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 font-medium">{g.name}<Badge>{GOAL_KIND[g.kind] ?? g.kind}</Badge>{g.status === "achieved" ? <Badge tone="success">Atingida</Badge> : null}</span>
                      <span className="tabular-nums text-muted">{formatCents(g.savedCents)} / {formatCents(g.targetCents)}</span>
                    </div>
                    <Progress pct={g.pct} tone={g.pct >= 100 ? "success" : "gold"} label={`${g.name}: ${g.pct}%`} />
                    <p className="mt-1.5 text-xs text-muted">
                      {g.remainingCents === 0 ? "Meta atingida." : g.requiredMonthlyCents !== null
                        ? `Faltam ${formatCents(g.remainingCents)} · guarde ${formatCents(g.requiredMonthlyCents)}/mês até ${g.deadline} (${g.monthsLeft} meses)`
                        : `Faltam ${formatCents(g.remainingCents)} · sem prazo definido`}
                    </p>
                    {g.remainingCents > 0 ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-gold">Registrar contribuição</summary>
                        <div className="mt-2 max-w-xs">
                          <ActionForm action={async (st, f) => { f.set("idempotencyKey", `form:${crypto.randomUUID()}`); return contributeGoalAction(st, f); }} submitLabel="Adicionar">
                            <input type="hidden" name="goalId" value={g.id} />
                            <Field label="Valor (R$)" htmlFor={`gc-${g.id}`}><Input id={`gc-${g.id}`} name="amount" inputMode="decimal" required /></Field>
                          </ActionForm>
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon={<Target />} title="Nenhuma meta" description="Crie uma meta ou peça ao assistente: “quero juntar 10 mil para viajar até dezembro”." />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Dívidas" description="Simulação educacional de quitação. Condições contratuais reais podem diferir." />
          <CardBody className="space-y-4">
            {debts.length ? (
              <ul className="divide-y divide-border">
                {debts.map((d) => (
                  <li key={d.id} className="flex flex-wrap justify-between gap-2 py-2.5 text-sm">
                    <span>{d.creditor} <Badge tone={d.terms_source === "contractual" ? "success" : "neutral"}>{d.terms_source === "contractual" ? "contratual" : "estimado"}</Badge></span>
                    <span className="tabular-nums text-muted">{formatCents(d.balance_cents)} · {(Number(d.monthly_rate) * 100).toFixed(2).replace(".", ",")}% a.m. · mín. {formatCents(d.min_payment_cents)}</span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon={<Landmark />} title="Nenhuma dívida cadastrada" />}
            {debts.length ? (
              <form className="flex flex-wrap items-end gap-2" method="get">
                <Field label="Quanto pode pagar por mês? (R$)" htmlFor="orcamento"><Input id="orcamento" name="orcamento" inputMode="decimal" defaultValue={typeof sp.orcamento === "string" ? sp.orcamento : ""} className="w-48" /></Field>
                <button className="h-10 rounded-lg border border-border-strong px-4 text-sm hover:bg-surface-2">Comparar estratégias</button>
              </form>
            ) : null}
            {comparison ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {([["Bola de neve", "Menor saldo primeiro", comparison.snowball], ["Avalanche", "Maior juros primeiro", comparison.avalanche]] as const).map(([t, d, r]) => (
                  <div key={t} className="rounded-lg border border-border p-4 text-sm">
                    <p className="font-medium">{t}</p>
                    <p className="text-xs text-muted">{d}</p>
                    {r.feasible ? (
                      <p className="mt-2">Quitação em <strong>{r.months} meses</strong>; juros estimados <strong>{formatCents(r.totalInterestCents)}</strong>.</p>
                    ) : <p className="mt-2 text-danger">O valor não cobre os pagamentos mínimos.</p>}
                  </div>
                ))}
                <p className="text-xs text-subtle sm:col-span-2">{comparison.disclaimer}</p>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Nova meta" />
          <CardBody>
            <ActionForm action={createGoalAction} submitLabel="Criar meta">
              <Field label="Nome" htmlFor="gname"><Input id="gname" name="name" required maxLength={120} /></Field>
              <Field label="Tipo" htmlFor="gkind"><Select id="gkind" name="kind" defaultValue="custom">{Object.entries(GOAL_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Objetivo (R$)" htmlFor="gtarget"><Input id="gtarget" name="target" inputMode="decimal" required /></Field>
                <Field label="Prazo" htmlFor="gdeadline"><Input id="gdeadline" name="deadline" type="date" /></Field>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Cadastrar dívida" />
          <CardBody>
            <ActionForm action={createDebtAction} submitLabel="Cadastrar">
              <Field label="Credor" htmlFor="dcred"><Input id="dcred" name="creditor" required /></Field>
              <Field label="Tipo" htmlFor="dkind">
                <Select id="dkind" name="kind" defaultValue="other">
                  <option value="credit_card">Cartão</option><option value="personal_loan">Empréstimo pessoal</option><option value="financing">Financiamento</option><option value="overdraft">Cheque especial</option><option value="other">Outra</option>
                </Select>
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Saldo (R$)" htmlFor="dbal"><Input id="dbal" name="balance" inputMode="decimal" required /></Field>
                <Field label="Juros % a.m." htmlFor="drate"><Input id="drate" name="rate" inputMode="decimal" required /></Field>
                <Field label="Mínimo (R$)" htmlFor="dmin"><Input id="dmin" name="minPayment" inputMode="decimal" /></Field>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
        <Alert tone="neutral">O GEMA AI não oferece crédito nem recomenda produtos financeiros. As simulações são educacionais.</Alert>
      </div>
    </div>
  );
}

export default function PlanejamentoPage(props: PageProps<"/app/financas/planejamento">) {
  return (
    <>
      <PageHeader title="Metas e dívidas" />
      <Suspense fallback={<Skeleton className="h-96" />}><Planning searchParams={props.searchParams} /></Suspense>
    </>
  );
}
