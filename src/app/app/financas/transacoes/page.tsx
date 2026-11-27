import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download, Receipt, Trash2, Upload } from "lucide-react";
import { Badge, Card, EmptyState, Input, PageHeader, Select, Skeleton, buttonVariants } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { Recategorize } from "@/components/app/recategorize";
import { listCategories, listTransactions } from "@/server/services/finance";
import { actorContext, requireSession } from "@/server/session";
import { deleteTransactionAction, markPaidAction } from "../../actions";

export const metadata: Metadata = { title: "Lançamentos" };

const SOURCE_LABEL: Record<string, string> = { whatsapp: "WhatsApp", ai: "IA", import: "Importado", recurring: "Recorrente", document: "Documento" };

async function List({ searchParams }: { searchParams: PageProps<"/app/financas/transacoes">["searchParams"] }) {
  const sp = await searchParams;
  const s = await requireSession();
  const ctx = actorContext(s);
  const kind = sp.tipo === "expense" || sp.tipo === "income" ? sp.tipo : undefined;
  const search = typeof sp.q === "string" ? sp.q.slice(0, 100) : undefined;
  const { rows, categories } = await db.asUser(s.userId, async (q) => ({
    rows: await listTransactions({ q, ctx }, { kind, search, limit: 200 }),
    categories: await listCategories({ q, ctx }),
  }));
  const byKind = (k: string) => categories.filter((c) => c.kind === k).map((c) => ({ id: c.id, name: c.name }));
  return (
    <>
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <label htmlFor="q" className="sr-only">Buscar</label>
        <Input id="q" name="q" defaultValue={search} placeholder="Buscar descrição" className="max-w-xs" />
        <label htmlFor="tipo" className="sr-only">Tipo</label>
        <Select id="tipo" name="tipo" defaultValue={kind ?? ""} className="max-w-40">
          <option value="">Todos</option>
          <option value="expense">Despesas</option>
          <option value="income">Receitas</option>
        </Select>
        <button className={buttonVariants({ variant: "secondary" })}>Filtrar</button>
      </form>
      <Card>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-subtle">
                <tr className="border-b border-border">
                  <th className="px-5 py-3 font-medium">Data</th>
                  <th className="px-3 py-3 font-medium">Descrição</th>
                  <th className="px-3 py-3 font-medium">Categoria</th>
                  <th className="px-3 py-3 text-right font-medium">Valor</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-5 py-3"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td className="px-5 py-3 tabular-nums text-muted">{t.occurred_on}</td>
                    <td className="px-3 py-3">{t.description}{t.source !== "manual" ? <Badge className="ml-2">{SOURCE_LABEL[t.source] ?? t.source}</Badge> : null}</td>
                    <td className="px-3 py-3 text-muted">
                      {t.owner_id === s.userId && (t.kind === "expense" || t.kind === "income")
                        ? <Recategorize id={t.id} description={t.description} value={t.category_id} options={byKind(t.kind)} />
                        : t.category_name ?? "—"}
                    </td>
                    <td className={`px-3 py-3 text-right tabular-nums ${t.kind === "expense" ? "text-fg" : "text-success"}`}>{t.kind === "expense" ? "-" : "+"}{formatCents(t.amount_cents)}</td>
                    <td className="px-3 py-3">
                      {t.status === "paid" ? <Badge tone="success">Pago</Badge> : (
                        <form action={markPaidAction} className="inline">
                          <input type="hidden" name="id" value={t.id} />
                          <button className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] text-warning hover:underline" title="Marcar como pago">Pendente {t.due_on ? `· ${t.due_on}` : ""}</button>
                        </form>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {t.owner_id === s.userId ? (
                        <form action={deleteTransactionAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <button className="text-subtle hover:text-danger" aria-label={`Excluir ${t.description}`}><Trash2 className="size-4" /></button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Receipt />} title="Nenhum lançamento encontrado" description="Ajuste os filtros ou registre na visão geral." />
        )}
      </Card>
    </>
  );
}

export default function TransacoesPage(props: PageProps<"/app/financas/transacoes">) {
  return (
    <>
      <PageHeader
        title="Lançamentos"
        actions={
          <div className="flex gap-2">
            <Link href="/app/financas/importar" className={buttonVariants({ variant: "secondary", size: "sm" })}><Upload /> Importar</Link>
            <Link href="/api/export/transactions" prefetch={false} className={buttonVariants({ variant: "secondary", size: "sm" })}><Download /> Exportar CSV</Link>
          </div>
        }
      />
      <Suspense fallback={<Skeleton className="h-80" />}>
        <List searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
