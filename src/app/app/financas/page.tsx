import type { Metadata } from "next";
import { Suspense } from "react";
import { TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { TransactionForm } from "@/components/app/finance-forms";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { localDateString } from "@/lib/time";
import { listCategories, monthSummary, upcomingBills } from "@/server/services/finance";
import { actorContext, requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Finanças" };

async function Overview() {
  const s = await requireSession();
  const ctx = actorContext(s);
  const { m, bills, categories } = await db.asUser(s.userId, async (q) => ({
    m: await monthSummary({ q, ctx }),
    bills: await upcomingBills({ q, ctx }, 15),
    categories: await listCategories({ q, ctx }),
  }));
  const max = Math.max(1, ...m.byCategory.map((c) => c.cents));
  const delta = m.previousExpenseCents ? Math.round(((m.expenseCents - m.previousExpenseCents) / m.previousExpenseCents) * 100) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Receitas", value: m.incomeCents, icon: TrendingUp, tone: "text-success" },
            { label: "Despesas", value: m.expenseCents, icon: TrendingDown, tone: "text-danger" },
            { label: "Saldo do mês", value: m.balanceCents, icon: Wallet, tone: m.balanceCents >= 0 ? "text-success" : "text-danger" },
          ].map((k) => (
            <Card key={k.label} className="p-4">
              <div className="flex items-center justify-between text-xs text-muted">{k.label}<k.icon className={`size-4 ${k.tone}`} aria-hidden /></div>
              <p className="mt-2 text-xl font-semibold tabular-nums">{formatCents(k.value)}</p>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader
            title={`Despesas por categoria · ${m.month}`}
            description={delta === null ? "Sem base de comparação com o mês anterior." : `${delta >= 0 ? "+" : ""}${delta}% vs. total do mês anterior.`}
          />
          <CardBody>
            {m.byCategory.length ? (
              <ul className="space-y-3">
                {m.byCategory.map((c) => (
                  <li key={c.category}>
                    <div className="mb-1 flex justify-between text-sm"><span>{c.category}</span><span className="tabular-nums text-muted">{formatCents(c.cents)}</span></div>
                    <div className="h-2 rounded-full bg-surface-2" role="presentation"><div className="h-2 rounded-full bg-gold" style={{ width: `${(c.cents / max) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<Wallet />} title="Nenhuma despesa neste mês" description="Registre ao lado ou diga ao assistente: “gastei 50 no mercado”." />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Contas a vencer (15 dias)" />
          {bills.length ? (
            <ul className="divide-y divide-border px-5 pb-2">
              {bills.map((b) => (
                <li key={b.id} className="flex justify-between py-3 text-sm">
                  <span>{b.description}<span className="ml-2 text-xs text-subtle">vence {b.due_on}</span></span>
                  <span className="tabular-nums">{formatCents(b.amount_cents)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody><p className="text-sm text-muted">Nenhuma conta pendente no período.</p></CardBody>
          )}
        </Card>
      </div>
      <Card className="h-fit">
        <CardHeader title="Novo lançamento" />
        <CardBody>
          <TransactionForm categories={categories} today={localDateString(ctx.now, ctx.timezone)} shared={s.workspace.kind !== "personal"} />
        </CardBody>
      </Card>
    </div>
  );
}

export default function FinancasPage() {
  return (
    <>
      <PageHeader title="Finanças" description="Organização financeira pessoal. Não constitui consultoria financeira." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Overview />
      </Suspense>
    </>
  );
}
