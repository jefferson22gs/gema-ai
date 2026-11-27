import { monthRange, addDaysToDateString, localDateString } from "@/lib/time";
import { DomainError, type ServiceDeps } from "../context";
import { categorize } from "../finance/statement-import";
import { loadRules } from "./statement-import";

export type TxKind = "expense" | "income";

export interface TransactionInput {
  kind: TxKind;
  description: string;
  amountCents: number;
  occurredOn: string;
  categorySlug?: string;
  categoryId?: string;
  accountId?: string;
  paymentMethod?: string;
  status?: "paid" | "pending";
  dueOn?: string;
  tags?: string[];
  visibility?: "private" | "workspace";
  source?: "manual" | "ai" | "whatsapp" | "import" | "recurring" | "document";
  documentId?: string;
  idempotencyKey?: string;
}

export interface TransactionRow {
  id: string;
  kind: TxKind;
  description: string;
  amount_cents: number;
  occurred_on: string;
  due_on: string | null;
  status: "paid" | "pending";
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  payment_method: string | null;
  visibility: "private" | "workspace";
  source: string;
  owner_id: string;
}

export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  kind: TxKind;
  icon: string | null;
}

export async function listCategories({ q, ctx }: ServiceDeps, kind?: TxKind): Promise<CategoryRow[]> {
  return q.query<CategoryRow>(
    `select id, slug, name, kind, icon from categories
     where (workspace_id is null or workspace_id = $1) and ($2::text is null or kind = $2)
     order by workspace_id nulls first, name`,
    [ctx.workspaceId, kind ?? null],
  );
}

async function resolveCategoryId(deps: ServiceDeps, kind: TxKind, slug?: string, id?: string, description?: string): Promise<string | null> {
  if (id) return id;
  if (!slug && description) {
    // Sem categoria informada: regras do usuário (aprendidas das correções) antes do "Outros".
    const learned = categorize(description, kind, await loadRules(deps));
    if (learned) return learned;
  }
  const fallback = kind === "expense" ? "outros-despesa" : "outros-receita";
  const rows = await deps.q.query<{ id: string; slug: string }>(
    `select id, slug from categories
     where (workspace_id is null or workspace_id = $1) and kind = $2 and slug = any($3::text[])
     order by workspace_id nulls last`,
    [deps.ctx.workspaceId, kind, [slug ?? fallback, fallback]],
  );
  return rows.find((r) => r.slug === slug)?.id ?? rows.find((r) => r.slug === fallback)?.id ?? null;
}

/**
 * Cria lançamento. Com idempotencyKey, uma segunda chamada idêntica devolve o registro existente
 * (created=false) em vez de duplicar.
 */
export async function createTransaction(deps: ServiceDeps, input: TransactionInput): Promise<{ transaction: TransactionRow; created: boolean }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new DomainError("invalid", "Valor deve ser positivo.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) throw new DomainError("invalid", "Data inválida.");
  const categoryId = await resolveCategoryId(deps, input.kind, input.categorySlug, input.categoryId, input.description);
  const inserted = await deps.q.query<{ id: string }>(
    `insert into transactions (workspace_id, owner_id, visibility, kind, description, amount_cents, category_id, account_id,
       payment_method, tags, occurred_on, due_on, status, source, document_id, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     on conflict (workspace_id, idempotency_key) do nothing
     returning id`,
    [
      deps.ctx.workspaceId, deps.ctx.userId, input.visibility ?? "private", input.kind, input.description.trim(), input.amountCents,
      categoryId, input.accountId ?? null, input.paymentMethod ?? null, input.tags ?? [], input.occurredOn, input.dueOn ?? null,
      input.status ?? "paid", input.source ?? "manual", input.documentId ?? null, input.idempotencyKey ?? null,
    ],
  );
  const created = inserted.length > 0;
  const id = created
    ? inserted[0].id
    : (await deps.q.query<{ id: string }>("select id from transactions where workspace_id = $1 and idempotency_key = $2", [deps.ctx.workspaceId, input.idempotencyKey]))[0]?.id;
  if (!id) throw new DomainError("conflict", "Não foi possível registrar o lançamento.");
  const [transaction] = await listTransactions(deps, { ids: [id] });
  return { transaction, created };
}

