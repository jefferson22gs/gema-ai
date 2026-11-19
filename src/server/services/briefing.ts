import { localDayRange } from "@/lib/time";
import type { ServiceDeps } from "../context";
import { listEvents, type CalendarEventRow } from "./calendar";
import { monthSummary, upcomingBills, type MonthSummary, type TransactionRow } from "./finance";
import { listTasks, type TaskRow } from "./tasks";
import { listReminders, type ReminderRow } from "./reminders";

/**
 * Briefing Executivo 360° — composto SOMENTE de dados lidos sob RLS do ator.
 * `facts` são fatos confirmados com origem; `recommendations` são heurísticas determinísticas
 * marcadas como sugestão. `gaps` lista fontes sem dados (nunca preenchidas com números inventados).
 */
export interface BriefingFact {
  source: "agenda" | "financas" | "tarefas" | "lembretes";
  text: string;
}

export interface Briefing {
  date: string;
  timezone: string;
  generatedAt: string;
  events: CalendarEventRow[];
  overdueTasks: TaskRow[];
  todayTasks: TaskRow[];
  bills: TransactionRow[];
  reminders: ReminderRow[];
  month: MonthSummary;
  kpis: { eventsToday: number; openTasks: number; monthExpenseCents: number; billsDueCount: number };
  facts: BriefingFact[];
  recommendations: string[];
  gaps: string[];
}

export async function buildBriefing(deps: ServiceDeps): Promise<Briefing> {
  const { start, end, date } = localDayRange(deps.ctx.now, deps.ctx.timezone);
  const [events, openTasks, bills, reminders, month] = await Promise.all([
    listEvents(deps, start, end),
    listTasks(deps, { status: "open", limit: 200 }),
    upcomingBills(deps, 7),
    listReminders(deps, true),
    monthSummary(deps),
  ]);
  const now = deps.ctx.now.getTime();
  const overdueTasks = openTasks.filter((t) => t.due_at && new Date(t.due_at).getTime() < now);
  const todayTasks = openTasks.filter((t) => t.due_at && new Date(t.due_at) >= start && new Date(t.due_at) < end && new Date(t.due_at).getTime() >= now);
  const todayReminders = reminders.filter((r) => new Date(r.remind_at) >= start && new Date(r.remind_at) < end);

  const facts: BriefingFact[] = [];
  const gaps: string[] = [];
  if (events.length) facts.push({ source: "agenda", text: `${events.length} compromisso(s) hoje.` });
  else gaps.push("Nenhum compromisso registrado para hoje.");
  if (overdueTasks.length) facts.push({ source: "tarefas", text: `${overdueTasks.length} tarefa(s) atrasada(s).` });
  if (todayTasks.length) facts.push({ source: "tarefas", text: `${todayTasks.length} tarefa(s) com prazo hoje.` });
  if (!openTasks.length) gaps.push("Nenhuma tarefa em aberto.");
  if (bills.length) facts.push({ source: "financas", text: `${bills.length} conta(s) a vencer nos próximos 7 dias (inclui atrasadas).` });
  if (month.transactionCount === 0) gaps.push("Nenhum lançamento financeiro neste mês.");
  if (todayReminders.length) facts.push({ source: "lembretes", text: `${todayReminders.length} lembrete(s) para hoje.` });

  const recommendations: string[] = [];
  if (overdueTasks.length) recommendations.push("Sugestão: revise as tarefas atrasadas e redefina prazos realistas.");
  if (bills.some((b) => b.due_on && b.due_on < date)) recommendations.push("Sugestão: há contas com vencimento passado — verifique se já foram pagas.");
  if (month.previousExpenseCents > 0 && month.expenseCents > month.previousExpenseCents) {
    recommendations.push("Sugestão: os gastos deste mês já superam o total do mês anterior.");
  }
  if (events.length >= 2) {
    const sorted = [...events].sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
    for (let i = 1; i < sorted.length; i++) {
      if (+new Date(sorted[i].starts_at) < +new Date(sorted[i - 1].ends_at)) {
        recommendations.push(`Sugestão: "${sorted[i - 1].title}" e "${sorted[i].title}" se sobrepõem.`);
      }
    }
  }

  return {
    date,
    timezone: deps.ctx.timezone,
    generatedAt: deps.ctx.now.toISOString(),
    events,
    overdueTasks,
    todayTasks,
    bills,
    reminders: todayReminders,
    month,
    kpis: { eventsToday: events.length, openTasks: openTasks.length, monthExpenseCents: month.expenseCents, billsDueCount: bills.length },
    facts,
    recommendations,
    gaps,
  };
}

/** Texto curto do briefing para e-mail/WhatsApp (somente dados reais). */
export function briefingToText(b: Briefing, formatMoney: (c: number) => string, formatTime: (d: Date) => string): string {
  const lines = [`Briefing de ${b.date}`];
  if (b.events.length) {
    lines.push("", "Agenda:");
    for (const e of b.events) lines.push(`• ${formatTime(new Date(e.starts_at))} ${e.title}`);
  }
  if (b.overdueTasks.length || b.todayTasks.length) {
    lines.push("", "Tarefas:");
    for (const t of b.overdueTasks) lines.push(`• (atrasada) ${t.title}`);
    for (const t of b.todayTasks) lines.push(`• ${t.title}`);
  }
  if (b.bills.length) {
    lines.push("", "Contas a vencer:");
    for (const bill of b.bills) lines.push(`• ${bill.due_on} ${bill.description} — ${formatMoney(bill.amount_cents)}`);
  }
  lines.push("", `Gasto no mês: ${formatMoney(b.month.expenseCents)}`);
  if (b.gaps.length) lines.push("", ...b.gaps.map((g) => `(sem dados) ${g}`));
  if (b.recommendations.length) lines.push("", ...b.recommendations);
  return lines.join("\n");
}
