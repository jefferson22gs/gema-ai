/**
 * Motor financeiro determinístico (sem I/O). Toda conta oficial do produto passa por aqui —
 * a IA apenas interpreta pedidos e apresenta resultados calculados neste módulo.
 * Valores sempre em centavos inteiros; datas locais em "YYYY-MM-DD".
 */

export type LedgerKind = "expense" | "income" | "transfer" | "refund" | "card_payment";
export type LedgerStatus = "paid" | "pending" | "projected" | "reconciled" | "cancelled" | "reversed";

export interface LedgerEntry {
  kind: LedgerKind;
  status: LedgerStatus;
  amountCents: number;
  date: string;
  /** true quando a transferência é entre contas do próprio titular (não altera patrimônio). */
  internalTransfer?: boolean;
}

/** Estados que representam movimento efetivo (entram no realizado). */
export const REALIZED: ReadonlySet<LedgerStatus> = new Set(["paid", "reconciled"]);
/** Estados que entram em projeções futuras. */
export const FORECASTABLE: ReadonlySet<LedgerStatus> = new Set(["pending", "projected"]);

/**
 * Efeito no resultado (receitas − despesas). Regras anti-dupla contabilização:
 * - transferência própria e pagamento de fatura NÃO são despesa (a despesa já foi a compra no cartão);
 * - estorno/reembolso reduz despesa (entra positivo);
 * - cancelado e estornado (`reversed`) não contam.
 */
export function resultEffect(e: LedgerEntry): number {
  if (e.status === "cancelled" || e.status === "reversed") return 0;
  switch (e.kind) {
    case "income":
      return e.amountCents;
    case "expense":
      return -e.amountCents;
    case "refund":
      return e.amountCents;
    case "transfer":
    case "card_payment":
      return 0;
  }
}

export interface PeriodTotals {
  incomeCents: number;
  expenseCents: number;
  refundCents: number;
  resultCents: number;
  pendingOutCents: number;
  pendingInCents: number;
}

export function periodTotals(entries: LedgerEntry[]): PeriodTotals {
  const t: PeriodTotals = { incomeCents: 0, expenseCents: 0, refundCents: 0, resultCents: 0, pendingOutCents: 0, pendingInCents: 0 };
  for (const e of entries) {
    if (REALIZED.has(e.status)) {
      if (e.kind === "income") t.incomeCents += e.amountCents;
      else if (e.kind === "expense") t.expenseCents += e.amountCents;
      else if (e.kind === "refund") t.refundCents += e.amountCents;
      t.resultCents += resultEffect(e);
    } else if (FORECASTABLE.has(e.status)) {
      if (e.kind === "expense" || e.kind === "card_payment") t.pendingOutCents += e.amountCents;
      else if (e.kind === "income") t.pendingInCents += e.amountCents;
    }
  }
  return t;
}

// ---------------------------------------------------------------- Cartões e parcelas

export interface CardCycle {
  /** Dia do fechamento (1–31). Compras no dia do fechamento ou depois vão para a fatura seguinte. */
  closingDay: number;
  /** Dia do vencimento (1–31), no mês seguinte ao fechamento quando dueDay <= closingDay. */
  dueDay: number;
}

function clampDay(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

function addMonths(year: number, month: number, n: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export interface BillRef {
  /** Mês de referência da fatura (YYYY-MM) = mês do fechamento. */
  reference: string;
  closingDate: string;
  dueDate: string;
}

/** Fatura em que uma compra de `purchaseDate` entra. */
export function billFor(purchaseDate: string, cycle: CardCycle): BillRef {
  const [y, m, d] = purchaseDate.split("-").map(Number);
  const closesThisMonth = d < cycle.closingDay;
  const ref = closesThisMonth ? { year: y, month: m } : addMonths(y, m, 1);
  return billAt(ref.year, ref.month, cycle);
}

export function billAt(year: number, month: number, cycle: CardCycle): BillRef {
  const due = cycle.dueDay > cycle.closingDay ? { year, month } : addMonths(year, month, 1);
  return {
    reference: `${year}-${String(month).padStart(2, "0")}`,
    closingDate: clampDay(year, month, cycle.closingDay),
    dueDate: clampDay(due.year, due.month, cycle.dueDay),
  };
}

export interface Installment {
  number: number;
  total: number;
  amountCents: number;
  bill: BillRef;
}

/**
 * Divide uma compra em N parcelas sem perder centavos: a diferença do arredondamento
 * vai para a PRIMEIRA parcela (convenção comum dos emissores brasileiros).
 */
export function splitInstallments(totalCents: number, count: number, purchaseDate: string, cycle: CardCycle): Installment[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) throw new Error("valor inválido");
  if (!Number.isInteger(count) || count < 1 || count > 48) throw new Error("número de parcelas inválido (1–48)");
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  const first = billFor(purchaseDate, cycle);
  const [fy, fm] = first.reference.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const r = addMonths(fy, fm, i);
    return { number: i + 1, total: count, amountCents: base + (i === 0 ? remainder : 0), bill: billAt(r.year, r.month, cycle) };
  });
}

