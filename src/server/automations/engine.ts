import type { Database, Queryable } from "@/lib/db/types";
import { formatCents } from "@/lib/money";
import { addDaysToDateString, formatTime, localDateString, localParts, zonedToUtc } from "@/lib/time";
import { buildBriefing, briefingToText } from "../services/briefing";
import { monthSummary } from "../services/finance";
import { backoffSeconds, MAX_ATTEMPTS } from "../notifications/dispatcher";

/**
 * Motor gatilho → condição → ação. Templates:
 *  daily_briefing (hora local), bill_due_soon (N dias antes), weekly_summary (dia/hora local),
 *  task_overdue, event_upcoming (N minutos antes).
 * Cada ocorrência tem `occurrence_key` única por regra (idempotência). A ação apenas PREPARA
 * notificações no outbox; a entrega e a decisão de canal ficam no dispatcher.
 */
export type AutomationTemplate = "daily_briefing" | "bill_due_soon" | "weekly_summary" | "task_overdue" | "event_upcoming";

export interface RuleRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  template: AutomationTemplate;
  name: string;
  config: { time?: string; days_before?: number; weekday?: number; minutes_before?: number };
  channels: string[];
  next_run_at: Date | null;
  timezone: string;
}

export const AUTOMATION_TEMPLATES: Record<AutomationTemplate, { name: string; description: string; defaults: RuleRow["config"] }> = {
  daily_briefing: { name: "Briefing diário", description: "Resumo do dia no horário escolhido (padrão 07:00).", defaults: { time: "07:00" } },
  bill_due_soon: { name: "Conta a vencer", description: "Aviso de contas pendentes N dias antes do vencimento (padrão 3).", defaults: { time: "09:00", days_before: 3 } },
  weekly_summary: { name: "Resumo semanal", description: "Resumo financeiro e de tarefas toda semana (padrão domingo 18:00).", defaults: { time: "18:00", weekday: 0 } },
  task_overdue: { name: "Tarefa atrasada", description: "Aviso diário de tarefas com prazo vencido.", defaults: { time: "08:00" } },
  event_upcoming: { name: "Compromisso chegando", description: "Aviso N minutos antes de cada compromisso (padrão 30).", defaults: { minutes_before: 30 } },
};

/** Próximo disparo de regras baseadas em horário local (DST-safe). */
export function nextScheduledRun(rule: Pick<RuleRow, "template" | "config">, tz: string, after: Date): Date {
  if (rule.template === "event_upcoming") return new Date(after.getTime() + 5 * 60_000); // varredura a cada 5 min
  const time = rule.config.time ?? AUTOMATION_TEMPLATES[rule.template].defaults.time ?? "07:00";
  let date = localDateString(after, tz);
  for (let i = 0; i < 9; i++) {
    const candidate = zonedToUtc(date, time, tz);
    const weekdayOk = rule.template !== "weekly_summary" || localParts(candidate, tz).weekday === (rule.config.weekday ?? 0);
    if (candidate > after && weekdayOk) return candidate;
    date = addDaysToDateString(date, 1);
  }
  throw new Error("agenda de automação inválida");
}

interface Prepared {
  occurrenceKey: string;
  notifications: { kind: string; title: string; body: string; dedupeKey: string }[];
}

async function prepare(q: Queryable, rule: RuleRow, now: Date): Promise<Prepared> {
  const tz = rule.timezone;
  const today = localDateString(now, tz);
  const ctx = { userId: rule.owner_id, workspaceId: rule.workspace_id, timezone: tz, now, channel: "automation" as const };
  switch (rule.template) {
    case "daily_briefing": {
      const b = await buildBriefing({ q, ctx });
      const body = briefingToText(b, formatCents, (d) => formatTime(d, tz));
      return { occurrenceKey: today, notifications: [{ kind: "briefing", title: `Briefing de ${today}`, body, dedupeKey: `auto:${rule.id}:${today}` }] };
    }
    case "bill_due_soon": {
      const target = addDaysToDateString(today, rule.config.days_before ?? 3);
      const bills = await q.query<{ id: string; description: string; amount_cents: number; due_on: string }>(
        `select id, description, amount_cents, due_on from transactions
         where workspace_id = $1 and status = 'pending' and kind = 'expense' and deleted_at is null and due_on = $2`,
        [rule.workspace_id, target],
      );
      return {
        occurrenceKey: today,
        notifications: bills.map((b) => ({
          kind: "bill_due", title: "Conta a vencer", body: `${b.description} — ${formatCents(b.amount_cents)} vence em ${b.due_on}.`,
          dedupeKey: `auto:${rule.id}:bill:${b.id}:${b.due_on}`,
        })),
      };
    }
    case "weekly_summary": {
      const m = await monthSummary({ q, ctx });
      const open = await q.query<{ n: number }>("select count(*)::bigint as n from tasks where workspace_id = $1 and completed_at is null", [rule.workspace_id]);
      const body = m.transactionCount
        ? `Mês ${m.month}: receitas ${formatCents(m.incomeCents)}, despesas ${formatCents(m.expenseCents)}, saldo ${formatCents(m.balanceCents)}. Tarefas abertas: ${open[0].n}.`
        : `Sem lançamentos financeiros em ${m.month}. Tarefas abertas: ${open[0].n}.`;
      return { occurrenceKey: today, notifications: [{ kind: "weekly_summary", title: "Resumo semanal", body, dedupeKey: `auto:${rule.id}:${today}` }] };
    }
    case "task_overdue": {
      const tasks = await q.query<{ id: string; title: string }>(
        "select id, title from tasks where workspace_id = $1 and completed_at is null and due_at < $2 order by due_at limit 20",
        [rule.workspace_id, now],
      );
      if (!tasks.length) return { occurrenceKey: today, notifications: [] };
      return {
        occurrenceKey: today,
        notifications: [{ kind: "task_overdue", title: `${tasks.length} tarefa(s) atrasada(s)`, body: tasks.map((t) => `• ${t.title}`).join("\n"), dedupeKey: `auto:${rule.id}:${today}` }],
      };
    }
    case "event_upcoming": {
      const minutes = rule.config.minutes_before ?? 30;
      const events = await q.query<{ id: string; title: string; starts_at: Date }>(
        `select id, title, starts_at from calendar_events
         where workspace_id = $1 and status <> 'cancelled' and starts_at > $2 and starts_at <= $3`,
        [rule.workspace_id, now, new Date(now.getTime() + minutes * 60_000)],
      );
      const slot = Math.floor(now.getTime() / 300_000);
      return {
        occurrenceKey: `slot:${slot}`,
        notifications: events.map((e) => ({
          kind: "event_upcoming", title: "Compromisso chegando", body: `${e.title} às ${formatTime(e.starts_at, tz)}.`,
          dedupeKey: `auto:${rule.id}:event:${e.id}:${new Date(e.starts_at).toISOString()}`,
        })),
      };
    }
  }
}

