"use client";

import { useActionState } from "react";
import { saveCouponAction, savePlanAction, type AdminFormState } from "@/app/super-admin/planos/actions";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";

const LIMIT_LABEL: Record<string, string> = {
  ai_messages_month: "Mensagens de IA/mês",
  ai_tokens_month: "Tokens de IA/mês",
  storage_mb: "Armazenamento (MB)",
  automations: "Automações ativas",
  members: "Membros",
  whatsapp_messages_month: "WhatsApp/mês",
  bank_connections: "Conexões bancárias",
};
const KINDS = [["personal", "Pessoal"], ["family", "Família"], ["professional", "Profissional"], ["business", "Empresa"]] as const;

export interface PlanFormValue {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  price_yearly_cents: number | null;
  trial_days: number;
  features: string[];
  limits: Record<string, number>;
  is_public: boolean;
  active: boolean;
  highlight: boolean;
  sort_order: number;
  workspace_kinds: string[];
}

const reais = (c: number | null | undefined) => (c === null || c === undefined ? "" : (c / 100).toFixed(2).replace(".", ","));

function Feedback({ state }: { state: AdminFormState }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.ok) return <Alert tone="success">{state.ok}</Alert>;
  return null;
}

function Check({ name, value, label, defaultChecked }: { name: string; value?: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="size-4 accent-[var(--color-gold)]" />
      {label}
    </label>
  );
}

export function PlanForm({ plan, features, limitKeys }: { plan?: PlanFormValue; features: { key: string; label: string; core: boolean }[]; limitKeys: readonly string[] }) {
  const [state, action, pending] = useActionState<AdminFormState, FormData>(savePlanAction, {});
  const p = plan;
  const uid = p?.id ?? "novo";
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Identificador" htmlFor={`${uid}-id`} hint={p ? "Não pode ser alterado." : "minúsculas, números e _"}>
          <Input id={`${uid}-id`} name="id" defaultValue={p?.id} readOnly={!!p} required />
        </Field>
        <Field label="Nome" htmlFor={`${uid}-name`}><Input id={`${uid}-name`} name="name" defaultValue={p?.name} required /></Field>
      </div>
      <Field label="Descrição" htmlFor={`${uid}-desc`}><Textarea id={`${uid}-desc`} name="description" rows={2} defaultValue={p?.description} required /></Field>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Preço mensal (R$)" htmlFor={`${uid}-price`}><Input id={`${uid}-price`} name="price" inputMode="decimal" defaultValue={reais(p?.price_cents)} required /></Field>
        <Field label="Preço anual (R$)" htmlFor={`${uid}-py`} hint="Vazio = sem anual"><Input id={`${uid}-py`} name="price_yearly" inputMode="decimal" defaultValue={reais(p?.price_yearly_cents)} /></Field>
        <Field label="Dias de teste" htmlFor={`${uid}-trial`}><Input id={`${uid}-trial`} name="trial_days" type="number" min={0} max={90} defaultValue={p?.trial_days ?? 14} required /></Field>
        <Field label="Ordem" htmlFor={`${uid}-ord`}><Input id={`${uid}-ord`} name="sort_order" type="number" min={0} defaultValue={p?.sort_order ?? 10} required /></Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">Limites</legend>
        <div className="grid gap-3 sm:grid-cols-4">
          {limitKeys.map((k) => (
            <Field key={k} label={LIMIT_LABEL[k] ?? k} htmlFor={`${uid}-l-${k}`}>
              <Input id={`${uid}-l-${k}`} name={`limit_${k}`} type="number" min={0} defaultValue={p?.limits[k] ?? 0} required />
            </Field>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">Recursos liberados</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {features.map((f) => <Check key={f.key} name="features" value={f.key} label={f.core ? `${f.label} (sempre incluído)` : f.label} defaultChecked={p ? p.features.includes(f.key) : f.core} />)}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">Tipos de workspace</legend>
        <div className="flex flex-wrap gap-4">{KINDS.map(([v, l]) => <Check key={v} name="workspace_kinds" value={v} label={l} defaultChecked={p ? p.workspace_kinds.includes(v) : v === "personal"} />)}</div>
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <Check name="active" label="Ativo (pode ser contratado)" defaultChecked={p?.active ?? true} />
        <Check name="is_public" label="Visível na página de planos" defaultChecked={p?.is_public ?? false} />
        <Check name="highlight" label="Destacar" defaultChecked={p?.highlight ?? false} />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Salvando…" : p ? "Salvar alterações" : "Criar plano"}</Button>
    </form>
  );
}

export function CouponForm({ plans }: { plans: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<AdminFormState, FormData>(saveCouponAction, {});
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Código" htmlFor="cp-code" hint="Ex.: BEMVINDO20"><Input id="cp-code" name="code" required className="uppercase" /></Field>
        <Field label="Tipo" htmlFor="cp-kind">
          <Select id="cp-kind" name="kind" defaultValue="percent"><option value="percent">Percentual (%)</option><option value="amount">Valor fixo (R$)</option></Select>
        </Field>
        <Field label="Desconto" htmlFor="cp-value"><Input id="cp-value" name="value" inputMode="decimal" required /></Field>
        <Field label="Duração (meses)" htmlFor="cp-dur" hint="Vazio = único ciclo"><Input id="cp-dur" name="duration_months" type="number" min={1} max={36} /></Field>
        <Field label="Usos máximos" htmlFor="cp-max" hint="Vazio = ilimitado"><Input id="cp-max" name="max_redemptions" type="number" min={1} /></Field>
        <Field label="Válido até" htmlFor="cp-until"><Input id="cp-until" name="valid_until" type="date" /></Field>
        <Field label="Descrição interna" htmlFor="cp-desc"><Input id="cp-desc" name="description" /></Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">Planos (nenhum marcado = todos)</legend>
        <div className="flex flex-wrap gap-4">{plans.map((p) => <Check key={p.id} name="plan_ids" value={p.id} label={p.name} />)}</div>
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <Check name="cycles" value="monthly" label="Mensal" defaultChecked />
        <Check name="cycles" value="yearly" label="Anual" defaultChecked />
        <Check name="active" label="Ativo" defaultChecked />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar cupom"}</Button>
    </form>
  );
}
