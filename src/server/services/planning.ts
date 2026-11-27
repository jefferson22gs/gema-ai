import { localDateString } from "@/lib/time";
import { detectRecurring, financialHealth, goalProgress, projectCashflow, simulatePayoff, type CashflowEvent, type Debt } from "../finance/engine";
import { DomainError, type ServiceDeps } from "../context";

// ---------------------------------------------------------------- Metas

export interface GoalRow {
  id: string;
  name: string;
  kind: string;
  target_cents: number;
  deadline: string | null;
  status: string;
  saved_cents: number;
}

export async function listGoals({ q, ctx }: ServiceDeps): Promise<(GoalRow & ReturnType<typeof goalProgress>)[]> {
  const rows = await q.query<GoalRow>(
    `select g.id, g.name, g.kind, g.target_cents, g.deadline, g.status,
       coalesce((select sum(c.amount_cents) from goal_contributions c where c.goal_id = g.id), 0)::bigint as saved_cents
     from goals g where g.workspace_id = $1 and g.status <> 'cancelled' order by g.created_at`,
    [ctx.workspaceId],
  );
  const today = localDateString(ctx.now, ctx.timezone);
  return rows.map((r) => ({ ...r, ...goalProgress(r.target_cents, r.saved_cents, today, r.deadline) }));
}

export async function createGoal(deps: ServiceDeps, input: { name: string; kind?: string; targetCents: number; deadline?: string; visibility?: "private" | "workspace" }) {
  if (!input.name.trim()) throw new DomainError("invalid", "Nome da meta obrigatório.");
  if (!Number.isInteger(input.targetCents) || input.targetCents <= 0) throw new DomainError("invalid", "Valor objetivo inválido.");
  const [row] = await deps.q.query<{ id: string }>(
    "insert into goals (workspace_id, owner_id, visibility, name, kind, target_cents, deadline) values ($1, $2, $3, $4, $5, $6, $7) returning id",
    [deps.ctx.workspaceId, deps.ctx.userId, input.visibility ?? "private", input.name.trim(), input.kind ?? "custom", input.targetCents, input.deadline ?? null],
  );
  return row.id;
}

export async function contributeToGoal(deps: ServiceDeps, goalId: string, amountCents: number, idempotencyKey?: string) {
  if (!Number.isInteger(amountCents) || amountCents === 0) throw new DomainError("invalid", "Valor inválido.");
  const goals = await deps.q.query<{ id: string }>("select id from goals where id = $1 and workspace_id = $2", [goalId, deps.ctx.workspaceId]);
  if (!goals.length) throw new DomainError("not_found", "Meta não encontrada.");
  await deps.q.query(
    `insert into goal_contributions (goal_id, workspace_id, owner_id, amount_cents, contributed_on, idempotency_key)
     values ($1, $2, $3, $4, $5, $6) on conflict (workspace_id, idempotency_key) do nothing`,
    [goalId, deps.ctx.workspaceId, deps.ctx.userId, amountCents, localDateString(deps.ctx.now, deps.ctx.timezone), idempotencyKey ?? null],
  );
  const goal = (await listGoals(deps)).find((g) => g.id === goalId)!;
  if (goal.remainingCents === 0 && goal.status === "active") {
    await deps.q.query("update goals set status = 'achieved', achieved_at = now() where id = $1", [goalId]);
  }
  return goal;
}

// ---------------------------------------------------------------- Dívidas

export interface DebtRow {
  id: string;
  creditor: string;
  kind: string;
  balance_cents: number;
  monthly_rate: string;
  min_payment_cents: number;
  terms_source: "estimated" | "contractual";
  status: string;
}

export async function listDebts({ q, ctx }: ServiceDeps): Promise<DebtRow[]> {
  return q.query<DebtRow>(
    "select id, creditor, kind, balance_cents, monthly_rate::text, min_payment_cents, terms_source, status from debts where workspace_id = $1 and status = 'active' order by balance_cents desc",
    [ctx.workspaceId],
  );
}

