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

export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** Ações que alteram dados sensíveis/externos ou terceiros exigem confirmação explícita. */
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
    name: "request_confirmation",
    description: "Use quando faltar informação importante ou houver ambiguidade: faz uma pergunta objetiva ao usuário sem executar nada.",
    schema: z.object({ question: z.string().min(1).max(300) }),
    requiresConfirmation: () => false,
    describe: (a) => a.question,
    async execute(a) {
      return { summary: a.question, data: { needs_user_input: true } };
    },
  }),
] as const;

export const TOOLS: ReadonlyMap<string, ToolDefinition> = new Map(toolList.map((t) => [t.name, t as unknown as ToolDefinition]));

export function toolDeclarations() {
  return toolList.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: z.toJSONSchema(t.schema, { target: "draft-7", io: "input" }),
  }));
}