/**
 * Executa regras vencidas. Usa service role (job de sistema), mas toda consulta é filtrada
 * explicitamente pelo workspace da regra, e a regra só gera notificações para o próprio dono.
 */
export async function runDueAutomations(db: Database, now: Date, limit = 50): Promise<{ ran: number; skipped: number; failed: number }> {
  const rules = await db.asService((q) =>
    q.query<RuleRow>(
      `select r.id, r.workspace_id, r.owner_id, r.template, r.name, r.config, r.channels, r.next_run_at, p.timezone
       from automation_rules r
       join profiles p on p.id = r.owner_id
       join workspace_members m on m.workspace_id = r.workspace_id and m.user_id = r.owner_id
       where r.enabled and r.next_run_at is not null and r.next_run_at <= $1
       order by r.next_run_at limit $2`,
      [now, limit],
    ),
  );
  let ran = 0;
  let skipped = 0;
  let failed = 0;
  for (const rule of rules) {
    try {
      const result = await db.asService(async (q) => {
        const prepared = await prepare(q, rule, now);
        const run = await q.query<{ id: string }>(
          `insert into automation_runs (rule_id, workspace_id, occurrence_key, status, attempts)
           values ($1, $2, $3, 'running', 1) on conflict (rule_id, occurrence_key) do nothing returning id`,
          [rule.id, rule.workspace_id, prepared.occurrenceKey],
        );
        if (run.length) {
          for (const n of prepared.notifications) {
            await q.query(
              `insert into notification_outbox (workspace_id, user_id, kind, title, body, channels, dedupe_key)
               values ($1, $2, $3, $4, $5, $6, $7) on conflict (user_id, dedupe_key) do nothing`,
              [rule.workspace_id, rule.owner_id, n.kind, n.title, n.body, rule.channels, n.dedupeKey],
            );
          }
          await q.query("update automation_runs set status = $2, output = $3 where id = $1", [
            run[0].id, prepared.notifications.length ? "succeeded" : "skipped", JSON.stringify({ notifications: prepared.notifications.length }),
          ]);
        }
        await q.query("update automation_rules set last_run_at = $2, next_run_at = $3 where id = $1", [rule.id, now, nextScheduledRun(rule, rule.timezone, now)]);
        return run.length ? "ran" : "skipped";
      });
      if (result === "ran") ran++;
      else skipped++;
    } catch (e) {
      failed++;
      await db.asService(async (q) => {
        const occurrence = `error:${localDateString(now, rule.timezone)}`;
        const [r] = await q.query<{ attempts: number }>(
          `insert into automation_runs (rule_id, workspace_id, occurrence_key, status, attempts, last_error, run_after)
           values ($1, $2, $3, 'failed', 1, $4, $5)
           on conflict (rule_id, occurrence_key) do update set attempts = automation_runs.attempts + 1, last_error = excluded.last_error,
             status = case when automation_runs.attempts + 1 >= $6 then 'dead' else 'failed' end
           returning attempts`,
          [rule.id, rule.workspace_id, occurrence, e instanceof Error ? e.message.slice(0, 500) : "erro", now, MAX_ATTEMPTS],
        );
        const retryAt = new Date(now.getTime() + backoffSeconds(r.attempts) * 1000);
        await q.query("update automation_rules set next_run_at = $2 where id = $1", [rule.id, retryAt]);
      });
    }
  }
  return { ran, skipped, failed };
}

export async function createRule(
  q: Queryable,
  input: { workspaceId: string; ownerId: string; template: AutomationTemplate; config?: RuleRow["config"]; channels: string[]; timezone: string; now: Date },
): Promise<string> {
  const tpl = AUTOMATION_TEMPLATES[input.template];
  const config = { ...tpl.defaults, ...(input.config ?? {}) };
  const next = nextScheduledRun({ template: input.template, config }, input.timezone, input.now);
  const [row] = await q.query<{ id: string }>(
    `insert into automation_rules (workspace_id, owner_id, template, name, config, channels, next_run_at)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [input.workspaceId, input.ownerId, input.template, tpl.name, JSON.stringify(config), input.channels, next],
  );
  return row.id;
}
