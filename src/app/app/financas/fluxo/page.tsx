import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HeartPulse, Repeat } from "lucide-react";
import { BalanceLineChart, Progress } from "@/components/app/charts";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { cashflowProjection, healthScore, listRecurringCandidates } from "@/server/services/planning";
import { actorContext, requireSession } from "@/server/session";
import { refreshRecurringAction, setRecurringStatusAction } from "../actions";

export const metadata: Metadata = { title: "Fluxo de caixa" };

const PERIOD: Record<number, string> = { 7: "Semana", 30: "Mês", 90: "Trimestre" };
const INTERVAL: Record<number, string> = { 7: "semanal", 30: "mensal", 365: "anual" };

async function Cashflow({ searchParams }: { searchParams: PageProps<"/app/financas/fluxo">["searchParams"] }) {
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.dias)) ? Number(sp.dias) : 30;
  const s = await requireSession();
  const ctx = actorContext(s);
  const { p, health, recurring } = await db.asUser(s.userId, async (q) => ({
    p: await cashflowProjection({ q, ctx }, days),
    health: await healthScore({ q, ctx }),
    recurring: await listRecurringCandidates({ q, ctx }),
  }));
  const upcoming = [...p.events].sort((a, b) => a.date.localeCompare(b.date)).filter((e) => e.date <= p.days[p.days.length - 1].date);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <div>
            <h2 className="text-sm font-semibold">Saldo projetado</h2>
            <p className="text-xs text-muted">Hoje {formatCents(p.startBalanceCents)} → em {days} dias {formatCents(p.endBalanceCents)} · menor saldo {formatCents(p.lowest.balanceCents)} em {p.lowest.date}</p>
          </div>
          <div className="flex rounded-lg border border-border p-0.5 text-xs">
            {[7, 30, 90].map((d) => (
              <Link key={d} href={`?dias=${d}`} aria-current={d === days ? "page" : undefined} className={cn("rounded-md px-3 py-1.5", d === days ? "bg-surface-2 text-fg" : "text-muted")}>{PERIOD[d]}</Link>
            ))}
          </div>
        </div>
        <CardBody>
          <BalanceLineChart points={p.days} title={`Saldo projetado para ${days} dias`} />
          {p.lowest.balanceCents < 0 ? <p className="mt-2 text-sm text-danger">Atenção: o saldo projetado fica negativo em {p.lowest.date}.</p> : null}
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer">Hipóteses do cálculo</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">{p.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          </details>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Próximas movimentações" description="Pendentes e faturas em aberto já registradas." />
          <CardBody>
            {upcoming.length ? (
              <ul className="divide-y divide-border text-sm">
                {upcoming.map((e, i) => (
                  <li key={`${e.date}-${i}`} className="flex justify-between gap-2 py-2">
                    <span className="truncate"><span className="tabular-nums text-subtle">{e.date}</span> · {e.label}</span>
                    <span className={cn("shrink-0 tabular-nums", e.deltaCents < 0 ? "text-fg" : "text-success")}>{e.deltaCents < 0 ? "-" : "+"}{formatCents(Math.abs(e.deltaCents))}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Nenhuma movimentação futura registrada no período.</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><HeartPulse className="size-4 text-gold" />Saúde financeira</span>} description="Indicador educacional do GEMA AI — não é score de crédito." />
          <CardBody>
            {health ? (
              <div className="space-y-4">
                <p className="text-3xl font-semibold tabular-nums">{health.score}<span className="text-base text-muted">/100</span></p>
                <ul className="space-y-3">
                  {health.components.map((c) => (
                    <li key={c.key}>
                      <div className="mb-1 flex justify-between text-sm"><span>{c.label}</span><span className="tabular-nums text-muted">{c.points}/{c.max}</span></div>
                      <Progress pct={(c.points / c.max) * 100} label={`${c.label}: ${c.points} de ${c.max}`} />
                      <p className="mt-1 text-[11px] text-subtle">{c.detail}</p>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-subtle">{health.disclaimer}</p>
              </div>
            ) : <EmptyState icon={<HeartPulse />} title="Ainda sem histórico suficiente" description="O indicador aparece após pelo menos um mês completo de lançamentos." />}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Repeat className="size-4 text-gold" />Assinaturas e gastos recorrentes</span>}
          description="Sugestões detectadas nos seus lançamentos. Confirme ou dispense — nada é cancelado automaticamente."
          action={<form action={refreshRecurringAction}><Button variant="secondary" size="sm">Analisar lançamentos</Button></form>}
        />
        <CardBody>
          {recurring.length ? (
            <ul className="divide-y divide-border">
              {recurring.map((r) => {
                const change = r.price_change_pct ? Number(r.price_change_pct) : null;
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <div>
                      <p className="font-medium">{r.label} <Badge>{INTERVAL[r.interval_days]}</Badge>{r.status === "confirmed" ? <Badge tone="success" className="ml-1">confirmada</Badge> : null}{r.status === "cancel_requested" ? <Badge tone="warning" className="ml-1">cancelamento lembrado</Badge> : null}</p>
                      <p className="text-xs text-muted">
                        média {formatCents(r.average_cents)} · próxima estimada {r.next_estimated_date}
                        {r.interval_days === 30 ? ` · ${formatCents(r.average_cents * 12)}/ano` : ""}
                        {change && change > 0 ? <span className="text-warning"> · aumentou {change.toLocaleString("pt-BR")}%</span> : null}
                      </p>
                    </div>
                    {r.status === "suggested" ? (
                      <div className="flex gap-2 text-xs">
                        {([["confirmed", "Confirmar"], ["cancel_requested", "Quero cancelar"], ["dismissed", "Não é recorrente"]] as const).map(([st, label]) => (
                          <form key={st} action={setRecurringStatusAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value={st} /><button className="rounded-md border border-border px-2 py-1 text-muted hover:text-fg">{label}</button></form>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState icon={<Repeat />} title="Nenhuma recorrência detectada" description="Clique em “Analisar lançamentos” após registrar alguns meses de despesas." />}
        </CardBody>
      </Card>
    </div>
  );
}

export default function FluxoPage(props: PageProps<"/app/financas/fluxo">) {
  return (
    <>
      <PageHeader title="Fluxo de caixa" description="Projeção baseada no que já está registrado. Estimativa, não garantia." />
      <Suspense fallback={<Skeleton className="h-96" />}><Cashflow searchParams={props.searchParams} /></Suspense>
    </>
  );
}