export interface TransactionFilter {
  ids?: string[];
  kind?: TxKind;
  from?: string;
  to?: string;
  status?: "paid" | "pending";
  search?: string;
  limit?: number;
}

export async function listTransactions({ q, ctx }: ServiceDeps, f: TransactionFilter = {}): Promise<TransactionRow[]> {
  return q.query<TransactionRow>(
    `select t.id, t.kind, t.description, t.amount_cents, t.occurred_on, t.due_on, t.status, t.category_id,
            c.name as category_name, c.slug as category_slug, t.payment_method, t.visibility, t.source, t.owner_id
     from transactions t
     left join categories c on c.id = t.category_id
     where t.workspace_id = $1 and t.deleted_at is null
       and ($2::uuid[] is null or t.id = any($2::uuid[]))
       and ($3::text is null or t.kind = $3)
       and ($4::date is null or t.occurred_on >= $4)
       and ($5::date is null or t.occurred_on < $5)
       and ($6::text is null or t.status = $6)
       and ($7::text is null or t.description ilike '%' || $7 || '%')
     order by t.occurred_on desc, t.created_at desc
     limit $8`,
    [ctx.workspaceId, f.ids ?? null, f.kind ?? null, f.from ?? null, f.to ?? null, f.status ?? null, f.search ?? null, Math.min(f.limit ?? 100, 500)],
  );
}

export async function deleteTransaction({ q, ctx }: ServiceDeps, id: string): Promise<boolean> {
  const rows = await q.query("update transactions set deleted_at = now() where id = $1 and workspace_id = $2 and deleted_at is null returning id", [id, ctx.workspaceId]);
  return rows.length > 0;
}

export async function markTransactionPaid({ q, ctx }: ServiceDeps, id: string): Promise<boolean> {
  const rows = await q.query("update transactions set status = 'paid' where id = $1 and workspace_id = $2 and status = 'pending' returning id", [id, ctx.workspaceId]);
  return rows.length > 0;
}

export interface MonthSummary {
  month: string;
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
  transactionCount: number;
  byCategory: { category: string; slug: string | null; cents: number }[];
  previousExpenseCents: number;
}

export async function monthSummary(deps: ServiceDeps, reference?: Date): Promise<MonthSummary> {
  const ref = reference ?? deps.ctx.now;
  const { start, end } = monthRange(ref, deps.ctx.timezone);
  const prevStart = (() => {
    const [y, m] = start.split("-").map(Number);
    return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  })();
  // Regime de competência: contam pagos, conciliados e pendentes do mês; projetados (parcelas futuras),
  // cancelados e estornados não. Transferências e pagamentos de fatura não são receita/despesa; reembolso abate despesa.
  const [totals] = await deps.q.query<{ income: number; expense: number; count: number; prev_expense: number }>(
    `select
       coalesce(sum(amount_cents) filter (where kind = 'income' and occurred_on >= $2), 0)::bigint as income,
       (coalesce(sum(amount_cents) filter (where kind = 'expense' and occurred_on >= $2), 0)
        - coalesce(sum(amount_cents) filter (where kind = 'refund' and occurred_on >= $2), 0))::bigint as expense,
       count(*) filter (where occurred_on >= $2)::bigint as count,
       (coalesce(sum(amount_cents) filter (where kind = 'expense' and occurred_on < $2), 0)
        - coalesce(sum(amount_cents) filter (where kind = 'refund' and occurred_on < $2), 0))::bigint as prev_expense
     from transactions
     where workspace_id = $1 and deleted_at is null and occurred_on >= $4 and occurred_on < $3
       and status in ('paid', 'reconciled', 'pending')`,
    [deps.ctx.workspaceId, start, end, prevStart],
  );
  const byCategory = await deps.q.query<{ category: string; slug: string | null; cents: number }>(
    `select coalesce(c.name, 'Sem categoria') as category, c.slug, sum(t.amount_cents)::bigint as cents
     from transactions t left join categories c on c.id = t.category_id
     where t.workspace_id = $1 and t.deleted_at is null and t.kind = 'expense' and t.occurred_on >= $2 and t.occurred_on < $3
       and t.status in ('paid', 'reconciled', 'pending')
     group by c.name, c.slug order by cents desc`,
    [deps.ctx.workspaceId, start, end],
  );
  return {
    month: start.slice(0, 7),
    incomeCents: totals.income,
    expenseCents: totals.expense,
    balanceCents: totals.income - totals.expense,
    transactionCount: totals.count,
    byCategory,
    previousExpenseCents: totals.prev_expense,
  };
}