export interface CardLimit {
  limitCents: number;
  usedCents: number;
  availableCents: number;
  usagePct: number;
}

/** Limite usado = parcelas em aberto (fatura atual e futuras) − pagamentos ainda não abatidos. */
export function cardLimit(limitCents: number, openInstallmentsCents: number[], creditsCents = 0): CardLimit {
  const used = Math.max(0, openInstallmentsCents.reduce((s, v) => s + v, 0) - creditsCents);
  return { limitCents, usedCents: used, availableCents: Math.max(0, limitCents - used), usagePct: limitCents ? Math.round((used / limitCents) * 1000) / 10 : 0 };
}

/** Simulador: impacto de uma nova compra parcelada nas próximas faturas. */
export function simulatePurchase(
  totalCents: number,
  count: number,
  purchaseDate: string,
  cycle: CardCycle,
  currentBills: Record<string, number>,
  limit: CardLimit,
): { bills: { reference: string; beforeCents: number; afterCents: number }[]; fitsLimit: boolean; availableAfterCents: number } {
  const parts = splitInstallments(totalCents, count, purchaseDate, cycle);
  const bills = parts.map((p) => {
    const before = currentBills[p.bill.reference] ?? 0;
    return { reference: p.bill.reference, beforeCents: before, afterCents: before + p.amountCents };
  });
  return { bills, fitsLimit: totalCents <= limit.availableCents, availableAfterCents: limit.availableCents - totalCents };
}

// ---------------------------------------------------------------- Metas

export interface GoalProgress {
  targetCents: number;
  savedCents: number;
  remainingCents: number;
  pct: number;
  monthsLeft: number | null;
  /** Contribuição mensal necessária para atingir no prazo (arredondada para cima). */
  requiredMonthlyCents: number | null;
}

export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
}

export function goalProgress(targetCents: number, savedCents: number, today: string, deadline?: string | null): GoalProgress {
  const remaining = Math.max(0, targetCents - savedCents);
  const monthsLeft = deadline ? monthsBetween(today, deadline) : null;
  return {
    targetCents,
    savedCents,
    remainingCents: remaining,
    pct: targetCents ? Math.min(100, Math.round((savedCents / targetCents) * 1000) / 10) : 0,
    monthsLeft,
    requiredMonthlyCents: monthsLeft === null ? null : remaining === 0 ? 0 : Math.ceil(remaining / Math.max(1, monthsLeft)),
  };
}

/** Meses para atingir a meta com contribuição fixa (sem juros). null se contribuição ≤ 0. */
export function monthsToGoal(remainingCents: number, monthlyCents: number): number | null {
  if (remainingCents <= 0) return 0;
  if (monthlyCents <= 0) return null;
  return Math.ceil(remainingCents / monthlyCents);
}

// ---------------------------------------------------------------- Fluxo de caixa

export interface CashflowEvent {
  date: string;
  /** positivo = entrada, negativo = saída. */
  deltaCents: number;
  label: string;
  source: "pending" | "recurring" | "card_bill" | "projected";
}

export interface CashflowDay {
  date: string;
  inCents: number;
  outCents: number;
  balanceCents: number;
}

/**
 * Projeção de saldo dia a dia a partir do saldo atual REALIZADO, aplicando apenas eventos futuros
 * conhecidos. É estimativa: o resultado declara as hipóteses usadas.
 */
