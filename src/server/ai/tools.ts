import { z } from "zod";
import { formatCents, toCents } from "@/lib/money";
import { formatDateTime, localDayRange } from "@/lib/time";
import { DomainError, type ServiceDeps } from "../context";
import type { GoogleGateway } from "../integrations/google/types";
import * as calendar from "../services/calendar";
import * as contacts from "../services/contacts";
import * as finance from "../services/finance";
import * as tasks from "../services/tasks";
import * as reminders from "../services/reminders";
import { buildBriefing } from "../services/briefing";
import * as cards from "../services/cards";
import * as planning from "../services/planning";
import { canAfford } from "../finance/engine";
import { AUTOMATION_TEMPLATES, createRule } from "../automations/engine";
import { localDateString } from "@/lib/time";
import { RELATIVE_DAYS, WEEKDAYS, resolveInstant, resolveLocalDate } from "./dates";

/**
 * Catálogo ESTRITO de ferramentas. O modelo apenas propõe {nome, argumentos}; a validação Zod,
 * a autorização (RLS do ator), a confirmação e a execução acontecem aqui, no servidor.
 */
export interface ToolRuntime extends ServiceDeps {
  google: GoogleGateway | null;
  /** Chave base de idempotência (ex.: provider_message_id + índice da chamada). */
  idempotencyKey: string;
}

export type ToolResult = { summary: string; data?: unknown };

/**
 * Nível de risco (Central de Aprovações):
 * 1 consulta · 2 operação reversível · 3 ação externa/sensível (sempre exige aprovação) ·
 * 4 operação financeira crítica (pagamento, transferência, investimento, crédito) — NUNCA executa pela IA.
 */
export type RiskLevel = 1 | 2 | 3 | 4;

export type AgentKey =
  | "orchestrator" | "finance" | "secretary" | "productivity" | "documents" | "research" | "family"
  | "business" | "fiscal" | "wealth" | "automations" | "communication" | "shopping";

export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  risk: RiskLevel;
  /** Agente especializado dono da ferramenta (o orquestrador vê todas; agentes veem as suas). */
  agent: AgentKey;
  /** Confirmação adicional para risco 1–2 conforme os argumentos (risco ≥3 sempre confirma). */
  requiresConfirmation: (args: z.infer<S>) => boolean;
  /** Texto exibido ao pedir confirmação. */
  describe: (args: z.infer<S>, rt: ToolRuntime) => string;
  execute: (args: z.infer<S>, rt: ToolRuntime) => Promise<ToolResult>;
}

function defineTool<S extends z.ZodType>(def: ToolDefinition<S>): ToolDefinition<S> {
  return def;
}

const dateRef = {
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Data explícita YYYY-MM-DD, somente se o usuário informou dia/mês."),
  relative_day: z.enum(RELATIVE_DAYS).optional().describe("Use para 'hoje', 'amanhã', 'depois de amanhã'."),
  weekday: z.enum(WEEKDAYS).optional().describe("Use para 'segunda', 'sexta' etc. (próxima ocorrência)."),
};
const time = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).describe("Hora local HH:mm");
const amount = z.union([z.number().positive(), z.string().min(1)]).describe("Valor em reais, ex.: 85 ou '85,90'");