/** Contas pendentes com vencimento nos próximos `days` dias (inclui atrasadas). */
export async function upcomingBills(deps: ServiceDeps, days = 7): Promise<TransactionRow[]> {
  const today = localDateString(deps.ctx.now, deps.ctx.timezone);
  return deps.q.query<TransactionRow>(
    `select t.id, t.kind, t.description, t.amount_cents, t.occurred_on, t.due_on, t.status, t.category_id,
            c.name as category_name, c.slug as category_slug, t.payment_method, t.visibility, t.source, t.owner_id
     from transactions t left join categories c on c.id = t.category_id
     where t.workspace_id = $1 and t.deleted_at is null and t.status = 'pending' and t.kind = 'expense'
       and t.due_on is not null and t.due_on <= $2
     order by t.due_on`,
    [deps.ctx.workspaceId, addDaysToDateString(today, days)],
  );
}

export interface BudgetRow {
  id: string;
  category_id: string;
  category_name: string;
  limit_cents: number;
  spent_cents: number;
}

export async function listBudgets(deps: ServiceDeps): Promise<BudgetRow[]> {
  const { start, end } = monthRange(deps.ctx.now, deps.ctx.timezone);
  return deps.q.query<BudgetRow>(
    `select b.id, b.category_id, c.name as category_name, b.limit_cents,
            coalesce((select sum(t.amount_cents) from transactions t
                      where t.workspace_id = b.workspace_id and t.category_id = b.category_id and t.kind = 'expense'
                        and t.status in ('paid', 'reconciled', 'pending')
                        and t.deleted_at is null and t.occurred_on >= $2 and t.occurred_on < $3), 0)::bigint as spent_cents
     from budgets b join categories c on c.id = b.category_id
     where b.workspace_id = $1 and b.month = $2::date
     order by c.name`,
    [deps.ctx.workspaceId, start, end],
  );
}

export async function upsertBudget(deps: ServiceDeps, categoryId: string, limitCents: number): Promise<void> {
  if (!Number.isInteger(limitCents) || limitCents <= 0) throw new DomainError("invalid", "Limite deve ser positivo.");
  const { start } = monthRange(deps.ctx.now, deps.ctx.timezone);
  await deps.q.query(
    `insert into budgets (workspace_id, owner_id, category_id, month, limit_cents) values ($1, $2, $3, $4, $5)
     on conflict (workspace_id, owner_id, category_id, month) do update set limit_cents = excluded.limit_cents`,
    [deps.ctx.workspaceId, deps.ctx.userId, categoryId, start, limitCents],
  );
}

export function transactionsToCsv(rows: TransactionRow[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = "data;tipo;descricao;categoria;valor;status;vencimento";
  const lines = rows.map((r) =>
    [r.occurred_on, r.kind === "expense" ? "despesa" : "receita", esc(r.description), esc(r.category_name ?? ""),
      (r.amount_cents / 100).toFixed(2).replace(".", ","), r.status === "paid" ? "pago" : "pendente", r.due_on ?? ""].join(";"),
  );
  return [header, ...lines].join("\n");
}
