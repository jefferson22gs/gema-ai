"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { toCents } from "@/lib/money";
import { localDateString } from "@/lib/time";
import { DomainError } from "@/server/context";
import * as cards from "@/server/services/cards";
import * as planning from "@/server/services/planning";
import { actorContext, requireSession } from "@/server/session";
import type { ActionState } from "../actions";

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

async function withDeps<T>(fn: (deps: Parameters<typeof cards.listCards>[0]) => Promise<T>): Promise<T> {
  const s = await requireSession();
  const ctx = actorContext(s);
  return db.asUser(s.userId, (q) => fn({ q, ctx }));
}

async function act(fn: () => Promise<string>): Promise<ActionState> {
  try {
    const message = await fn();
    refresh();
    return { ok: true, message };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    console.error("[financas]", e instanceof Error ? e.message : e);
    return { error: "Não foi possível salvar agora." };
  }
}

const day = z.coerce.number().int().min(1).max(31);

export async function createCardAction(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ name: z.string().min(1).max(80), last4: z.string().regex(/^\d{4}$/).optional(), closingDay: day, dueDay: day })
    .safeParse({ name: str(form, "name"), last4: str(form, "last4"), closingDay: str(form, "closingDay"), dueDay: str(form, "dueDay") });
  const limit = toCents(str(form, "limit") ?? "");
  if (!parsed.success || limit === null) return { error: "Preencha nome, limite e dias de fechamento/vencimento (1–31)." };
  return act(async () => {
    await withDeps((d) => cards.createCard(d, { ...parsed.data, limitCents: limit, brand: str(form, "brand") }));
    return "Cartão cadastrado.";
  });
}

export async function createCardPurchaseAction(_: ActionState, form: FormData): Promise<ActionState> {
  const cardId = z.string().uuid().safeParse(form.get("cardId"));
  const total = toCents(str(form, "amount") ?? "");
  const installments = z.coerce.number().int().min(1).max(48).safeParse(str(form, "installments") ?? "1");
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(str(form, "date"));
  const description = str(form, "description");
  if (!cardId.success || total === null || !installments.success || !date.success || !description) return { error: "Preencha descrição, valor, parcelas e data." };
  return act(async () => {
    const r = await withDeps((d) =>
      cards.createCardPurchase(d, {
        cardId: cardId.data, description, totalCents: total, installments: installments.data, purchaseDate: date.data,
        categoryId: str(form, "categoryId"), idempotencyKey: str(form, "idempotencyKey"),
      }),
    );
    return r.installments.length > 1 ? `Compra registrada em ${r.installments.length} parcelas.` : "Compra registrada.";
  });
}

export async function payBillAction(_: ActionState, form: FormData): Promise<ActionState> {
  const billId = z.string().uuid().safeParse(form.get("billId"));
  const amount = toCents(str(form, "amount") ?? "");
  if (!billId.success || amount === null) return { error: "Informe o valor pago." };
  return act(async () => {
    const r = await withDeps((d) => cards.payBill(d, billId.data, amount, localDateString(d.ctx.now, d.ctx.timezone), str(form, "accountId"), str(form, "idempotencyKey")));
    return r.duplicate ? "Pagamento já registrado." : "Pagamento da fatura registrado (não conta como despesa).";
  });
}

export async function createGoalAction(_: ActionState, form: FormData): Promise<ActionState> {
  const target = toCents(str(form, "target") ?? "");
  const name = str(form, "name");
  const deadline = str(form, "deadline");
  if (!name || target === null) return { error: "Informe nome e valor objetivo." };
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return { error: "Prazo inválido." };
  return act(async () => {
    await withDeps((d) => planning.createGoal(d, { name, targetCents: target, deadline, kind: str(form, "kind") }));
    return "Meta criada.";
  });
}

export async function contributeGoalAction(_: ActionState, form: FormData): Promise<ActionState> {
  const goalId = z.string().uuid().safeParse(form.get("goalId"));
  const amount = toCents(str(form, "amount") ?? "");
  if (!goalId.success || amount === null) return { error: "Informe o valor." };
  return act(async () => {
    const g = await withDeps((d) => planning.contributeToGoal(d, goalId.data, amount, str(form, "idempotencyKey")));
    return g.remainingCents === 0 ? "Meta atingida! 🎯" : "Contribuição registrada.";
  });
}

export async function createDebtAction(_: ActionState, form: FormData): Promise<ActionState> {
  const balance = toCents(str(form, "balance") ?? "");
  const minPayment = toCents(str(form, "minPayment") ?? "0") ?? 0;
  const rate = Number((str(form, "rate") ?? "0").replace(",", "."));
  const creditor = str(form, "creditor");
  if (!creditor || balance === null || !Number.isFinite(rate)) return { error: "Informe credor, saldo e taxa mensal (%)." };
  return act(async () => {
    await withDeps((d) => planning.createDebt(d, { creditor, kind: str(form, "kind"), balanceCents: balance, monthlyRatePct: rate, minPaymentCents: minPayment }));
    return "Dívida cadastrada.";
  });
}

export async function refreshRecurringAction(): Promise<void> {
  await withDeps((d) => planning.refreshRecurringCandidates(d));
  refresh();
}

export async function setRecurringStatusAction(form: FormData): Promise<void> {
  const id = z.string().uuid().parse(form.get("id"));
  const status = z.enum(["confirmed", "dismissed", "cancel_requested"]).parse(form.get("status"));
  await withDeps((d) => planning.setRecurringStatus(d, id, status));
  refresh();
}
