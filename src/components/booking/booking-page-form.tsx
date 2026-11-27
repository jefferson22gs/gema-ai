"use client";

import { useActionState } from "react";
import { saveBookingPageAction, type PageFormState } from "@/app/app/agenda/publica/actions";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";

const DAY_LABEL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export interface BookingPageValue {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  min_notice_hours: number;
  max_days_ahead: number;
  timezone: string;
  weekly_hours: Record<string, [string, string][]>;
  active: boolean;
}

export function BookingPageForm({ page, timezone }: { page?: BookingPageValue; timezone: string }) {
  const [state, action, pending] = useActionState<PageFormState, FormData>(saveBookingPageAction, {});
  const p = page;
  const wh = p?.weekly_hours ?? { "1": [["09:00", "18:00"]], "2": [["09:00", "18:00"]], "3": [["09:00", "18:00"]], "4": [["09:00", "18:00"]], "5": [["09:00", "18:00"]] };
  return (
    <form action={action} className="space-y-5">
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      <input type="hidden" name="timezone" value={p?.timezone ?? timezone} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Título" htmlFor="bp-title"><Input id="bp-title" name="title" defaultValue={p?.title ?? "Reunião de 30 minutos"} required maxLength={80} /></Field>
        <Field label="Endereço" htmlFor="bp-slug" hint="Aparece no link: /agendar/seu-endereco">
          <Input id="bp-slug" name="slug" defaultValue={p?.slug} required pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" placeholder="ex.: joana-consultoria" />
        </Field>
      </div>
      <Field label="Descrição (opcional)" htmlFor="bp-desc"><Textarea id="bp-desc" name="description" rows={2} maxLength={500} defaultValue={p?.description ?? ""} /></Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Duração" htmlFor="bp-dur">
          <Select id="bp-dur" name="duration" defaultValue={String(p?.duration_minutes ?? 30)}>{[15, 20, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}</Select>
        </Field>
        <Field label="Folga entre reuniões" htmlFor="bp-buf">
          <Select id="bp-buf" name="buffer" defaultValue={String(p?.buffer_minutes ?? 0)}>{[0, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} min</option>)}</Select>
        </Field>
        <Field label="Antecedência mínima" htmlFor="bp-notice">
          <Select id="bp-notice" name="notice" defaultValue={String(p?.min_notice_hours ?? 4)}>{[0, 1, 2, 4, 12, 24, 48].map((h) => <option key={h} value={h}>{h} h</option>)}</Select>
        </Field>
        <Field label="Até quantos dias" htmlFor="bp-ahead">
          <Select id="bp-ahead" name="ahead" defaultValue={String(p?.max_days_ahead ?? 30)}>{[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} dias</option>)}</Select>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Horários disponíveis <span className="text-xs font-normal text-subtle">({p?.timezone ?? timezone})</span></legend>
        <div className="space-y-2">
          {DAY_LABEL.map((label, d) => {
            const r = wh[String(d)] ?? [];
            return (
              <div key={d} className="grid grid-cols-[7rem_1fr] items-center gap-3 text-sm sm:grid-cols-[7rem_auto_auto_auto_auto]">
                <label className="flex items-center gap-2"><input type="checkbox" name={`day_${d}`} defaultChecked={r.length > 0} className="size-4 accent-[var(--color-gold)]" />{label}</label>
                <div className="flex items-center gap-1">
                  <Input aria-label={`${label}: início`} name={`from_${d}`} type="time" defaultValue={r[0]?.[0] ?? "09:00"} className="w-28" />
                  <span className="text-subtle">–</span>
                  <Input aria-label={`${label}: fim`} name={`to_${d}`} type="time" defaultValue={r[0]?.[1] ?? "18:00"} className="w-28" />
                </div>
                <div className="col-start-2 flex items-center gap-1 sm:col-start-auto">
                  <span className="text-xs text-subtle">e</span>
                  <Input aria-label={`${label}: início do 2º período`} name={`from2_${d}`} type="time" defaultValue={r[1]?.[0] ?? ""} className="w-28" />
                  <span className="text-subtle">–</span>
                  <Input aria-label={`${label}: fim do 2º período`} name={`to2_${d}`} type="time" defaultValue={r[1]?.[1] ?? ""} className="w-28" />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-subtle">Compromissos da sua agenda (de todos os seus workspaces) bloqueiam o horário automaticamente; o visitante nunca vê o que é.</p>
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={p?.active ?? true} className="size-4 accent-[var(--color-gold)]" />Página ativa (aceitando reservas)</label>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="success">{state.ok}</Alert> : null}
      <Button type="submit" disabled={pending}>{pending ? "Salvando…" : p ? "Salvar alterações" : "Criar página"}</Button>
    </form>
  );
}
