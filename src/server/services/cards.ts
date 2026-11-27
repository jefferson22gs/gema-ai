import { randomUUID } from "node:crypto";
import { billAt, billFor, cardLimit, simulatePurchase, splitInstallments, type CardCycle, type CardLimit } from "../finance/engine";
import { DomainError, type ServiceDeps } from "../context";
import type { Queryable } from "@/lib/db/types";

export interface CardRow {
  id: string;
  name: string;
  brand: string | null;
  last4: string | null;
  limit_cents: number;
  closing_day: number;
  due_day: number;
  source: string;
  visibility: "private" | "workspace";
}

export interface BillRow {
  id: string;
  card_id: string;
  reference: string;
  closing_date: string;
  due_date: string;
  status: string;
  paid_cents: number;
  total_cents: number;
}

const CARD_COLS = "id, name, brand, last4, limit_cents, closing_day, due_day, source, visibility";

export async function listCards({ q, ctx }: ServiceDeps): Promise<CardRow[]> {
  return q.query<CardRow>(`select ${CARD_COLS} from credit_cards where workspace_id = $1 and archived_at is null order by name`, [ctx.workspaceId]);
}

export async function getCard({ q, ctx }: ServiceDeps, id: string): Promise<CardRow | null> {
  const rows = await q.query<CardRow>(`select ${CARD_COLS} from credit_cards where id = $1 and workspace_id = $2 and archived_at is null`, [id, ctx.workspaceId]);
  return rows[0] ?? null;
}

export async function createCard(
  deps: ServiceDeps,
  input: { name: string; brand?: string; last4?: string; limitCents: number; closingDay: number; dueDay: number; visibility?: "private" | "workspace" },
): Promise<CardRow> {
  if (!input.name.trim()) throw new DomainError("invalid", "Nome do cartão obrigatório.");
  if (!Number.isInteger(input.limitCents) || input.limitCents < 0) throw new DomainError("invalid", "Limite inválido.");
  for (const d of [input.closingDay, input.dueDay]) if (!Number.isInteger(d) || d < 1 || d > 31) throw new DomainError("invalid", "Dias de fechamento/vencimento devem estar entre 1 e 31.");
  if (input.last4 && !/^\d{4}$/.test(input.last4)) throw new DomainError("invalid", "Informe apenas os 4 últimos dígitos.");
  const [row] = await deps.q.query<CardRow>(
    `insert into credit_cards (workspace_id, owner_id, visibility, name, brand, last4, limit_cents, closing_day, due_day)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${CARD_COLS}`,
    [deps.ctx.workspaceId, deps.ctx.userId, input.visibility ?? "private", input.name.trim(), input.brand ?? null, input.last4 ?? null, input.limitCents, input.closingDay, input.dueDay],
  );
  return row;
}

/** Garante a fatura (card, referência), criando se necessário. Idempotente por unique (card_id, reference). */
async function ensureBill(q: Queryable, card: CardRow, workspaceId: string, ownerId: string, reference: string): Promise<string> {
  const [y, m] = reference.split("-").map(Number);
  const b = billAt(y, m, { closingDay: card.closing_day, dueDay: card.due_day });
  const rows = await q.query<{ id: string }>(
    `insert into credit_card_bills (card_id, workspace_id, owner_id, visibility, reference, closing_date, due_date)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (card_id, reference) do update set due_date = excluded.due_date
     returning id`,
    [card.id, workspaceId, ownerId, card.visibility, reference, b.closingDate, b.dueDate],
  );
  return rows[0].id;
}

/**
 * Registra compra no cartão (à vista ou parcelada). Cada parcela é uma transação `expense` na fatura
 * correspondente, todas ligadas pelo mesmo installment_group_id. Idempotente via idempotencyKey.
 */
export async function createCardPurchase(
  deps: ServiceDeps,
  input: { cardId: string; description: string; totalCents: number; installments: number; purchaseDate: string; categoryId?: string; idempotencyKey?: string },
): Promise<{ groupId: string; installments: { number: number; amountCents: number; reference: string }[]; created: boolean }> {
  const card = await getCard(deps, input.cardId);
  if (!card) throw new DomainError("not_found", "Cartão não encontrado.");
  if (!input.description.trim()) throw new DomainError("invalid", "Descrição obrigatória.");
  let parts;
  try {
    parts = splitInstallments(input.totalCents, input.installments, input.purchaseDate, { closingDay: card.closing_day, dueDay: card.due_day });
  } catch (e) {
    throw new DomainError("invalid", e instanceof Error ? e.message : "Compra inválida.");
  }
  if (input.idempotencyKey) {
    const existing = await deps.q.query<{ installment_group_id: string }>(
      "select installment_group_id from transactions where workspace_id = $1 and idempotency_key = $2",
      [deps.ctx.workspaceId, `${input.idempotencyKey}:1`],
    );
    if (existing[0]) {
      const rows = await deps.q.query<{ installment_number: number; amount_cents: number; reference: string }>(
        `select t.installment_number, t.amount_cents, b.reference from transactions t join credit_card_bills b on b.id = t.card_bill_id
         where t.installment_group_id = $1 order by t.installment_number`,
        [existing[0].installment_group_id],
      );
      return { groupId: existing[0].installment_group_id, installments: rows.map((r) => ({ number: r.installment_number, amountCents: r.amount_cents, reference: r.reference })), created: false };
    }
  }
  const groupId = randomUUID();
  const description = input.description.trim();
  for (const p of parts) {
    const billId = await ensureBill(deps.q, card, deps.ctx.workspaceId, deps.ctx.userId, p.bill.reference);
    await deps.q.query(
      `insert into transactions (workspace_id, owner_id, visibility, kind, description, amount_cents, category_id, occurred_on, status,
         card_id, card_bill_id, installment_group_id, installment_number, installment_total, payment_method, source, idempotency_key)
       values ($1, $2, $3, 'expense', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'credit', 'manual', $14)`,
      [deps.ctx.workspaceId, deps.ctx.userId, card.visibility, parts.length > 1 ? `${description} (${p.number}/${p.total})` : description, p.amountCents,
        input.categoryId ?? null, p.number === 1 ? input.purchaseDate : p.bill.closingDate,
        // A 1ª parcela é gasto realizado; as futuras ficam "projected" até a fatura correspondente fechar.
        p.number === 1 ? "paid" : "projected",
        card.id, billId, groupId, parts.length > 1 ? p.number : null, parts.length > 1 ? p.total : null,
        input.idempotencyKey ? `${input.idempotencyKey}:${p.number}` : null],
    );
  }
  return { groupId, installments: parts.map((p) => ({ number: p.number, amountCents: p.amountCents, reference: p.bill.reference })), created: true };
}