export function projectCashflow(startBalanceCents: number, from: string, days: number, events: CashflowEvent[]) {
  const byDate = new Map<string, CashflowEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const out: CashflowDay[] = [];
  let balance = startBalanceCents;
  let lowest = { date: from, balanceCents: startBalanceCents };
  const [y, m, d] = from.split("-").map(Number);
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    const todays = byDate.get(date) ?? [];
    const inCents = todays.filter((e) => e.deltaCents > 0).reduce((s, e) => s + e.deltaCents, 0);
    const outCents = todays.filter((e) => e.deltaCents < 0).reduce((s, e) => s - e.deltaCents, 0);
    balance += inCents - outCents;
    out.push({ date, inCents, outCents, balanceCents: balance });
    if (balance < lowest.balanceCents) lowest = { date, balanceCents: balance };
  }
  return {
    days: out,
    endBalanceCents: balance,
    lowest,
    assumptions: [
      "Parte do saldo realizado atual das contas cadastradas/conectadas.",
      "Considera apenas lançamentos pendentes, recorrências ativas e faturas em aberto já registrados.",
      "Não prevê gastos que ainda não foram lançados; não é garantia de resultado.",
    ],
  };
}

/** "Posso fazer esta compra?" — verifica se o saldo projetado continua acima de um piso. */
export function canAfford(projection: { days: CashflowDay[] }, amountCents: number, date: string, floorCents = 0) {
  const lowestAfter = projection.days.filter((d) => d.date >= date).reduce((min, d) => Math.min(min, d.balanceCents), Infinity);
  const after = (Number.isFinite(lowestAfter) ? lowestAfter : 0) - amountCents;
  return { ok: after >= floorCents, lowestBalanceAfterCents: after, floorCents };
}

// ---------------------------------------------------------------- Dívidas

export interface Debt {
  id: string;
  name: string;
  balanceCents: number;
  /** juros mensais em fração (ex.: 0.025 = 2,5% a.m.). */
  monthlyRate: number;
  minPaymentCents: number;
}

export interface PayoffResult {
  strategy: "snowball" | "avalanche";
  months: number;
  totalInterestCents: number;
  order: string[];
  feasible: boolean;
}

/**
 * Simulação de quitação (estimativa educacional, não condição contratual):
 * snowball = menor saldo primeiro; avalanche = maior juros primeiro. Pagamento total mensal fixo.
 */
export function simulatePayoff(debts: Debt[], monthlyBudgetCents: number, strategy: "snowball" | "avalanche", maxMonths = 600): PayoffResult {
  const state = debts.map((d) => ({ ...d }));
  const minTotal = state.reduce((s, d) => s + d.minPaymentCents, 0);
  if (monthlyBudgetCents < minTotal) return { strategy, months: 0, totalInterestCents: 0, order: [], feasible: false };
  const order: string[] = [];
  let interest = 0;
  let month = 0;
  while (state.some((d) => d.balanceCents > 0) && month < maxMonths) {
    month++;
    for (const d of state) {
      if (d.balanceCents <= 0) continue;
      const i = Math.round(d.balanceCents * d.monthlyRate);
      interest += i;
      d.balanceCents += i;
    }
    let budget = monthlyBudgetCents;
    for (const d of state) {
      if (d.balanceCents <= 0) continue;
      const pay = Math.min(d.minPaymentCents, d.balanceCents);
      d.balanceCents -= pay;
      budget -= pay;
    }
    const targets = state
      .filter((d) => d.balanceCents > 0)
      .sort((a, b) => (strategy === "snowball" ? a.balanceCents - b.balanceCents : b.monthlyRate - a.monthlyRate || a.balanceCents - b.balanceCents));
    for (const d of targets) {
      if (budget <= 0) break;
      const pay = Math.min(budget, d.balanceCents);
      d.balanceCents -= pay;
      budget -= pay;
    }
    for (const d of state) if (d.balanceCents <= 0 && !order.includes(d.id)) order.push(d.id);
  }
  return { strategy, months: month, totalInterestCents: interest, order, feasible: !state.some((d) => d.balanceCents > 0) };
}

// ---------------------------------------------------------------- Recorrências

export interface RecurringCandidate {
  key: string;
  label: string;
  occurrences: number;
  averageCents: number;
  lastCents: number;
  lastDate: string;
  intervalDays: number;
  nextEstimatedDate: string;
  priceChangePct: number | null;
}

/** Normaliza descrição para agrupar cobranças do mesmo estabelecimento ("NETFLIX.COM 123" ⇒ "netflix com"). */
export function merchantKey(description: string): string {
  return description
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\d+/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ");
}

/**
 * Detecta despesas que se repetem em intervalo regular (~semanal, ~mensal, ~anual) com valor estável (±20%).
 * São SUGESTÕES: o usuário confirma antes de virar recorrência.
 */
