"use client";

import { useState } from "react";
import { createTransactionAction, upsertBudgetAction } from "@/app/app/actions";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input, Select } from "@/components/ui/primitives";

interface Category {
  id: string;
  name: string;
  kind: "expense" | "income";
}

export function TransactionForm({ categories, today, shared }: { categories: Category[]; today: string; shared: boolean }) {
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [status, setStatus] = useState<"paid" | "pending">("paid");
  return (
    <ActionForm
      action={async (state, form) => {
        // Chave por envio: um retry do mesmo envio pelo framework não duplica (o botão fica desabilitado durante o envio).
        form.set("idempotencyKey", `form:${crypto.randomUUID()}`);
        return createTransactionAction(state, form);
      }}
      submitLabel={kind === "expense" ? "Registrar despesa" : "Registrar receita"}
    >
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-bg-elevated p-1" role="radiogroup" aria-label="Tipo">
        {(["expense", "income"] as const).map((k) => (
          <label key={k} className={`cursor-pointer rounded-md py-1.5 text-center text-sm ${kind === k ? "bg-surface-2 font-medium text-fg" : "text-muted"}`}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
            {k === "expense" ? "Despesa" : "Receita"}
          </label>
        ))}
      </div>
      <Field label="Descrição" htmlFor="description"><Input id="description" name="description" required maxLength={200} placeholder="Ex.: Almoço" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor (R$)" htmlFor="amount"><Input id="amount" name="amount" inputMode="decimal" required placeholder="85,00" /></Field>
        <Field label="Data" htmlFor="occurredOn"><Input id="occurredOn" name="occurredOn" type="date" defaultValue={today} required /></Field>
      </div>
      <Field label="Categoria" htmlFor="categoryId">
        <Select id="categoryId" name="categoryId" defaultValue="">
          <option value="">Automática (Outros)</option>
          {categories.filter((c) => c.kind === kind).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" value={status} onChange={(e) => setStatus(e.target.value as "paid" | "pending")}>
            <option value="paid">Pago</option>
            <option value="pending">Pendente</option>
          </Select>
        </Field>
        <Field label="Forma" htmlFor="paymentMethod">
          <Select id="paymentMethod" name="paymentMethod" defaultValue="">
            <option value="">—</option>
            <option value="pix">Pix</option>
            <option value="debit">Débito</option>
            <option value="credit">Crédito</option>
            <option value="cash">Dinheiro</option>
            <option value="boleto">Boleto</option>
            <option value="transfer">Transferência</option>
          </Select>
        </Field>
      </div>
      {status === "pending" ? <Field label="Vencimento" htmlFor="dueOn"><Input id="dueOn" name="dueOn" type="date" required /></Field> : null}
      {shared ? (
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" name="visibility" value="workspace" className="accent-[var(--gold)]" /> Compartilhar com membros deste workspace
        </label>
      ) : null}
    </ActionForm>
  );
}

export function BudgetForm({ categories }: { categories: Category[] }) {
  return (
    <ActionForm action={upsertBudgetAction} submitLabel="Salvar orçamento">
      <Field label="Categoria" htmlFor="b-cat">
        <Select id="b-cat" name="categoryId" required defaultValue="">
          <option value="" disabled>Selecione</option>
          {categories.filter((c) => c.kind === "expense").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Limite mensal (R$)" htmlFor="b-limit"><Input id="b-limit" name="limit" inputMode="decimal" required placeholder="800,00" /></Field>
    </ActionForm>
  );
}
