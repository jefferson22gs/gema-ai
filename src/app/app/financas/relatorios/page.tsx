import type { Metadata } from "next";
import { Suspense } from "react";
import { FileDown } from "lucide-react";
import { BarList } from "@/components/app/charts";
import { Alert, Card, CardBody, CardHeader, EmptyState, PageHeader, Skeleton, buttonVariants } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { localDateString } from "@/lib/time";
import { DomainError } from "@/server/context";
import { buildMonthlyReport } from "@/server/reports/monthly";
import { actorContext, requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Relatórios" };

function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const idx = y * 12 + (m - 1) - i;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
  });
}

async function Content({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const s = await requireSession();
  const ctx = actorContext(s);
  const months = lastMonths(localDateString(ctx.now, ctx.timezone), 12);
  const { mes } = await searchParams;
  const month = mes && months.includes(mes) ? mes : months[0];
  let report;
  try {
    report = await db.asUser(s.userId, (q) => buildMonthlyReport({ q, ctx }, month));
  } catch (e) {
    if (e instanceof DomainError && e.code === "forbidden") return <Alert tone="warning" title="Sem permissão">{e.message}</Alert>;
    throw e;
  }
  const label = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  const href = (format: string) => `/api/reports/monthly?month=${month}&format=${format}`;
  return (
    <div className="space-y-6">
      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-subtle">Mês</span>
          <select name="mes" defaultValue={month} className="h-10 rounded-md border border-border bg-surface px-3 text-sm capitalize">
            {months.map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </select>
        </label>
        <button className={buttonVariants({ variant: "secondary" })}>Ver</button>
        <div className="ml-auto flex flex-wrap gap-2">
          {(["pdf", "xlsx", "csv"] as const).map((f) => (
            <a key={f} href={href(f)} className={buttonVariants({ variant: f === "pdf" ? "primary" : "secondary", size: "sm" })} download>
              <FileDown /> {f.toUpperCase()}
            </a>
          ))}
        </div>
      </form>
      <div className="grid gap-3 sm:grid-cols-4">
        {([["Receitas", report.incomeCents], ["Despesas", report.expenseCents], ["Reembolsos", report.refundCents], ["Resultado", report.resultCents]] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border bg-surface p-4">
            <p className="text-xs text-subtle">{k}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatCents(v)}</p>
          </div>
        ))}
      </div>
      <Card>
        <CardHeader title={`Despesas por categoria — ${label(month)}`} description={`${report.rows.length} lançamento(s) no período. Projetados, cancelados e estornados aparecem na exportação, mas não somam.`} />
        <CardBody>
          {report.byCategory.length ? <BarList items={report.byCategory.map((c) => ({ label: c.category, cents: c.cents }))} /> : <EmptyState title="Sem despesas no período" />}
        </CardBody>
      </Card>
      <p className="text-xs text-subtle">Relatório gerencial a partir dos seus lançamentos. Não substitui documento contábil ou fiscal. Planilhas exportadas não contêm fórmulas.</p>
    </div>
  );
}

export default function RelatoriosPage(props: PageProps<"/app/financas/relatorios">) {
  return (
    <>
      <PageHeader title="Relatórios" description="Resumo mensal com exportação em PDF, Excel (XLSX) e CSV." />
      <Suspense fallback={<Skeleton className="h-80" />}><Content searchParams={props.searchParams as Promise<{ mes?: string }>} /></Suspense>
    </>
  );
}