export async function createDebt(deps: ServiceDeps, input: { creditor: string; kind?: string; balanceCents: number; monthlyRatePct: number; minPaymentCents: number }) {
  if (!input.creditor.trim()) throw new DomainError("invalid", "Credor obrigatório.");
  if (!Number.isInteger(input.balanceCents) || input.balanceCents < 0) throw new DomainError("invalid", "Saldo inválido.");
  if (!(input.monthlyRatePct >= 0 && input.monthlyRatePct < 100)) throw new DomainError("invalid", "Taxa mensal inválida.");
  const [row] = await deps.q.query<{ id: string }>(
    "insert into debts (workspace_id, owner_id, creditor, kind, balance_cents, monthly_rate, min_payment_cents) values ($1, $2, $3, $4, $5, $6, $7) returning id",
    [deps.ctx.workspaceId, deps.ctx.userId, input.creditor.trim(), input.kind ?? "other", input.balanceCents, input.monthlyRatePct / 100, input.minPaymentCents],
  );
  return row.id;
}

export async function compareDebtStrategies(deps: ServiceDeps, monthlyBudgetCents: number) {
  const debts: Debt[] = (await listDebts(deps)).map((d) => ({
    id: d.id, name: d.creditor, balanceCents: d.balance_cents, monthlyRate: Number(d.monthly_rate), minPaymentCents: d.min_payment_cents,
  }));
  return {
    snowball: simulatePayoff(debts, monthlyBudgetCents, "snowball"),
    avalanche: simulatePayoff(debts, monthlyBudgetCents, "avalanche"),
    estimated: (await listDebts(deps)).some((d) => d.terms_source === "estimated"),
    disclaimer: "Simulação educacional com taxas informadas. Condições contratuais reais podem diferir.",
  };
}

// ---------------------------------------------------------------- Fluxo de caixa

/** Saldo realizado: saldo de abertura das contas + efeito de transações realizadas que movimentam conta. */
export async function realizedBalance({ q, ctx }: ServiceDeps): Promise<number> {
  const [row] = await q.query<{ balance: number }>(
    `select (
        coalesce((select sum(opening_balance_cents) from financial_accounts where workspace_id = $1 and archived_at is null), 0)
      + coalesce((select sum(case
          when kind in ('income', 'refund') then amount_cents
          when kind in ('expense') and card_id is null then -amount_cents
          when kind = 'card_payment' then -amount_cents
          else 0 end)
        from transactions where workspace_id = $1 and deleted_at is null and status in ('paid', 'reconciled')), 0)
     )::bigint as balance`,
    [ctx.workspaceId],
  );
  return row.balance;
}

export async function cashflowProjection(deps: ServiceDeps, days = 30) {
  const today = localDateString(deps.ctx.now, deps.ctx.timezone);
  const pending = await deps.q.query<{ kind: string; amount_cents: number; date: string; description: string; card_id: string | null }>(
    `select kind, amount_cents, coalesce(due_on, occurred_on) as date, description, card_id from transactions
     where workspace_id = $1 and deleted_at is null and status in ('pending', 'projected') and coalesce(due_on, occurred_on) >= $2 and card_id is null`,
    [deps.ctx.workspaceId, today],
  );
  const bills = await deps.q.query<{ due_date: string; open_cents: number; reference: string; name: string }>(
    `select b.due_date, b.reference, c.name,
       (coalesce((select sum(case when t.kind = 'expense' then t.amount_cents when t.kind = 'refund' then -t.amount_cents else 0 end)
                  from transactions t where t.card_bill_id = b.id and t.deleted_at is null and t.status not in ('cancelled', 'reversed')), 0) - b.paid_cents)::bigint as open_cents
     from credit_card_bills b join credit_cards c on c.id = b.card_id
     where b.workspace_id = $1 and b.status <> 'paid' and b.due_date >= $2`,
    [deps.ctx.workspaceId, today],
  );
  const events: CashflowEvent[] = [
    ...pending.map((p) => ({ date: p.date, deltaCents: p.kind === "income" ? p.amount_cents : -p.amount_cents, label: p.description, source: "pending" as const })),
    ...bills.filter((b) => b.open_cents > 0).map((b) => ({ date: b.due_date, deltaCents: -b.open_cents, label: `Fatura ${b.name} ${b.reference}`, source: "card_bill" as const })),
  ];
  const start = await realizedBalance(deps);
  return { ...projectCashflow(start, today, days, events), startBalanceCents: start, events };
}

// ---------------------------------------------------------------- Recorrências