/** Faturas do cartão com total calculado a partir das transações (fonte da verdade). */
export async function listBills({ q, ctx }: ServiceDeps, cardId: string): Promise<BillRow[]> {
  return q.query<BillRow>(
    `select b.id, b.card_id, b.reference, b.closing_date, b.due_date, b.status, b.paid_cents,
       coalesce(sum(case when t.kind = 'expense' and t.status not in ('cancelled', 'reversed') then t.amount_cents
                         when t.kind = 'refund' and t.status not in ('cancelled', 'reversed') then -t.amount_cents else 0 end), 0)::bigint as total_cents
     from credit_card_bills b left join transactions t on t.card_bill_id = b.id and t.deleted_at is null
     where b.card_id = $1 and b.workspace_id = $2
     group by b.id order by b.reference`,
    [cardId, ctx.workspaceId],
  );
}

export async function cardSummary(deps: ServiceDeps, cardId: string, today: string): Promise<{ card: CardRow; limit: CardLimit; bills: BillRow[]; current: BillRow | null }> {
  const card = await getCard(deps, cardId);
  if (!card) throw new DomainError("not_found", "Cartão não encontrado.");
  const bills = await listBills(deps, cardId);
  const open = bills.filter((b) => b.status !== "paid");
  const limit = cardLimit(card.limit_cents, open.map((b) => b.total_cents - b.paid_cents));
  const currentRef = billFor(today, { closingDay: card.closing_day, dueDay: card.due_day }).reference;
  return { card, limit, bills, current: bills.find((b) => b.reference === currentRef) ?? null };
}

/**
 * Pagamento de fatura: transação `card_payment` (não é despesa — a despesa foi cada compra),
 * abate da fatura e atualiza status. Evita a dupla contabilização compra + pagamento.
 */
export async function payBill(deps: ServiceDeps, billId: string, amountCents: number, paidOn: string, accountId?: string, idempotencyKey?: string) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new DomainError("invalid", "Valor inválido.");
  const [bill] = await deps.q.query<BillRow & { card_name: string }>(
    `select b.id, b.card_id, b.reference, b.closing_date, b.due_date, b.status, b.paid_cents, c.name as card_name, 0::bigint as total_cents
     from credit_card_bills b join credit_cards c on c.id = b.card_id where b.id = $1 and b.workspace_id = $2`,
    [billId, deps.ctx.workspaceId],
  );
  if (!bill) throw new DomainError("not_found", "Fatura não encontrada.");
  const inserted = await deps.q.query(
    `insert into transactions (workspace_id, owner_id, kind, description, amount_cents, occurred_on, status, account_id, card_id, card_bill_id, payment_method, source, idempotency_key)
     values ($1, $2, 'card_payment', $3, $4, $5, 'paid', $6, $7, $8, 'transfer', 'manual', $9)
     on conflict (workspace_id, idempotency_key) do nothing returning id`,
    [deps.ctx.workspaceId, deps.ctx.userId, `Pagamento fatura ${bill.card_name} ${bill.reference}`, amountCents, paidOn, accountId ?? null, bill.card_id, bill.id, idempotencyKey ?? null],
  );
  if (!inserted.length) return { duplicate: true };
  const [total] = (await listBills(deps, bill.card_id)).filter((b) => b.id === billId);
  const paid = bill.paid_cents + amountCents;
  await deps.q.query("update credit_card_bills set paid_cents = $2, status = $3 where id = $1", [billId, paid, paid >= total.total_cents ? "paid" : "partial"]);
  return { duplicate: false, paidCents: paid, totalCents: total.total_cents };
}

export function simulateCardPurchase(card: CardRow, bills: BillRow[], limit: CardLimit, totalCents: number, installments: number, purchaseDate: string) {
  const cycle: CardCycle = { closingDay: card.closing_day, dueDay: card.due_day };
  const current = Object.fromEntries(bills.map((b) => [b.reference, b.total_cents - b.paid_cents]));
  return simulatePurchase(totalCents, installments, purchaseDate, cycle, current, limit);
}
