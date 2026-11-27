import type { Metadata } from "next";
import { Suspense } from "react";
import { CreditCard } from "lucide-react";
import { ActionForm } from "@/components/app/action-form";
import { Progress } from "@/components/app/charts";
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { localDateString } from "@/lib/time";
import { cardSummary, listCards } from "@/server/services/cards";
import { listCategories } from "@/server/services/finance";
import { actorContext, requireSession } from "@/server/session";
import { createCardAction, createCardPurchaseAction, payBillAction } from "../actions";

export const metadata: Metadata = { title: "Cartões" };

const BILL_STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "gold" }> = {
  open: { label: "Aberta", tone: "gold" },
  closed: { label: "Fechada", tone: "warning" },
  paid: { label: "Paga", tone: "success" },
  partial: { label: "Paga parcialmente", tone: "warning" },
  overdue: { label: "Vencida", tone: "danger" },
};

async function Cards() {
  const s = await requireSession();
  const ctx = actorContext(s);
  const today = localDateString(ctx.now, ctx.timezone);
  const { summaries, categories } = await db.asUser(s.userId, async (q) => {
    const list = await listCards({ q, ctx });
    return {
      summaries: await Promise.all(list.map((c) => cardSummary({ q, ctx }, c.id, today))),
      categories: await listCategories({ q, ctx }, "expense"),
    };
  });
  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-6">
        {summaries.length ? summaries.map(({ card, limit, bills, current }) => {
          const upcoming = bills.filter((b) => b.status !== "paid" && b.reference >= (current?.reference ?? "")).slice(0, 6);
          return (
            <Card key={card.id}>
              <CardHeader
                title={<span className="flex items-center gap-2"><CreditCard className="size-4 text-gold" />{card.name}{card.last4 ? <span className="text-muted">•••• {card.last4}</span> : null}</span>}
                description={`Fecha dia ${card.closing_day} · vence dia ${card.due_day}${card.source === "open_finance" ? " · importado" : ""}`}
              />
              <CardBody className="space-y-5">
                <div>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span>Limite usado {formatCents(limit.usedCents)} de {formatCents(limit.limitCents)}</span>
                    <span className="tabular-nums text-muted">{limit.usagePct}%</span>
                  </div>
                  <Progress pct={limit.usagePct} tone={limit.usagePct >= 90 ? "danger" : limit.usagePct >= 80 ? "warning" : "gold"} label={`Limite usado: ${limit.usagePct}%`} />
                  <p className="mt-1.5 text-xs text-muted">Disponível: {formatCents(limit.availableCents)} (inclui parcelas futuras já lançadas)</p>
                </div>
                {upcoming.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <caption className="sr-only">Faturas de {card.name}</caption>
                      <thead className="text-left text-xs text-subtle"><tr><th className="py-2 font-medium">Fatura</th><th className="font-medium">Vencimento</th><th className="text-right font-medium">Total</th><th className="pl-3 font-medium">Status</th></tr></thead>
                      <tbody className="divide-y divide-border">
                        {upcoming.map((b) => (
                          <tr key={b.id}>
                            <td className="py-2">{b.reference}{b.id === current?.id ? <Badge tone="gold" className="ml-2">atual</Badge> : null}</td>
                            <td className="tabular-nums text-muted">{b.due_date}</td>
                            <td className="text-right tabular-nums">{formatCents(b.total_cents)}{b.paid_cents ? <span className="block text-[11px] text-muted">pago {formatCents(b.paid_cents)}</span> : null}</td>
                            <td className="pl-3"><Badge tone={BILL_STATUS[b.status]?.tone ?? "neutral"}>{BILL_STATUS[b.status]?.label ?? b.status}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-sm text-muted">Nenhuma fatura em aberto.</p>}
                {current && current.status !== "paid" ? (
                  <details className="rounded-lg border border-border p-3">
                    <summary className="cursor-pointer text-sm font-medium">Registrar pagamento da fatura {current.reference}</summary>
                    <div className="mt-3">
                      <ActionForm action={payBillAction} submitLabel="Registrar pagamento">
                        <input type="hidden" name="billId" value={current.id} />
                        <Field label="Valor pago (R$)" htmlFor={`pay-${card.id}`} hint="O pagamento não é contado como despesa — as despesas são as compras.">
                          <Input id={`pay-${card.id}`} name="amount" inputMode="decimal" defaultValue={((current.total_cents - current.paid_cents) / 100).toFixed(2).replace(".", ",")} required />
                        </Field>
                      </ActionForm>
                    </div>
                  </details>
                ) : null}
              </CardBody>
            </Card>
          );
        }) : (
          <Card><EmptyState icon={<CreditCard />} title="Nenhum cartão cadastrado" description="Cadastre um cartão para acompanhar faturas, parcelas e limite. Com Open Finance, os cartões são importados." /></Card>
        )}
      </div>

      <div className="space-y-6">
        {summaries.length ? (
          <Card>
            <CardHeader title="Nova compra no cartão" />
            <CardBody>
              <ActionForm action={async (st, f) => { f.set("idempotencyKey", `form:${crypto.randomUUID()}`); return createCardPurchaseAction(st, f); }} submitLabel="Registrar compra">
                <Field label="Cartão" htmlFor="cardId">
                  <Select id="cardId" name="cardId" required>{summaries.map(({ card }) => <option key={card.id} value={card.id}>{card.name}</option>)}</Select>
                </Field>
                <Field label="Descrição" htmlFor="pdesc"><Input id="pdesc" name="description" required maxLength={200} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Valor total (R$)" htmlFor="pamount"><Input id="pamount" name="amount" inputMode="decimal" required /></Field>
                  <Field label="Parcelas" htmlFor="pinst"><Input id="pinst" name="installments" type="number" min={1} max={48} defaultValue={1} /></Field>
                </div>
                <Field label="Data da compra" htmlFor="pdate"><Input id="pdate" name="date" type="date" defaultValue={today} required /></Field>
                <Field label="Categoria" htmlFor="pcat">
                  <Select id="pcat" name="categoryId" defaultValue=""><option value="">Sem categoria</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                </Field>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
        <Card>
          <CardHeader title="Cadastrar cartão" description="Guardamos apenas os 4 últimos dígitos." />
          <CardBody>
            <ActionForm action={createCardAction} submitLabel="Cadastrar">
              <Field label="Nome" htmlFor="cname"><Input id="cname" name="name" required placeholder="Ex.: Nubank pessoal" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Limite (R$)" htmlFor="climit"><Input id="climit" name="limit" inputMode="decimal" required /></Field>
                <Field label="Final" htmlFor="clast4"><Input id="clast4" name="last4" inputMode="numeric" maxLength={4} pattern="\d{4}" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Dia do fechamento" htmlFor="cclose"><Input id="cclose" name="closingDay" type="number" min={1} max={31} required /></Field>
                <Field label="Dia do vencimento" htmlFor="cdue"><Input id="cdue" name="dueDay" type="number" min={1} max={31} required /></Field>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default function CartoesPage() {
  return (
    <>
      <PageHeader title="Cartões" description="Limites, faturas e parcelas calculados pelo sistema a partir dos seus lançamentos." />
      <Suspense fallback={<Skeleton className="h-96" />}><Cards /></Suspense>
    </>
  );
}