const moneyItem = z.object({
  description: z.string().min(1).max(200),
  amount,
  category_slug: z.string().optional().describe("Slug: alimentacao, transporte, combustivel, moradia, saude, educacao, lazer, compras, servicos, impostos, outros-despesa, salario, vendas, investimentos, outros-receita"),
  ...dateRef,
  payment_method: z.enum(["pix", "debit", "credit", "cash", "boleto", "transfer", "other"]).optional(),
  status: z.enum(["paid", "pending"]).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function cents(v: number | string): number {
  const c = toCents(v);
  if (c === null) throw new DomainError("invalid", `Valor inválido: ${v}`);
  return c;
}

function money(kind: finance.TxKind) {
  return defineTool({
    name: kind === "expense" ? "create_expense" : "create_income",
    description: kind === "expense"
      ? "Registra UMA OU MAIS despesas. Para 'gastei 85 no almoço e 40 no combustível' envie dois itens em uma única chamada."
      : "Registra uma ou mais receitas.",
    schema: z.object({ items: z.array(moneyItem).min(1).max(20) }),
    risk: 2,
    agent: "finance",
    requiresConfirmation: (a) => a.items.some((i) => cents(i.amount) >= 500_000), // >= R$ 5.000 confirma
    describe: (a) => a.items.map((i) => `${i.description}: ${formatCents(cents(i.amount))}`).join("; "),
    async execute(a, rt) {
      const out: finance.TransactionRow[] = [];
      let duplicates = 0;
      for (const [idx, item] of a.items.entries()) {
        const { transaction, created } = await finance.createTransaction(rt, {
          kind,
          description: item.description,
          amountCents: cents(item.amount),
          occurredOn: resolveLocalDate(rt.ctx, item),
          categorySlug: item.category_slug,
          paymentMethod: item.payment_method,
          status: item.status,
          dueOn: item.due_date,
          source: rt.ctx.channel === "whatsapp" ? "whatsapp" : "ai",
          idempotencyKey: `${rt.idempotencyKey}:${idx}`,
        });
        if (!created) duplicates++;
        out.push(transaction);
      }
      const total = out.reduce((s, t) => s + t.amount_cents, 0);
      const label = kind === "expense" ? "despesa(s)" : "receita(s)";
      return {
        summary: `${out.length} ${label} registrada(s), total ${formatCents(total)}: ${out.map((t) => `${t.description} ${formatCents(t.amount_cents)} (${t.category_name ?? "sem categoria"})`).join("; ")}${duplicates ? ` — ${duplicates} já existia(m), não duplicado.` : ""}`,
        data: out.map((t) => ({ id: t.id, description: t.description, amount_cents: t.amount_cents, category: t.category_slug })),
      };
    },
  });
}

const eventCreate = z.object({
  title: z.string().min(1).max(200),
  ...dateRef,
  time,
  duration_minutes: z.number().int().min(5).max(720).optional().describe("Padrão: 60 minutos"),
  location: z.string().max(200).optional(),
  attendees: z.array(z.object({ name: z.string().optional(), email: z.string().email().optional() })).max(20).optional(),
  sync_google: z.boolean().optional().describe("true se o usuário pediu para criar também no Google Agenda"),
  allow_conflict: z.boolean().optional().describe("true SOMENTE se o usuário confirmou manter mesmo com conflito"),
});

const toolList = [
  defineTool({
    name: "get_day_briefing",
    description: "Resumo do dia: compromissos, tarefas, contas a vencer e gastos (somente dados reais).",
    schema: z.object({}),
    risk: 1,
    agent: "orchestrator",
    requiresConfirmation: () => false,
    describe: () => "Gerar briefing do dia",
    async execute(_a, rt) {
      const b = await buildBriefing(rt);
      return {
        summary: [...b.facts.map((f) => f.text), ...b.gaps.map((g) => `(sem dados) ${g}`), `Gasto no mês: ${formatCents(b.month.expenseCents)}.`].join(" "),
        data: { kpis: b.kpis, recommendations: b.recommendations },
      };
    },
  }),
  defineTool({
    name: "list_calendar_events",
    description: "Lista compromissos de um dia.",
    schema: z.object({ ...dateRef }),
    risk: 1,
    agent: "secretary",
    requiresConfirmation: () => false,
    describe: () => "Listar compromissos",
    async execute(a, rt) {
      const date = resolveLocalDate(rt.ctx, a);
      const start = resolveInstant(rt.ctx, date, "00:00");
      const { end } = localDayRange(new Date(start.getTime() + 3_600_000), rt.ctx.timezone);
      const events = await calendar.listEvents(rt, start, end);
      return {
        summary: events.length
          ? events.map((e) => `${formatDateTime(e.starts_at, rt.ctx.timezone, { dateStyle: undefined, timeStyle: "short" })} ${e.title}`).join("; ")
          : `Nenhum compromisso em ${date}.`,
        data: events.map((e) => ({ id: e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at })),
      };
    },
  }),
  defineTool({
    name: "check_availability",
    description: "Verifica se um horário está livre.",
    schema: z.object({ ...dateRef, time, duration_minutes: z.number().int().min(5).max(720).optional() }),
    risk: 1,
    agent: "secretary",
    requiresConfirmation: () => false,
    describe: () => "Verificar disponibilidade",
    async execute(a, rt) {
      const date = resolveLocalDate(rt.ctx, a);
      const start = resolveInstant(rt.ctx, date, a.time);
      const end = new Date(start.getTime() + (a.duration_minutes ?? 60) * 60_000);
      const conflicts = await calendar.findConflicts(rt, start, end);
      return {
        summary: conflicts.length ? `Ocupado: conflito com ${conflicts.map((c) => c.title).join(", ")}.` : `Livre em ${date} às ${a.time}.`,
        data: { free: conflicts.length === 0, conflicts: conflicts.map((c) => ({ id: c.id, title: c.title })) },
      };
    },
  }),
  defineTool({
    name: "create_calendar_event",
    description: "Cria compromisso. A data é resolvida pelo servidor a partir de relative_day/weekday/date.",
    schema: eventCreate,
    risk: 2,
    agent: "secretary",
    requiresConfirmation: (a) => Boolean(a.sync_google || a.attendees?.length || a.allow_conflict),
    describe: (a, rt) => {
      const date = resolveLocalDate(rt.ctx, a);
      return `Criar "${a.title}" em ${date} às ${a.time} (${a.duration_minutes ?? 60} min)${a.location ? ` em ${a.location}` : ""}${a.sync_google ? " e no Google Agenda" : ""}${a.allow_conflict ? " mesmo com conflito" : ""}`;
    },
    async execute(a, rt) {
      const date = resolveLocalDate(rt.ctx, a);
      const startsAt = resolveInstant(rt.ctx, date, a.time);
      const endsAt = new Date(startsAt.getTime() + (a.duration_minutes ?? 60) * 60_000);
      const { event, created } = await calendar.createEvent(rt, {
        title: a.title, startsAt, endsAt, timezone: rt.ctx.timezone, location: a.location, attendees: a.attendees,
        source: "ai", allowConflict: a.allow_conflict, idempotencyKey: rt.idempotencyKey,
      });
      let google = "";
      if (a.sync_google) {
        if (!rt.google || !(await rt.google.isConnected(rt.ctx.userId, rt.ctx.workspaceId, "calendar"))) {
          google = " Google Agenda não conectado: criado apenas na agenda local.";
        } else if (event.external_id) {
          google = ` Já sincronizado com o Google (id ${event.external_id}).`;
        } else {
          try {
            const g = await rt.google.createCalendarEvent(rt.ctx.userId, rt.ctx.workspaceId, {
              title: event.title, description: event.description, location: event.location, startsAt, endsAt, timezone: rt.ctx.timezone,
            });
            await calendar.markEventSynced(rt, event.id, "google", g.id, g.etag);
            event.external_id = g.id;
            google = ` Criado também no Google Agenda (id ${g.id}).`;
          } catch (e) {
            await calendar.markEventSyncError(rt, event.id, e instanceof Error ? e.message : String(e));
            google = " Falha ao criar no Google Agenda; o compromisso local foi mantido e marcado com erro de sincronização.";
          }
        }
      }
      return {
        summary: `${created ? "Compromisso criado" : "Compromisso já existia"}: ${event.title} em ${formatDateTime(event.starts_at, rt.ctx.timezone)}.${google}`,
        data: { id: event.id, external_id: event.external_id, starts_at: event.starts_at },
      };
    },
  }),
  defineTool({
    name: "update_calendar_event",
    description: "Reagenda ou altera um compromisso existente (use o id retornado por list_calendar_events).",
    schema: z.object({ event_id: z.string().uuid(), title: z.string().optional(), ...dateRef, time: time.optional(), location: z.string().optional(), allow_conflict: z.boolean().optional() }),
    risk: 3,
    agent: "secretary",
    requiresConfirmation: () => true,
    describe: (a) => `Alterar compromisso ${a.event_id}${a.time ? ` para ${a.time}` : ""}`,
    async execute(a, rt) {
      let startsAt: Date | undefined;
      if (a.time) startsAt = resolveInstant(rt.ctx, resolveLocalDate(rt.ctx, a), a.time);
      const ev = await calendar.updateEvent(rt, a.event_id, { title: a.title, startsAt, location: a.location, allowConflict: a.allow_conflict });
      return { summary: `Compromisso atualizado: ${ev.title} em ${formatDateTime(ev.starts_at, rt.ctx.timezone)}.`, data: { id: ev.id } };
    },
  }),
  defineTool({
    name: "cancel_calendar_event",
    description: "Cancela um compromisso pelo id.",
    schema: z.object({ event_id: z.string().uuid() }),
    risk: 3,
    agent: "secretary",
    requiresConfirmation: () => true,
    describe: (a) => `Cancelar compromisso ${a.event_id}`,
    async execute(a, rt) {
      const ev = await calendar.cancelEvent(rt, a.event_id);
      return { summary: `Compromisso cancelado: ${ev.title}.`, data: { id: ev.id } };
    },
  }),
  defineTool({
    name: "create_contact",
    description: "Grava contato local; opcionalmente também no Google Contatos.",
    schema: z.object({
      name: z.string().min(1).max(160),
      phone: z.string().max(40).optional(),
      email: z.string().email().optional(),
      company: z.string().max(160).optional(),
      sync_google: z.boolean().optional(),
    }),
    risk: 3,
    agent: "communication",
    requiresConfirmation: () => true,
    describe: (a) => {
      const phone = a.phone ? contacts.normalizePhoneE164(a.phone) : null;
      return `Gravar contato ${a.name}${phone ? ` ${phone}` : a.phone ? ` (telefone inválido: ${a.phone})` : ""}${a.sync_google ? " também no Google Contatos" : ""}`;
    },
    async execute(a, rt) {
      const { contact, duplicate } = await contacts.createContact(rt, {
        name: a.name, phone: a.phone, email: a.email, company: a.company, source: "ai", idempotencyKey: rt.idempotencyKey,
      });
      if (duplicate) {
        return { summary: `Contato já existente: ${contact.name} ${contact.phone_e164 ?? contact.email ?? ""}. Nada foi duplicado.`, data: { id: contact.id, duplicate: true } };
      }
      let google = "";
      if (a.sync_google) {
        if (!rt.google || !(await rt.google.isConnected(rt.ctx.userId, rt.ctx.workspaceId, "contacts"))) {
          google = " Google Contatos não conectado: salvo apenas localmente.";
        } else {
          try {
            const g = await rt.google.createContact(rt.ctx.userId, rt.ctx.workspaceId, { name: contact.name, phoneE164: contact.phone_e164, email: contact.email, company: contact.company });
            await contacts.setGoogleResource(rt, contact.id, g.resourceName);
            contact.google_resource_name = g.resourceName;
            google = ` Gravado no Google Contatos (${g.resourceName}).`;
          } catch (e) {
            google = ` Falha no Google Contatos: ${e instanceof Error ? e.message : "erro desconhecido"}. Salvo localmente.`;
          }
        }
      }
      return { summary: `Contato salvo: ${contact.name} ${contact.phone_e164 ?? ""}.${google}`, data: { id: contact.id, google_resource_name: contact.google_resource_name } };
    },
  }),
  defineTool({
    name: "find_contact",
    description: "Procura contatos por nome, telefone, e-mail ou empresa.",
    schema: z.object({ query: z.string().min(1).max(100) }),
    risk: 1,
    agent: "communication",
    requiresConfirmation: () => false,
    describe: (a) => `Buscar contato ${a.query}`,
    async execute(a, rt) {
      const rows = await contacts.searchContacts(rt, a.query, 5);
      return {
        summary: rows.length ? rows.map((c) => `${c.name} ${c.phone_e164 ?? ""} ${c.email ?? ""}`.trim()).join("; ") : `Nenhum contato encontrado para "${a.query}".`,
        data: rows.map((c) => ({ id: c.id, name: c.name })),
      };
    },
  }),
  money("expense"),
  money("income"),
  defineTool({
    name: "list_transactions",
    description: "Lista lançamentos financeiros recentes ou de um período.",
    schema: z.object({
      kind: z.enum(["expense", "income"]).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      search: z.string().max(100).optional(),
    }),
    risk: 1,
    agent: "finance",
    requiresConfirmation: () => false,
    describe: () => "Listar lançamentos",
    async execute(a, rt) {
      const rows = await finance.listTransactions(rt, { kind: a.kind, from: a.from, to: a.to, search: a.search, limit: 20 });
      const total = rows.reduce((s, r) => s + (r.kind === "expense" ? -r.amount_cents : r.amount_cents), 0);
      return {
        summary: rows.length ? `${rows.length} lançamento(s); saldo do recorte ${formatCents(total)}. ${rows.slice(0, 8).map((r) => `${r.occurred_on} ${r.description} ${formatCents(r.amount_cents)}`).join("; ")}` : "Nenhum lançamento encontrado.",
        data: rows.map((r) => ({ id: r.id, description: r.description, amount_cents: r.amount_cents, kind: r.kind, occurred_on: r.occurred_on })),
      };
    },
  }),
  defineTool({
    name: "create_task",
    description: "Cria tarefa com prazo opcional.",
    schema: z.object({
      title: z.string().min(1).max(200),
      ...dateRef,
      time: time.optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      notes: z.string().max(2000).optional(),
    }),
    risk: 2,
    agent: "productivity",
    requiresConfirmation: () => false,
    describe: (a) => `Criar tarefa ${a.title}`,
    async execute(a, rt) {
      const hasDate = a.date || a.relative_day || a.weekday;
      const dueAt = hasDate ? resolveInstant(rt.ctx, resolveLocalDate(rt.ctx, a), a.time ?? "18:00") : null;
      const { task, created } = await tasks.createTask(rt, {
        title: a.title, priority: a.priority, notes: a.notes, dueAt, source: rt.ctx.channel === "whatsapp" ? "whatsapp" : "ai", idempotencyKey: rt.idempotencyKey,
      });
      return {
        summary: `${created ? "Tarefa criada" : "Tarefa já existia"}: ${task.title}${task.due_at ? ` (prazo ${formatDateTime(task.due_at, rt.ctx.timezone)})` : ""}.`,
        data: { id: task.id },
      };
    },
  }),
  defineTool({
    name: "complete_task",
    description: "Conclui tarefa pelo id ou por título aproximado.",
    schema: z.object({ task_id: z.string().uuid().optional(), title: z.string().max(200).optional() }).refine((a) => a.task_id || a.title, "Informe task_id ou title"),
    risk: 2,
    agent: "productivity",
    requiresConfirmation: () => false,
    describe: (a) => `Concluir tarefa ${a.title ?? a.task_id}`,
    async execute(a, rt) {
      let id = a.task_id;
      if (!id && a.title) {
        const found = await tasks.findTasksByTitle(rt, a.title);
        if (found.length === 0) throw new DomainError("not_found", `Nenhuma tarefa aberta parecida com "${a.title}".`);
        if (found.length > 1) throw new DomainError("invalid", `Encontrei ${found.length} tarefas: ${found.map((t) => t.title).join("; ")}. Qual delas?`);
        id = found[0].id;
      }
      const task = await tasks.completeTask(rt, id!);
      return { summary: `Tarefa concluída: ${task.title}.`, data: { id: task.id } };
    },
  }),
  defineTool({
    name: "create_reminder",
    description: "Cria lembrete único ou recorrente (diário/semanal/mensal) no horário local do usuário.",
    schema: z.object({ title: z.string().min(1).max(200), ...dateRef, time, recurrence: z.enum(["daily", "weekly", "monthly"]).optional() }),
    risk: 2,
    agent: "secretary",
    requiresConfirmation: () => false,
    describe: (a) => `Lembrete ${a.title} às ${a.time}`,
    async execute(a, rt) {
      const date = resolveLocalDate(rt.ctx, a);
      const remindAt = resolveInstant(rt.ctx, date, a.time);
      const { reminder, created } = await reminders.createReminder(rt, { title: a.title, remindAt, recurrence: a.recurrence, idempotencyKey: rt.idempotencyKey });
      return {
        summary: `${created ? "Lembrete criado" : "Lembrete já existia"}: ${reminder.title} em ${formatDateTime(reminder.remind_at, rt.ctx.timezone)}${reminder.recurrence ? ` (${reminder.recurrence})` : ""}.`,
        data: { id: reminder.id },
      };
    },
  }),
  defineTool({
    name: "list_reminders",
    description: "Lista lembretes ativos.",
    schema: z.object({}),
    risk: 1,
    agent: "secretary",
    requiresConfirmation: () => false,
    describe: () => "Listar lembretes",
    async execute(_a, rt) {
      const rows = await reminders.listReminders(rt, true);
      return {
        summary: rows.length ? rows.slice(0, 10).map((r) => `${formatDateTime(r.remind_at, rt.ctx.timezone)} ${r.title}`).join("; ") : "Nenhum lembrete ativo.",
        data: rows.map((r) => ({ id: r.id, title: r.title })),
      };
    },
  }),
  defineTool({
    name: "search_documents",
    description: "Busca documentos por nome, tipo ou etiqueta (metadados).",
    schema: z.object({ query: z.string().min(1).max(100) }),
    risk: 1,
    agent: "documents",
    requiresConfirmation: () => false,
    describe: (a) => `Buscar documentos ${a.query}`,
    async execute(a, rt) {
      const rows = await rt.q.query<{ id: string; file_name: string; kind: string; created_at: Date }>(
        `select id, file_name, kind, created_at from documents
         where workspace_id = $1 and deleted_at is null and (file_name ilike '%' || $2 || '%' or $2 = any(tags) or kind = $2)
         order by created_at desc limit 10`,
        [rt.ctx.workspaceId, a.query],
      );
      return { summary: rows.length ? rows.map((d) => d.file_name).join("; ") : "Nenhum documento encontrado.", data: rows };
    },
  }),
  defineTool({
    name: "generate_report",
    description: "Relatório financeiro do mês corrente (receitas, despesas, saldo e categorias).",
    schema: z.object({}),
    risk: 1,
    agent: "finance",
    requiresConfirmation: () => false,
    describe: () => "Gerar relatório do mês",
    async execute(_a, rt) {
      const m = await finance.monthSummary(rt);
      if (m.transactionCount === 0) return { summary: `Sem lançamentos em ${m.month}; não há dados para o relatório.`, data: m };
      const top = m.byCategory.slice(0, 3).map((c) => `${c.category} ${formatCents(c.cents)}`).join(", ");
      return {
        summary: `${m.month}: receitas ${formatCents(m.incomeCents)}, despesas ${formatCents(m.expenseCents)}, saldo ${formatCents(m.balanceCents)}. Maiores categorias: ${top || "—"}.`,
        data: m,
      };
    },
  }),
  defineTool({
    name: "list_business_integrations",
    description: "Lista integrações de negócio e o status real (não executa ações externas).",
    schema: z.object({}),
    risk: 1,
    agent: "business",
    requiresConfirmation: () => false,
    describe: () => "Listar integrações",
    async execute(_a, rt) {
      const rows = await rt.q.query<{ provider: string; status: string }>(
        "select provider, status from integrations where workspace_id = $1 and user_id = $2",
        [rt.ctx.workspaceId, rt.ctx.userId],
      );
      const known = ["google_calendar", "google_contacts", "agendafacil365"];
      const parts = known.map((p) => `${p}: ${rows.find((r) => r.provider === p)?.status ?? "não configurado"}`);
      return { summary: `${parts.join("; ")}. AgendaFácil365, ComandaZero, Frota Easy e Portaria Prime aguardam APIs oficiais.`, data: rows };
    },
  }),
  defineTool({
    name: "bank_balances",
    description: "Saldos das contas bancárias conectadas via Open Finance, com a data/hora informada pelo banco (não é tempo real).",
    schema: z.object({}),
    risk: 1,
    agent: "finance",
    requiresConfirmation: () => false,
    describe: () => "Consultar saldos bancários",
    async execute(_a, rt) {
      const rows = await rt.q.query<{ name: string; institution_name: string; balance_cents: number | null; balance_at: Date | null; status: string }>(
        `select a.name, c.institution_name, a.balance_cents, a.balance_at, c.status from bank_accounts a
         join bank_connections c on c.id = a.connection_id
         where a.workspace_id = $1 and a.kind = 'bank' and c.revoked_at is null order by c.institution_name, a.name`,
        [rt.ctx.workspaceId],
      );
      if (!rows.length) return { summary: "Nenhum banco conectado. Conecte em Finanças → Bancos (opcional).", data: [] };
      const total = rows.reduce((s, r) => s + (r.balance_cents ?? 0), 0);
      const parts = rows.map((r) => `${r.institution_name} · ${r.name}: ${r.balance_cents === null ? "indisponível" : formatCents(r.balance_cents)}${r.balance_at ? ` (em ${formatDateTime(r.balance_at, rt.ctx.timezone)})` : ""}${r.status !== "updated" ? ` [${r.status}]` : ""}`);
      return { summary: `Saldo consolidado ${formatCents(total)}. ${parts.join("; ")}. Valores informados pelos bancos na data indicada.`, data: { totalCents: total, accounts: rows } };
    },
  }),
  defineTool({
    name: "list_credit_cards",
    description: "Lista cartões de crédito com limite usado/disponível e fatura atual (valores calculados pelo sistema).",
    schema: z.object({}),
    risk: 1,
    agent: "finance",
    requiresConfirmation: () => false,
    describe: () => "Listar cartões",
    async execute(_a, rt) {
      const list = await cards.listCards(rt);
      if (!list.length) return { summary: "Nenhum cartão cadastrado. Cadastre em Finanças → Cartões.", data: [] };
      const today = localDateString(rt.ctx.now, rt.ctx.timezone);
      const out = [];
      for (const c of list) {
        const s = await cards.cardSummary(rt, c.id, today);
        out.push({ id: c.id, name: c.name, limit: s.limit, current: s.current ? { reference: s.current.reference, due: s.current.due_date, totalCents: s.current.total_cents } : null });
      }
      return {
        summary: out.map((c) => `${c.name}: usado ${formatCents(c.limit.usedCents)} de ${formatCents(c.limit.limitCents)} (${c.limit.usagePct}%)${c.current ? `; fatura ${c.current.reference} ${formatCents(c.current.totalCents)}, vence ${c.current.due}` : ""}`).join("; "),
        data: out,
      };
    },
  }),
  defineTool({
    name: "create_card_purchase",
    description: "Registra compra no cartão de crédito, à vista ou parcelada (parcelas geradas nas faturas corretas).",
    schema: z.object({
      card_id: z.string().uuid(),
      description: z.string().min(1).max(200),
      amount,
      installments: z.number().int().min(1).max(48).optional().describe("Padrão 1"),
      ...dateRef,
    }),
    risk: 2,
    agent: "finance",
    requiresConfirmation: (a) => (a.installments ?? 1) > 1 || cents(a.amount) >= 500_000,
    describe: (a) => `Compra no cartão: ${a.description} ${formatCents(cents(a.amount))}${(a.installments ?? 1) > 1 ? ` em ${a.installments}x` : ""}`,
    async execute(a, rt) {
      const r = await cards.createCardPurchase(rt, {
        cardId: a.card_id, description: a.description, totalCents: cents(a.amount), installments: a.installments ?? 1,
        purchaseDate: resolveLocalDate(rt.ctx, a), idempotencyKey: rt.idempotencyKey,
      });
      return {
        summary: `${r.created ? "Compra registrada" : "Compra já registrada"}: ${r.installments.map((i) => `${i.number}/${r.installments.length} ${formatCents(i.amountCents)} (fatura ${i.reference})`).join(", ")}.`,
        data: r,
      };
    },
  }),
  defineTool({
    name: "simulate_purchase",
    description: "Simula 'posso fazer esta compra?': impacto no cartão (parcelas e limite) ou no saldo projetado da conta.",
    schema: z.object({ amount, installments: z.number().int().min(1).max(48).optional(), card_id: z.string().uuid().optional() }),
    risk: 1,
    agent: "finance",
    requiresConfirmation: () => false,
    describe: () => "Simular compra",
    async execute(a, rt) {
      const total = cents(a.amount);
      const today = localDateString(rt.ctx.now, rt.ctx.timezone);
      if (a.card_id) {
        const s = await cards.cardSummary(rt, a.card_id, today);
        const sim = cards.simulateCardPurchase(s.card, s.bills, s.limit, total, a.installments ?? 1, today);
        return {
          summary: `${sim.fitsLimit ? "Cabe no limite" : "NÃO cabe no limite disponível"} (${formatCents(s.limit.availableCents)} disponíveis). Faturas: ${sim.bills.map((b) => `${b.reference} ${formatCents(b.beforeCents)} → ${formatCents(b.afterCents)}`).join("; ")}. Simulação, nada foi registrado.`,
          data: sim,
        };
      }
      const p = await planning.cashflowProjection(rt, 60);
      const r = canAfford(p, total, today, 0);
      return {
        summary: `${r.ok ? "Pelo saldo projetado, a compra cabe" : "Pelo saldo projetado, a compra deixaria o saldo negativo"}: menor saldo após a compra ${formatCents(r.lowestBalanceAfterCents)}. Hipóteses: ${p.assumptions.join(" ")}`,
        data: r,
      };
    },
  }),
  defineTool({
    name: "cashflow_forecast",
    description: "Projeção de saldo para os próximos dias (pendentes e faturas registradas), com hipóteses.",
    schema: z.object({ days: z.number().int().min(7).max(365).optional() }),
    risk: 1,
    agent: "finance",
    requiresConfirmation: () => false,
    describe: () => "Projetar fluxo de caixa",
    async execute(a, rt) {
      const p = await planning.cashflowProjection(rt, a.days ?? 30);
      return {
        summary: `Saldo atual ${formatCents(p.startBalanceCents)}; projetado em ${a.days ?? 30} dias ${formatCents(p.endBalanceCents)}; menor saldo ${formatCents(p.lowest.balanceCents)} em ${p.lowest.date}. ${p.assumptions[2]}`,
        data: { start: p.startBalanceCents, end: p.endBalanceCents, lowest: p.lowest, events: p.events },
      };
    },
  }),
  defineTool({
    name: "create_goal",
    description: "Cria meta financeira (reserva, viagem, imóvel etc.).",
    schema: z.object({
      name: z.string().min(1).max(120),
      target: amount,
      deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      kind: z.enum(["emergency", "property", "vehicle", "travel", "education", "retirement", "debt_payoff", "custom"]).optional(),
    }),
    risk: 2,
    agent: "finance",
    requiresConfirmation: () => false,
    describe: (a) => `Criar meta ${a.name}`,
    async execute(a, rt) {
      const id = await planning.createGoal(rt, { name: a.name, targetCents: cents(a.target), deadline: a.deadline, kind: a.kind });
      const g = (await planning.listGoals(rt)).find((x) => x.id === id)!;
      return {
        summary: `Meta criada: ${g.name}, objetivo ${formatCents(g.target_cents)}${g.requiredMonthlyCents !== null ? `; para atingir no prazo, guarde ${formatCents(g.requiredMonthlyCents)} por mês` : ""}.`,
        data: { id },
      };
    },
  }),
  defineTool({
    name: "list_goals",
    description: "Lista metas com progresso e contribuição mensal necessária.",
    schema: z.object({}),
    risk: 1,
    agent: "finance",
    requiresConfirmation: () => false,
    describe: () => "Listar metas",
    async execute(_a, rt) {
      const goals = await planning.listGoals(rt);
      return {
        summary: goals.length ? goals.map((g) => `${g.name}: ${g.pct}% (${formatCents(g.savedCents)} de ${formatCents(g.targetCents)})`).join("; ") : "Nenhuma meta cadastrada.",
        data: goals.map((g) => ({ id: g.id, name: g.name, pct: g.pct })),
      };
    },
  }),
  defineTool({
    name: "financial_health",
    description: "Indicador educacional de saúde financeira (0–100) com metodologia. Não é score de crédito.",
    schema: z.object({}),
    risk: 1,
    agent: "finance",
    requiresConfirmation: () => false,
    describe: () => "Calcular saúde financeira",
    async execute(_a, rt) {
      const h = await planning.healthScore(rt);
      if (!h) return { summary: "Ainda não há meses completos de lançamentos para calcular o indicador.", data: null };
      return { summary: `Saúde financeira: ${h.score}/100. ${h.components.map((c) => `${c.label} ${c.points}/${c.max}`).join("; ")}. ${h.disclaimer}`, data: h };
    },
  }),
  defineTool({
    name: "create_automation",
    description: "Ativa uma rotina automática por modelo: briefing diário, conta a vencer, resumo semanal, tarefa atrasada ou compromisso chegando.",
    schema: z.object({
      template: z.enum(["daily_briefing", "bill_due_soon", "weekly_summary", "task_overdue", "event_upcoming"]),
      time: time.optional().describe("Horário local, quando aplicável"),
      channels: z.array(z.enum(["email", "whatsapp", "push"])).max(3).optional().describe("Além do painel"),
    }),
    risk: 2,
    agent: "automations",
    requiresConfirmation: () => true, // mostrar a regra antes de ativar
    describe: (a) => `Ativar automação "${AUTOMATION_TEMPLATES[a.template].name}"${a.time ? ` às ${a.time}` : ""} (canais: painel${a.channels?.length ? `, ${a.channels.join(", ")}` : ""})`,
    async execute(a, rt) {
      const id = await createRule(rt.q, {
        workspaceId: rt.ctx.workspaceId, ownerId: rt.ctx.userId, template: a.template, timezone: rt.ctx.timezone, now: rt.ctx.now,
        channels: ["dashboard", ...(a.channels ?? [])], config: a.time ? { time: a.time } : undefined,
      });
      return { summary: `Automação ativada: ${AUTOMATION_TEMPLATES[a.template].name}.`, data: { id } };
    },
  }),
  defineTool({
    name: "request_payment_or_transfer",
    description: "Pedidos de pagamento, PIX, transferência, investimento ou crédito. O assistente NÃO executa essas operações.",
    schema: z.object({ kind: z.enum(["payment", "pix", "transfer", "investment", "loan"]), amount: amount.optional(), to: z.string().max(200).optional() }),
    risk: 4,
    agent: "finance",
    requiresConfirmation: () => true,
    describe: (a) => `Operação financeira crítica: ${a.kind}`,
    async execute() {
      throw new DomainError("forbidden", "Operações financeiras críticas não são executadas pelo assistente.");
    },
  }),
  defineTool({
    name: "request_confirmation",
    description: "Use quando faltar informação importante ou houver ambiguidade: faz uma pergunta objetiva ao usuário sem executar nada.",
    schema: z.object({ question: z.string().min(1).max(300) }),
    risk: 1,
    agent: "orchestrator",
    requiresConfirmation: () => false,
    describe: (a) => a.question,
    async execute(a) {
      return { summary: a.question, data: { needs_user_input: true } };
    },
  }),
] as const;

export const TOOLS: ReadonlyMap<string, ToolDefinition> = new Map(toolList.map((t) => [t.name, t as unknown as ToolDefinition]));

export function toolDeclarations(only?: ReadonlySet<string>) {
  // Risco 4 é declarado para o modelo reconhecer o pedido e o executor bloquear com explicação.
  return toolList.filter((t) => !only || only.has(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: z.toJSONSchema(t.schema, { target: "draft-7", io: "input" }),
  }));
}
