"use client";

import { useActionState, useMemo, useState } from "react";
import { CalendarCheck2 } from "lucide-react";
import { bookAction, type BookState } from "@/app/agendar/[slug]/actions";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export function BookingPicker({ slug, timezone, days }: { slug: string; timezone: string; days: { date: string; slots: string[] }[] }) {
  const [state, action, pending] = useActionState<BookState, FormData>(bookAction, {});
  const [day, setDay] = useState(days[0]?.date ?? "");
  const [slot, setSlot] = useState<string | null>(null);
  // Uma chave por tentativa de formulário: reenvio (duplo clique, rede) não cria segunda reserva.
  const [clientKey] = useState(() => `bk_${crypto.randomUUID().replace(/-/g, "")}`);
  const fmtDay = useMemo(() => new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }), []);
  const fmtTime = useMemo(() => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: timezone }), [timezone]);

  if (state.booked) {
    return (
      <div className="space-y-4" aria-live="polite">
        <Alert tone="success" title="Horário reservado">Sua reserva para {state.booked.when} foi confirmada.</Alert>
        {state.booked.cancelUrl ? (
          <p className="text-sm text-muted">
            Guarde este link para cancelar, se precisar: <a className="break-all text-gold underline" href={state.booked.cancelUrl}>{state.booked.cancelUrl}</a>
          </p>
        ) : null}
      </div>
    );
  }
  if (!days.length) return <Alert tone="warning" title="Sem horários">Não há horários livres nos próximos dias. Tente novamente mais tarde.</Alert>;
  const current = days.find((d) => d.date === day) ?? days[0];

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="clientKey" value={clientKey} />
      <input type="hidden" name="startsAt" value={slot ?? ""} />
      <div className="absolute -left-[9999px]" aria-hidden><label>Site<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">1. Escolha o dia</legend>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {days.map((d) => (
            <button key={d.date} type="button" aria-pressed={d.date === current.date} onClick={() => { setDay(d.date); setSlot(null); }}
              className={cn("shrink-0 rounded-lg border px-3 py-2 text-sm capitalize", d.date === current.date ? "border-gold bg-gold-soft" : "border-border hover:bg-surface-2")}>
              {fmtDay.format(new Date(`${d.date}T12:00:00Z`))}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">2. Escolha o horário <span className="text-xs font-normal text-subtle">({timezone.replace("_", " ")})</span></legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {current.slots.map((s) => (
            <button key={s} type="button" aria-pressed={slot === s} onClick={() => setSlot(s)}
              className={cn("rounded-lg border px-2 py-2 text-sm tabular-nums", slot === s ? "border-gold bg-gold text-on-gold" : "border-border hover:bg-surface-2")}>
              {fmtTime.format(new Date(s))}
            </button>
          ))}
        </div>
      </fieldset>
      {slot ? (
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-medium">3. Seus dados</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" htmlFor="bk-name"><Input id="bk-name" name="name" required minLength={2} maxLength={120} autoComplete="name" /></Field>
            <Field label="E-mail" htmlFor="bk-email"><Input id="bk-email" name="email" type="email" required maxLength={254} autoComplete="email" /></Field>
          </div>
          <Field label="Assunto (opcional)" htmlFor="bk-note"><Textarea id="bk-note" name="note" rows={2} maxLength={500} /></Field>
          <p className="text-xs text-subtle">Seu nome, e-mail e assunto serão compartilhados apenas com quem você está agendando.</p>
        </fieldset>
      ) : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <Button type="submit" disabled={!slot || pending}><CalendarCheck2 />{pending ? "Reservando…" : "Confirmar horário"}</Button>
    </form>
  );
}