export function detectRecurring(txs: { description: string; amountCents: number; date: string }[]): RecurringCandidate[] {
  const groups = new Map<string, typeof txs>();
  for (const t of txs) {
    const k = merchantKey(t.description);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86_400_000;
  const out: RecurringCandidate[] = [];
  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = sorted.slice(1).map((t, i) => day(t.date) - day(sorted[i].date));
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const period = [7, 30, 365].find((p) => Math.abs(avgGap - p) <= p * 0.2);
    if (!period || gaps.some((g) => Math.abs(g - period) > period * 0.35)) continue;
    const avg = Math.round(sorted.reduce((s, t) => s + t.amountCents, 0) / sorted.length);
    if (sorted.some((t) => Math.abs(t.amountCents - avg) > avg * 0.2 && t !== sorted[sorted.length - 1])) continue;
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const next = new Date((day(last.date) + period) * 86_400_000).toISOString().slice(0, 10);
    out.push({
      key,
      label: last.description,
      occurrences: sorted.length,
      averageCents: avg,
      lastCents: last.amountCents,
      lastDate: last.date,
      intervalDays: period,
      nextEstimatedDate: next,
      priceChangePct: prev.amountCents ? Math.round(((last.amountCents - prev.amountCents) / prev.amountCents) * 1000) / 10 : null,
    });
  }
  return out.sort((a, b) => b.averageCents - a.averageCents);
}

// ---------------------------------------------------------------- Patrimônio

export type AssetKind = "cash" | "investment" | "property" | "vehicle" | "business" | "other";

export interface NetWorthInput {
  today: string;
  /** Bens cadastrados pelo usuário (valor informado por ele, com data da avaliação). */
  assets: { name: string; kind: AssetKind; valueCents: number; liquid: boolean; valuedOn: string }[];
  /** Saldos informados pelos bancos (Open Finance). null = banco não informou. */
  bankAccounts: { name: string; balanceCents: number | null; balanceAt: string | null }[];
  /** Saldo calculado pelos lançamentos das contas manuais; null quando não há conta manual. */
  registeredCashCents: number | null;
  debts: { creditor: string; kind: string; balanceCents: number }[];
  /** Compras de cartão ainda não pagas (faturas abertas e parcelas futuras). */
  cards: { name: string; openCents: number }[];
}

export interface NetWorthLine {
  group: string;
  label: string;
  cents: number;
  note?: string;
}

export interface NetWorth {
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
  /** Parte dos ativos com liquidez imediata (contas, caixa e bens marcados como líquidos). */
  liquidCents: number;
  assets: NetWorthLine[];
  liabilities: NetWorthLine[];
  warnings: string[];
  assumptions: string[];
}

const ASSET_GROUP: Record<AssetKind, string> = {
  cash: "Dinheiro e contas", investment: "Investimentos", property: "Imóveis", vehicle: "Veículos", business: "Participações e negócios", other: "Outros bens",
};

/**
 * Patrimônio líquido = ativos − passivos, com regras explícitas contra dupla contagem:
 * - conta manual ligada a um banco conectado entra pelo saldo do banco, não pelos lançamentos (o chamador exclui);
 * - compras no cartão entram como passivo enquanto não pagas; o pagamento da fatura reduz o caixa e zera o passivo;
 * - bens usam o valor informado pelo usuário (não é avaliação de mercado).
 */
