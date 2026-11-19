import type { Metadata } from "next";
import { Suspense } from "react";
import { PiggyBank } from "lucide-react";
import { BudgetForm } from "@/components/app/finance-forms";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { listBudgets, listCategories } from "@/server/services/finance";
import { actorContext, requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Orçamentos" };

async function Budgets() {
  const s = await requireSession();
  const ctx = actorContext(s);
  const { budgets, categories } = await db.asUser(s.userId, async (q) => ({ budgets: await listBudgets({ q, ctx }), categories: await listCategories({ q, ctx }, "expense") }));
  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <Card>
        <CardHeader title="Orçamento do mês" description="Gasto real vs. limite por categoria." />
        <CardBody>
          {budgets.length ? (
            <ul className="space-y-5">
              {budgets.map((b) => {
                const pct = Math.round((b.spent_cents / b.limit_cents) * 100);
                const tone = pct >= 100 ? "danger" : pct >= 80 ? "warning" : "success";
                return (
                  <li key={b.id}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span>{b.category_name}</span>
                      <span className="flex items-center gap-2 tabular-nums text-muted">{formatCents(b.spent_cents)} / {formatCents(b.limit_cents)} <Badge tone={tone}>{pct}%</Badge></span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${b.category_name}: ${pct}% do limite`}>
                      <div className={`h-2 rounded-full ${tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-success"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={<PiggyBank />} title="Nenhum orçamento definido" description="Defina limites mensais por categoria para receber alertas." />
          )}
        </CardBody>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Definir limite" />
        <CardBody><BudgetForm categories={categories} /></CardBody>
      </Card>
    </div>
  );
}

export default function OrcamentosPage() {
  return (
    <>
      <PageHeader title="Orçamentos" />
      <Suspense fallback={<Skeleton className="h-72" />}><Budgets /></Suspense>
    </>
  );
}
