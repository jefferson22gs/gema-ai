import type { Metadata } from "next";
import { Suspense } from "react";
import { Zap } from "lucide-react";
import { ActionForm } from "@/components/app/action-form";
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatDateTime, localDateString } from "@/lib/time";
import { AUTOMATION_TEMPLATES } from "@/server/automations/engine";
import { listReminders } from "@/server/services/reminders";
import { actorContext, requireSession } from "@/server/session";
import { createAutomationAction, createReminderAction, deleteAutomationAction, toggleAutomationAction } from "../actions";

export const metadata: Metadata = { title: "Automações" };

const RECURRENCE = { daily: "diário", weekly: "semanal", monthly: "mensal" } as const;

async function Automations() {
  const s = await requireSession();
  const ctx = actorContext(s);
  const { rules, runs, reminders } = await db.asUser(s.userId, async (q) => ({
    rules: await q.query<{ id: string; template: keyof typeof AUTOMATION_TEMPLATES; name: string; enabled: boolean; channels: string[]; next_run_at: Date | null; config: { time?: string } }>(
      "select id, template, name, enabled, channels, next_run_at, config from automation_rules where workspace_id = $1 and owner_id = $2 order by created_at",
      [ctx.workspaceId, s.userId],
    ),
    runs: await q.query<{ id: string; status: string; occurrence_key: string; created_at: Date; name: string }>(
      `select r.id, r.status, r.occurrence_key, r.created_at, a.name from automation_runs r join automation_rules a on a.id = r.rule_id
       where a.owner_id = $1 order by r.created_at desc limit 10`,
      [s.userId],
    ),
    reminders: await listReminders({ q, ctx }, true),
  }));
  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Regras ativas" description="Gatilho → condição → ação. Cada ocorrência executa uma única vez." />
          <CardBody>
            {rules.length ? (
              <ul className="divide-y divide-border">
                {rules.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-medium">{r.name}{r.config.time ? <span className="ml-2 font-normal text-muted">às {r.config.time}</span> : null}</p>
                      <p className="text-xs text-muted">{AUTOMATION_TEMPLATES[r.template].description}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={r.enabled ? "success" : "neutral"}>{r.enabled ? "Ativa" : "Pausada"}</Badge>
                        {r.channels.map((c) => <Badge key={c}>{c}</Badge>)}
                        {r.next_run_at && r.enabled ? <span className="text-[11px] text-subtle">próxima: {formatDateTime(r.next_run_at, ctx.timezone)}</span> : null}
                      </div>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <form action={toggleAutomationAction}><input type="hidden" name="id" value={r.id} /><button className="text-muted hover:text-fg">{r.enabled ? "Pausar" : "Ativar"}</button></form>
                      <form action={deleteAutomationAction}><input type="hidden" name="id" value={r.id} /><button className="text-subtle hover:text-danger">Remover</button></form>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon={<Zap />} title="Nenhuma automação" description="Ative um modelo ao lado." />}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Lembretes" />
          <CardBody>
            {reminders.length ? (
              <ul className="space-y-2 text-sm">
                {reminders.map((r) => <li key={r.id} className="flex justify-between"><span>{r.title}</span><span className="text-muted">{formatDateTime(r.remind_at, ctx.timezone)}{r.recurrence ? ` · ${RECURRENCE[r.recurrence]}` : ""}</span></li>)}
              </ul>
            ) : <p className="text-sm text-muted">Nenhum lembrete ativo.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Execuções recentes" />
          <CardBody>
            {runs.length ? (
              <ul className="space-y-1.5 text-xs">{runs.map((r) => <li key={r.id} className="flex justify-between"><span>{r.name} · {r.occurrence_key}</span><Badge tone={r.status === "succeeded" ? "success" : r.status === "dead" || r.status === "failed" ? "danger" : "neutral"}>{r.status}</Badge></li>)}</ul>
            ) : <p className="text-sm text-muted">Sem execuções ainda.</p>}
          </CardBody>
        </Card>
      </div>
      <div className="space-y-6">
        <Card className="h-fit">
          <CardHeader title="Ativar modelo" />
          <CardBody>
            <ActionForm action={createAutomationAction} submitLabel="Ativar">
              <Field label="Modelo" htmlFor="template">
                <Select id="template" name="template" defaultValue="daily_briefing">
                  {Object.entries(AUTOMATION_TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
                </Select>
              </Field>
              <Field label="Horário local (opcional)" htmlFor="time"><Input id="time" name="time" type="time" /></Field>
              <fieldset className="space-y-1.5 text-xs text-muted">
                <legend className="mb-1 text-xs font-medium">Canais além do painel</legend>
                {[["email", "E-mail"], ["whatsapp", "WhatsApp (número verificado)"], ["push", "Push (PWA)"]].map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2"><input type="checkbox" name={`ch_${k}`} className="accent-[var(--gold)]" />{l}</label>
                ))}
              </fieldset>
            </ActionForm>
          </CardBody>
        </Card>
        <Card className="h-fit">
          <CardHeader title="Novo lembrete" />
          <CardBody>
            <ActionForm action={createReminderAction} submitLabel="Criar lembrete">
              <Field label="Título" htmlFor="r-title"><Input id="r-title" name="title" required /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Data" htmlFor="r-date"><Input id="r-date" name="date" type="date" defaultValue={localDateString(ctx.now, ctx.timezone)} required /></Field>
                <Field label="Hora" htmlFor="r-time"><Input id="r-time" name="time" type="time" required /></Field>
              </div>
              <Field label="Repetir" htmlFor="recurrence">
                <Select id="recurrence" name="recurrence" defaultValue=""><option value="">Não repetir</option><option value="daily">Diariamente</option><option value="weekly">Semanalmente</option><option value="monthly">Mensalmente</option></Select>
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default function AutomacoesPage() {
  return (
    <>
      <PageHeader title="Automações" description="Quiet hours e opt-out por canal são respeitados em todas as entregas." />
      <Suspense fallback={<Skeleton className="h-96" />}><Automations /></Suspense>
    </>
  );
}
