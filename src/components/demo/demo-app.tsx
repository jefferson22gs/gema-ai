"use client";

import { useMemo, useState } from "react";
import { Ban, CalendarClock, CheckCircle2, CreditCard, LayoutDashboard, MessageSquareText, ShieldCheck, Target } from "lucide-react";
import { BalanceLineChart, BarList, Progress } from "@/components/app/charts";
import { Badge, Button, Field, Input, Select } from "@/components/ui/primitives";
import { DEMO_SCRIPT, type DemoScenario } from "@/lib/demo/scenario";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { simulatePurchase } from "@/server/finance/engine";

const TABS = [
  { id: "inicio", label: "Início", icon: LayoutDashboard },
  { id: "assistente", label: "Assistente", icon: MessageSquareText },
  { id: "cartoes", label: "Cartões", icon: CreditCard },
  { id: "planejamento", label: "Metas e dívidas", icon: Target },
  { id: "agenda", label: "Agenda", icon: CalendarClock },
] as const;
type Tab = (typeof TABS)[number]["id"];

const dt = (iso: string) => new Date(`${iso.length === 10 ? `${iso}T12:00` : iso}:00`).toLocaleString("pt-BR", iso.length === 10 ? { day: "2-digit", month: "short" } : { weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border bg-surface p-5", className)}>
      <h3 className="mb-4 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-subtle">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Inicio({ s }: { s: DemoScenario }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Saldo em conta" value={formatCents(s.balanceCents)} hint="fictício" />
        <Stat label="Receitas do mês" value={formatCents(s.totals.incomeCents)} />
        <Stat label="Despesas do mês" value={formatCents(s.totals.expenseCents)} hint={`estorno abate ${formatCents(s.totals.refundCents)}`} />
        <Stat label="Resultado" value={formatCents(s.totals.resultCents)} hint="sem contar pagamento de fatura" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Saldo projetado (45 dias)">
          <BalanceLineChart points={s.cashflow.days} title="Saldo projetado da demonstração" />
          <p className="mt-2 text-xs text-muted">Menor saldo: {formatCents(s.cashflow.lowest.balanceCents)} em {dt(s.cashflow.lowest.date)}.</p>
          <ul className="mt-2 list-disc pl-4 text-xs text-subtle">{s.cashflow.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        </Panel>
        <Panel title="Despesas por categoria">
          <BarList items={s.categories} />
          <p className="mt-4 text-xs text-subtle">Compra cancelada e pagamento de fatura não entram como despesa (sem dupla contagem).</p>
        </Panel>
        <Panel title={`Saúde financeira: ${s.health.score}/100`}>
          <ul className="space-y-3">
            {s.health.components.map((c) => (
              <li key={c.key}>
                <div className="mb-1 flex justify-between text-sm"><span>{c.label}</span><span className="tabular-nums text-muted">{c.points}/{c.max}</span></div>
                <Progress pct={(c.points / c.max) * 100} label={c.label} />
                <p className="mt-1 text-xs text-subtle">{c.detail}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-subtle">{s.health.disclaimer}</p>
        </Panel>
        <Panel title="Assinaturas detectadas">
          {s.recurring.length ? (
            <ul className="divide-y divide-border text-sm">
              {s.recurring.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-2 py-2">
                  <span>{r.label}<span className="block text-xs text-subtle">a cada ~{r.intervalDays} dias · próxima {dt(r.nextEstimatedDate)}</span></span>
                  <span className="text-right tabular-nums">{formatCents(r.lastCents)}
                    {r.priceChangePct ? <Badge tone="warning" className="ml-2">+{r.priceChangePct}%</Badge> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Nenhuma recorrência.</p>}
          <p className="mt-3 text-xs text-subtle">São sugestões: no produto, você confirma antes de virar recorrência.</p>
        </Panel>
      </div>
    </div>
  );
}

function Assistente() {
  const [step, setStep] = useState(0);
  const [decision, setDecision] = useState<Record<number, "ok" | "cancel">>({});
  const shown = DEMO_SCRIPT.slice(0, step);
  return (
    <Panel title="Conversa roteirizada (sem IA real nesta demonstração)">
      <div className="space-y-3 text-sm" aria-live="polite">
        {shown.map((m, i) => (
          <div key={m.prompt} className="space-y-2">
            <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-gold-soft px-4 py-2.5">{m.prompt}</p>
            <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-border bg-bg-elevated px-4 py-3">
              <p className="mb-1 text-xs text-subtle">{m.agent}</p>
              <p className="flex gap-2">{m.blocked ? <Ban className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden /> : null}{m.reply}</p>
              {m.confirm ? (
                decision[i] ? (
                  <p className="mt-2 text-xs text-muted">{decision[i] === "ok" ? "✓ Confirmado: compromisso criado (na demonstração, nada é gravado)." : "Cancelado. Nada foi criado."}</p>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => setDecision({ ...decision, [i]: "ok" })}>Confirmar</Button>
                    <Button size="sm" variant="secondary" onClick={() => setDecision({ ...decision, [i]: "cancel" })}>Cancelar</Button>
                  </div>
                )
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {step < DEMO_SCRIPT.length ? (
        <Button className="mt-4" variant="secondary" onClick={() => setStep(step + 1)}>Enviar: “{DEMO_SCRIPT[step].prompt}”</Button>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-xs text-subtle"><ShieldCheck className="size-4" aria-hidden />Ações sensíveis pedem confirmação; transferências nunca são executadas pela IA.</p>
      )}
    </Panel>
  );
}

function Cartoes({ s }: { s: DemoScenario }) {
  const [valor, setValor] = useState("4800");
  const [parcelas, setParcelas] = useState("6");
  const sim = useMemo(() => {
    const cents = Math.round(Number(valor.replace(/\./g, "").replace(",", ".")) * 100);
    const n = Number(parcelas);
    if (!Number.isFinite(cents) || cents <= 0) return null;
    return simulatePurchase(cents, n, s.today, s.card.cycle, { [s.card.bill.reference]: s.card.openBillCents }, { limitCents: s.card.limitCents, usedCents: s.card.usedCents, availableCents: s.card.availableCents, usagePct: Math.round((s.card.usedCents / s.card.limitCents) * 100) });
  }, [valor, parcelas, s]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={s.card.name}>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div><p className="text-xs text-subtle">Limite</p><p className="tabular-nums">{formatCents(s.card.limitCents)}</p></div>
          <div><p className="text-xs text-subtle">Usado</p><p className="tabular-nums">{formatCents(s.card.usedCents)}</p></div>
          <div><p className="text-xs text-subtle">Disponível</p><p className="tabular-nums">{formatCents(s.card.availableCents)}</p></div>
        </div>
        <div className="mt-4"><Progress pct={(s.card.usedCents / s.card.limitCents) * 100} label="Uso do limite" /></div>
        <p className="mt-4 text-sm">Fatura aberta: <strong className="tabular-nums">{formatCents(s.card.openBillCents)}</strong> · fecha dia {s.card.cycle.closingDay}, vence {dt(s.card.bill.dueDate)}</p>
      </Panel>
      <Panel title="Simulador: posso comprar parcelado?">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor (R$)" htmlFor="demo-valor"><Input id="demo-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></Field>
          <Field label="Parcelas" htmlFor="demo-parc">
            <Select id="demo-parc" value={parcelas} onChange={(e) => setParcelas(e.target.value)}>
              {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}x</option>)}
            </Select>
          </Field>
        </div>
        {sim ? (
          <div className="mt-4 space-y-3 text-sm" aria-live="polite">
            <Badge tone={sim.fitsLimit ? "success" : "danger"}>{sim.fitsLimit ? "Cabe no limite" : "Ultrapassa o limite"}</Badge>
            <ul className="divide-y divide-border">
              {sim.bills.slice(0, 6).map((b) => (
                <li key={b.reference} className="flex justify-between py-1.5"><span>Fatura {b.reference}</span><span className="tabular-nums">{formatCents(b.beforeCents)} → <strong>{formatCents(b.afterCents)}</strong></span></li>
              ))}
            </ul>
            <p className="text-xs text-subtle">Calculado pelo mesmo motor do produto (centavos inteiros; sobra do arredondamento na 1ª parcela).</p>
          </div>
        ) : <p className="mt-4 text-sm text-muted">Informe um valor válido.</p>}
      </Panel>
    </div>
  );
}

function Planejamento({ s }: { s: DemoScenario }) {
  const { snowball, avalanche } = s.payoff;
  const better = avalanche.totalInterestCents <= snowball.totalInterestCents ? "avalanche" : "snowball";
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Metas">
        <ul className="space-y-4">
          {s.goals.map((g) => (
            <li key={g.name}>
              <div className="mb-1 flex justify-between text-sm"><span>{g.name}</span><span className="tabular-nums text-muted">{g.pct}%</span></div>
              <Progress pct={g.pct} label={g.name} tone="success" />
              <p className="mt-1 text-xs text-subtle">
                {formatCents(g.savedCents)} de {formatCents(g.targetCents)}
                {g.requiredMonthlyCents !== null ? ` · guardar ${formatCents(g.requiredMonthlyCents)}/mês para chegar no prazo` : ""}
              </p>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Quitação de dívidas (R$ 1.000/mês)">
        <ul className="mb-3 space-y-1 text-sm">{s.debts.map((d) => <li key={d.id} className="flex justify-between"><span>{d.name}</span><span className="tabular-nums text-muted">{formatCents(d.balanceCents)} · {(d.monthlyRate * 100).toFixed(1)}% a.m.</span></li>)}</ul>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[["Bola de neve", snowball], ["Avalanche", avalanche]].map(([label, r]) => {
            const res = r as typeof snowball;
            return (
              <div key={label as string} className={cn("rounded-lg border p-3", res.strategy === better ? "border-gold/60" : "border-border")}>
                <p className="font-medium">{label as string}</p>
                <p className="text-xs text-muted">{res.months} meses · juros {formatCents(res.totalInterestCents)}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-subtle">Estimativa educacional; não é proposta de crédito nem recomendação.</p>
      </Panel>
    </div>
  );
}

function Agenda({ s }: { s: DemoScenario }) {
  const [done, setDone] = useState<string[]>([]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Próximos compromissos">
        <ul className="divide-y divide-border text-sm">
          {s.agenda.map((e, i) => {
            const conflict = i > 0 && e.when.slice(0, 10) === s.agenda[i - 1].when.slice(0, 10) && Number(e.when.slice(11, 13)) === Number(s.agenda[i - 1].when.slice(11, 13));
            return (
              <li key={e.title} className="flex justify-between gap-2 py-2">
                <span>{e.title}<span className="block text-xs text-subtle">{e.place}</span></span>
                <span className="text-right text-xs text-muted">{dt(e.when)}{conflict ? <Badge tone="warning" className="ml-2">conflito</Badge> : null}</span>
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title="Tarefas">
        <ul className="space-y-2 text-sm">
          {s.tasks.map((t) => (
            <li key={t.title}>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 size-4 accent-[var(--color-gold)]" checked={done.includes(t.title)} onChange={(e) => setDone(e.target.checked ? [...done, t.title] : done.filter((d) => d !== t.title))} />
                <span className={done.includes(t.title) ? "text-subtle line-through" : ""}>{t.title}<span className="block text-xs text-subtle">até {dt(t.due)} · prioridade {t.priority}</span></span>
              </label>
            </li>
          ))}
        </ul>
        {done.length ? <p className="mt-3 flex items-center gap-1 text-xs text-success"><CheckCircle2 className="size-3.5" aria-hidden />Concluídas apenas nesta tela (nada é salvo).</p> : null}
      </Panel>
    </div>
  );
}

export function DemoApp({ scenario }: { scenario: DemoScenario }) {
  const [tab, setTab] = useState<Tab>("inicio");
  return (
    <div>
      <div role="tablist" aria-label="Módulos da demonstração" className="flex gap-1 overflow-x-auto border-b border-border pb-px">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`painel-${id}`}
            onClick={() => setTab(id)}
            className={cn("flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm", tab === id ? "border-gold text-fg" : "border-transparent text-muted hover:text-fg")}
          >
            <Icon className="size-4" aria-hidden />{label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`painel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-5">
        {tab === "inicio" ? <Inicio s={scenario} /> : null}
        {tab === "assistente" ? <Assistente /> : null}
        {tab === "cartoes" ? <Cartoes s={scenario} /> : null}
        {tab === "planejamento" ? <Planejamento s={scenario} /> : null}
        {tab === "agenda" ? <Agenda s={scenario} /> : null}
      </div>
    </div>
  );
}