export async function refreshRecurringCandidates(deps: ServiceDeps) {
  const since = new Date(deps.ctx.now.getTime() - 400 * 86_400_000).toISOString().slice(0, 10);
  const txs = await deps.q.query<{ description: string; amount_cents: number; occurred_on: string }>(
    `select coalesce(merchant, description) as description, amount_cents, occurred_on from transactions
     where workspace_id = $1 and owner_id = $2 and deleted_at is null and kind = 'expense' and status in ('paid', 'reconciled')
       and installment_group_id is null and occurred_on >= $3`,
    [deps.ctx.workspaceId, deps.ctx.userId, since],
  );
  const found = detectRecurring(txs.map((t) => ({ description: t.description, amountCents: t.amount_cents, date: t.occurred_on })));
  for (const c of found) {
    await deps.q.query(
      `insert into recurring_candidates (workspace_id, owner_id, merchant_key, label, interval_days, average_cents, last_cents, last_date, next_estimated_date, price_change_pct)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (workspace_id, owner_id, merchant_key) do update set
         label = excluded.label, interval_days = excluded.interval_days, average_cents = excluded.average_cents, last_cents = excluded.last_cents,
         last_date = excluded.last_date, next_estimated_date = excluded.next_estimated_date, price_change_pct = excluded.price_change_pct`,
      [deps.ctx.workspaceId, deps.ctx.userId, c.key, c.label, c.intervalDays, c.averageCents, c.lastCents, c.lastDate, c.nextEstimatedDate, c.priceChangePct],
    );
  }
  return found;
}

export async function listRecurringCandidates({ q, ctx }: ServiceDeps) {
  return q.query<{ id: string; label: string; interval_days: number; average_cents: number; last_cents: number; next_estimated_date: string; price_change_pct: string | null; status: string }>(
    `select id, label, interval_days, average_cents, last_cents, next_estimated_date, price_change_pct::text, status
     from recurring_candidates where workspace_id = $1 and status <> 'dismissed' order by average_cents desc`,
    [ctx.workspaceId],
  );
}

export async function setRecurringStatus({ q, ctx }: ServiceDeps, id: string, status: "confirmed" | "dismissed" | "cancel_requested") {
  const rows = await q.query("update recurring_candidates set status = $3 where id = $1 and workspace_id = $2 returning id", [id, ctx.workspaceId, status]);
  if (!rows.length) throw new DomainError("not_found", "Recorrência não encontrada.");
}

// ---------------------------------------------------------------- Saúde financeira

export async function healthScore(deps: ServiceDeps) {
  const months = await deps.q.query<{ month: string; income: number; expense: number }>(
    `select to_char(date_trunc('month', occurred_on), 'YYYY-MM') as month,
       coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::bigint as income,
       coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::bigint - coalesce(sum(amount_cents) filter (where kind = 'refund'), 0)::bigint as expense
     from transactions where workspace_id = $1 and deleted_at is null and status in ('paid', 'reconciled')
       and occurred_on >= (date_trunc('month', now()) - interval '6 months')::date and occurred_on < date_trunc('month', now())::date
     group by 1 order by 1`,
    [deps.ctx.workspaceId],
  );
  if (!months.length) return null; // sem dados: não inventa indicador
  const avg = (k: "income" | "expense") => Math.round(months.reduce((s, m) => s + m[k], 0) / months.length);
  const [liquid] = await deps.q.query<{ v: number }>("select coalesce(sum(value_cents), 0)::bigint as v from assets where workspace_id = $1 and liquid and archived_at is null", [deps.ctx.workspaceId]);
  const debts = await listDebts(deps);
  const cards = await deps.q.query<{ limit_cents: number; open_cents: number }>(
    `select c.limit_cents, coalesce((select sum(t.amount_cents) from transactions t join credit_card_bills b on b.id = t.card_bill_id
       where t.card_id = c.id and t.kind = 'expense' and b.status <> 'paid' and t.deleted_at is null and t.status not in ('cancelled', 'reversed')), 0)::bigint as open_cents
     from credit_cards c where c.workspace_id = $1 and c.archived_at is null`,
    [deps.ctx.workspaceId],
  );
  const totalLimit = cards.reduce((s, c) => s + c.limit_cents, 0);
  return financialHealth({
    monthlyIncomeCents: avg("income"),
    monthlyExpenseCents: avg("expense"),
    liquidReserveCents: liquid.v,
    debtPaymentsCents: debts.reduce((s, d) => s + d.min_payment_cents, 0),
    creditCardUsagePct: totalLimit ? Math.round((cards.reduce((s, c) => s + c.open_cents, 0) / totalLimit) * 100) : null,
    monthsWithPositiveResult: months.filter((m) => m.income - m.expense > 0).length,
    monthsObserved: months.length,
  });
}