export function netWorth(i: NetWorthInput): NetWorth {
  const assets: NetWorthLine[] = [];
  const liabilities: NetWorthLine[] = [];
  const warnings: string[] = [];
  let liquid = 0;

  for (const b of i.bankAccounts) {
    if (b.balanceCents === null) {
      warnings.push(`${b.name}: o banco não informou o saldo; a conta ficou fora do cálculo.`);
      continue;
    }
    assets.push({ group: ASSET_GROUP.cash, label: b.name, cents: b.balanceCents, note: b.balanceAt ? `saldo informado pelo banco em ${b.balanceAt.slice(0, 10)}` : undefined });
    liquid += b.balanceCents;
  }
  if (i.registeredCashCents !== null) {
    assets.push({ group: ASSET_GROUP.cash, label: "Contas registradas no GEMA", cents: i.registeredCashCents, note: "saldo de abertura + lançamentos pagos" });
    liquid += i.registeredCashCents;
  }
  for (const a of i.assets) {
    assets.push({ group: ASSET_GROUP[a.kind], label: a.name, cents: a.valueCents, note: `valor informado em ${a.valuedOn}` });
    if (a.liquid) liquid += a.valueCents;
    if (monthsBetween(a.valuedOn, i.today) >= 12) warnings.push(`${a.name}: valor informado há mais de 12 meses; considere atualizar.`);
  }
  for (const d of i.debts) if (d.balanceCents > 0) liabilities.push({ group: "Dívidas", label: d.creditor, cents: d.balanceCents });
  for (const c of i.cards) if (c.openCents > 0) liabilities.push({ group: "Cartões (compras não pagas)", label: c.name, cents: c.openCents });
  if (i.debts.some((d) => d.kind === "credit_card" && d.balanceCents > 0) && i.cards.some((c) => c.openCents > 0)) {
    warnings.push("Há dívida do tipo cartão cadastrada e compras em aberto em cartões: confira se não é o mesmo valor contado duas vezes.");
  }
  const sum = (l: NetWorthLine[]) => l.reduce((s, x) => s + x.cents, 0);
  const assetsCents = sum(assets);
  const liabilitiesCents = sum(liabilities);
  return {
    assetsCents,
    liabilitiesCents,
    netWorthCents: assetsCents - liabilitiesCents,
    liquidCents: Math.max(0, liquid),
    assets: assets.sort((a, b) => a.group.localeCompare(b.group) || b.cents - a.cents),
    liabilities: liabilities.sort((a, b) => b.cents - a.cents),
    warnings,
    assumptions: [
      "Bens entram pelo valor que você informou; não é avaliação de mercado.",
      "Saldos bancários são os informados pelo banco na data indicada.",
      "Compras parceladas no cartão contam integralmente como passivo até serem pagas.",
    ],
  };
}

/** Variação entre fotografias (null quando não há anterior). */
export function netWorthChange(current: number, previous: number | null): { cents: number; pct: number | null } | null {
  if (previous === null) return null;
  return { cents: current - previous, pct: previous !== 0 ? Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10 : null };
}

// ---------------------------------------------------------------- Saúde financeira

export interface HealthInputs {
  monthlyIncomeCents: number;
  monthlyExpenseCents: number;
  liquidReserveCents: number;
  debtPaymentsCents: number;
  creditCardUsagePct: number | null;
  monthsWithPositiveResult: number;
  monthsObserved: number;
}

export interface HealthScore {
  score: number;
  components: { key: string; label: string; points: number; max: number; detail: string }[];
  disclaimer: string;
}

/**
 * Indicador próprio e transparente (0–100), soma de 5 componentes de 20 pontos. NÃO é score de crédito.
 */
export function financialHealth(i: HealthInputs): HealthScore {
  const savingsRate = i.monthlyIncomeCents > 0 ? (i.monthlyIncomeCents - i.monthlyExpenseCents) / i.monthlyIncomeCents : 0;
  const reserveMonths = i.monthlyExpenseCents > 0 ? i.liquidReserveCents / i.monthlyExpenseCents : 0;
  const debtRatio = i.monthlyIncomeCents > 0 ? i.debtPaymentsCents / i.monthlyIncomeCents : 1;
  const regularity = i.monthsObserved > 0 ? i.monthsWithPositiveResult / i.monthsObserved : 0;
  const clamp = (v: number) => Math.max(0, Math.min(20, Math.round(v)));
  const components = [
    { key: "savings", label: "Taxa de poupança", points: clamp((savingsRate / 0.2) * 20), max: 20, detail: `${Math.round(savingsRate * 100)}% da renda sobra (meta de referência: 20%)` },
    { key: "reserve", label: "Reserva de emergência", points: clamp((reserveMonths / 6) * 20), max: 20, detail: `${reserveMonths.toFixed(1)} meses de despesas (referência: 6)` },
    { key: "debt", label: "Comprometimento com dívidas", points: clamp(((0.3 - debtRatio) / 0.3) * 20), max: 20, detail: `${Math.round(debtRatio * 100)}% da renda em parcelas (referência: até 30%)` },
    {
      key: "credit",
      label: "Dependência de crédito",
      points: i.creditCardUsagePct === null ? 10 : clamp(((100 - i.creditCardUsagePct) / 70) * 20),
      max: 20,
      detail: i.creditCardUsagePct === null ? "Sem cartões cadastrados (pontuação neutra)" : `${i.creditCardUsagePct}% do limite usado`,
    },
    { key: "regularity", label: "Regularidade", points: clamp(regularity * 20), max: 20, detail: `${i.monthsWithPositiveResult} de ${i.monthsObserved} meses com saldo positivo` },
  ];
  return {
    score: components.reduce((s, c) => s + c.points, 0),
    components,
    disclaimer: "Indicador educacional do GEMA AI calculado com os seus registros. Não é score de crédito nem recomendação de investimento.",
  };
}
