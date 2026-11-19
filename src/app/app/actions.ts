"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { toCents } from "@/lib/money";
import { isValidTimezone, zonedToUtc } from "@/lib/time";
import { auditAsUser, DomainError } from "@/server/context";
import { createRule, AUTOMATION_TEMPLATES, type AutomationTemplate } from "@/server/automations/engine";
import { actorContext, requireSession, WORKSPACE_COOKIE } from "@/server/session";
import * as calendar from "@/server/services/calendar";
import * as contacts from "@/server/services/contacts";
import * as finance from "@/server/services/finance";
import * as tasks from "@/server/services/tasks";
import * as reminders from "@/server/services/reminders";
import { createSharedWorkspace, updateProfile } from "@/server/services/workspaces";

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

async function run(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await fn();
    refresh();
    return { ok: true, message: message ?? "Salvo." };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    console.error("[action]", e instanceof Error ? e.message : e);
    return { error: "Não foi possível salvar agora. Tente novamente." };
  }
}

async function deps() {
  const s = await requireSession();
  return { s, ctx: actorContext(s) };
}

export async function switchWorkspace(form: FormData) {
  const s = await requireSession();
  const id = str(form, "workspaceId");
  if (id && s.workspaces.some((w) => w.id === id)) {
    (await cookies()).set(WORKSPACE_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  }
  redirect("/app");
}

export async function createWorkspaceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const kind = str(form, "kind");
  if (kind !== "family" && kind !== "business") return { error: "Tipo inválido." };
  return run(async () => {
    const id = await db.asUser(s.userId, (q) => createSharedWorkspace(q, str(form, "name") ?? "", kind));
    (await cookies()).set(WORKSPACE_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
    return "Workspace criado.";
  });
}

// ---------- Finanças ----------
const txSchema = z.object({
  kind: z.enum(["expense", "income"]),
  description: z.string().min(1).max(200),
  amount: z.string().min(1),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categoryId: z.string().uuid().optional(),
  status: z.enum(["paid", "pending"]).default("paid"),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paymentMethod: z.enum(["pix", "debit", "credit", "cash", "boleto", "transfer", "other"]).optional(),
  visibility: z.enum(["private", "workspace"]).default("private"),
});

export async function createTransactionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { ctx } = await deps();
  const parsed = txSchema.safeParse({
    kind: str(form, "kind"), description: str(form, "description"), amount: str(form, "amount"), occurredOn: str(form, "occurredOn"),
    categoryId: str(form, "categoryId"), status: str(form, "status"), dueOn: str(form, "dueOn"), paymentMethod: str(form, "paymentMethod"),
    visibility: str(form, "visibility"),
  });
  if (!parsed.success) return { error: "Preencha descrição, valor e data corretamente." };
  const cents = toCents(parsed.data.amount);
  if (cents === null) return { error: "Valor inválido." };
  return run(async () => {
    await db.asUser(ctx.userId, (q) =>
      finance.createTransaction({ q, ctx }, { ...parsed.data, amountCents: cents, source: "manual", idempotencyKey: str(form, "idempotencyKey") }),
    );
    return parsed.data.kind === "expense" ? "Despesa registrada." : "Receita registrada.";
  });
}

export async function deleteTransactionAction(form: FormData) {
  const { ctx } = await deps();
  const id = z.string().uuid().parse(form.get("id"));
  await db.asUser(ctx.userId, async (q) => {
    if (await finance.deleteTransaction({ q, ctx }, id)) await auditAsUser(q, { workspaceId: ctx.workspaceId, action: "transaction.deleted", resourceType: "transaction", resourceId: id });
  });
  refresh();
}

export async function markPaidAction(form: FormData) {
  const { ctx } = await deps();
  const id = z.string().uuid().parse(form.get("id"));
  await db.asUser(ctx.userId, (q) => finance.markTransactionPaid({ q, ctx }, id));
  refresh();
}

export async function upsertBudgetAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { ctx } = await deps();
  const categoryId = z.string().uuid().safeParse(form.get("categoryId"));
  const cents = toCents(str(form, "limit") ?? "");
  if (!categoryId.success || cents === null) return { error: "Escolha a categoria e um limite válido." };
  return run(async () => {
    await db.asUser(ctx.userId, (q) => finance.upsertBudget({ q, ctx }, categoryId.data, cents));
    return "Orçamento salvo.";
  });
}

// ---------- Agenda ----------
export async function createEventAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { ctx } = await deps();
  const title = str(form, "title");
  const date = str(form, "date");
  const start = str(form, "start");
  const end = str(form, "end");
  if (!title || !date || !start || !end) return { error: "Preencha título, data e horários." };
  let startsAt: Date;
  let endsAt: Date;
  try {
    startsAt = zonedToUtc(date, start, ctx.timezone);
    endsAt = zonedToUtc(date, end, ctx.timezone);
  } catch {
    return { error: "Data ou horário inválido." };
  }
  const allowConflict = form.get("allowConflict") === "on";
  try {
    await db.asUser(ctx.userId, (q) =>
      calendar.createEvent({ q, ctx }, {
        title, startsAt, endsAt, timezone: ctx.timezone, location: str(form, "location"), description: str(form, "description"),
        visibility: str(form, "visibility") === "workspace" ? "workspace" : "private", allowConflict,
      }),
    );
  } catch (e) {
    if (e instanceof calendar.ConflictError) {
      return { error: `Conflito com: ${e.conflicts.map((c) => c.title).join(", ")}. Marque “Manter mesmo com conflito” para confirmar.` };
    }
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  refresh();
  return { ok: true, message: "Compromisso criado." };
}

export async function cancelEventAction(form: FormData) {
  const { ctx } = await deps();
  const id = z.string().uuid().parse(form.get("id"));
  await db.asUser(ctx.userId, (q) => calendar.cancelEvent({ q, ctx }, id));
  refresh();
}

// ---------- Tarefas / projetos ----------
export async function createTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { ctx } = await deps();
  const title = str(form, "title");
  if (!title) return { error: "Informe o título." };
  const dueDate = str(form, "dueDate");
  let dueAt: Date | null = null;
  if (dueDate) {
    try {
      dueAt = zonedToUtc(dueDate, str(form, "dueTime") ?? "18:00", ctx.timezone);
    } catch {
      return { error: "Prazo inválido." };
    }
  }
  const priority = z.enum(["low", "medium", "high", "urgent"]).catch("medium").parse(str(form, "priority"));
  return run(async () => {
    await db.asUser(ctx.userId, (q) =>
      tasks.createTask({ q, ctx }, { title, dueAt, priority, projectId: str(form, "projectId"), notes: str(form, "notes"), visibility: str(form, "visibility") === "workspace" ? "workspace" : "private" }),
    );
    return "Tarefa criada.";
  });
}

export async function toggleTaskAction(form: FormData) {
  const { ctx } = await deps();
  const id = z.string().uuid().parse(form.get("id"));
  await db.asUser(ctx.userId, async (q) => {
    if (form.get("done") === "true") await tasks.reopenTask({ q, ctx }, id);
    else await tasks.completeTask({ q, ctx }, id).catch(() => undefined);
  });
  refresh();
}

export async function deleteTaskAction(form: FormData) {
  const { ctx } = await deps();
  const id = z.string().uuid().parse(form.get("id"));
  await db.asUser(ctx.userId, (q) => tasks.deleteTask({ q, ctx }, id));
  refresh();
}

export async function createProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { ctx } = await deps();
  return run(async () => {
    await db.asUser(ctx.userId, (q) => tasks.createProject({ q, ctx }, { name: str(form, "name") ?? "", description: str(form, "description"), dueOn: str(form, "dueOn") }));
    return "Projeto criado.";
  });
}

// ---------- Contatos ----------
export async function createContactAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { ctx } = await deps();
  return run(async () => {
    const r = await db.asUser(ctx.userId, (q) =>
      contacts.createContact({ q, ctx }, {
        name: str(form, "name") ?? "", phone: str(form, "phone"), email: str(form, "email"), company: str(form, "company"), notes: str(form, "notes"),
        tags: (str(form, "tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      }),
    );
    return r.duplicate ? `Já existe um contato com este telefone/e-mail: ${r.contact.name}.` : "Contato salvo.";
  });
}

export async function deleteContactAction(form: FormData) {
  const { ctx } = await deps();
  const id = z.string().uuid().parse(form.get("id"));
  await db.asUser(ctx.userId, (q) => contacts.deleteContact({ q, ctx }, id));
  refresh();
}

// ---------- Lembretes / automações ----------
export async function createReminderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { ctx } = await deps();
  const title = str(form, "title");
  const date = str(form, "date");
  const time = str(form, "time");
  if (!title || !date || !time) return { error: "Preencha título, data e hora." };
  const recurrence = z.enum(["daily", "weekly", "monthly"]).optional().catch(undefined).parse(str(form, "recurrence"));
  return run(async () => {
    await db.asUser(ctx.userId, (q) => reminders.createReminder({ q, ctx }, { title, remindAt: zonedToUtc(date, time, ctx.timezone), recurrence }));
    return "Lembrete criado.";
  });
}

export async function createAutomationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { s, ctx } = await deps();
  const template = str(form, "template") as AutomationTemplate | undefined;
  if (!template || !(template in AUTOMATION_TEMPLATES)) return { error: "Modelo inválido." };
  const channels = ["dashboard", ...["email", "whatsapp", "push"].filter((c) => form.get(`ch_${c}`) === "on")];
  const time = str(form, "time");
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: "Horário inválido." };
  return run(async () => {
    await db.asUser(s.userId, (q) =>
      createRule(q, { workspaceId: ctx.workspaceId, ownerId: s.userId, template, channels, timezone: ctx.timezone, now: new Date(), config: time ? { time } : undefined }),
    );
    return "Automação ativada.";
  });
}

export async function toggleAutomationAction(form: FormData) {
  const { s } = await deps();
  const id = z.string().uuid().parse(form.get("id"));
  await db.asUser(s.userId, (q) => q.query("update automation_rules set enabled = not enabled where id = $1 and owner_id = $2", [id, s.userId]));
  refresh();
}

export async function deleteAutomationAction(form: FormData) {
  const { s } = await deps();
  const id = z.string().uuid().parse(form.get("id"));
  await db.asUser(s.userId, (q) => q.query("delete from automation_rules where id = $1 and owner_id = $2", [id, s.userId]));
  refresh();
}

// ---------- Notificações ----------
export async function markNotificationsReadAction() {
  const { s } = await deps();
  await db.asUser(s.userId, (q) => q.query("update notification_outbox set read_at = now() where user_id = $1 and read_at is null", [s.userId]));
  refresh();
}

// ---------- Perfil / preferências ----------
export async function updateProfileAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { s } = await deps();
  const timezone = str(form, "timezone");
  if (timezone && !isValidTimezone(timezone)) return { error: "Fuso horário inválido." };
  const style = z.enum(["objetivo", "detalhado", "formal", "amigavel"]).optional().catch(undefined).parse(str(form, "assistantStyle"));
  return run(async () => {
    await db.asUser(s.userId, async (q) => {
      await updateProfile(q, s.userId, { fullName: str(form, "fullName"), timezone, assistantName: str(form, "assistantName")?.slice(0, 30), assistantStyle: style, onboardingDone: form.get("onboarding") === "1" });
      const qs = str(form, "quietStart");
      const qe = str(form, "quietEnd");
      await q.query(
        `update user_preferences set
           quiet_hours_start = $2, quiet_hours_end = $3,
           channels = jsonb_build_object('dashboard', true, 'email', $4::boolean, 'whatsapp', $5::boolean, 'push', $6::boolean),
           memory_enabled = $7
         where user_id = $1`,
        [s.userId, qs ?? null, qe ?? null, form.get("ch_email") === "on", form.get("ch_whatsapp") === "on", form.get("ch_push") === "on", form.get("memory") === "on"],
      );
    });
    return "Preferências salvas.";
  });
}

export async function completeOnboardingAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { s } = await deps();
  const timezone = str(form, "timezone") ?? "America/Sao_Paulo";
  if (!isValidTimezone(timezone)) return { error: "Fuso horário inválido." };
  await db.asUser(s.userId, async (q) => {
    await updateProfile(q, s.userId, { fullName: str(form, "fullName"), timezone, assistantName: str(form, "assistantName")?.slice(0, 30), onboardingDone: true });
    if (form.get("briefing") === "on") {
      await createRule(q, { workspaceId: s.workspace.id, ownerId: s.userId, template: "daily_briefing", channels: ["dashboard", "email"], timezone, now: new Date() });
    }
  });
  const kind = str(form, "workspaceKind");
  if (kind === "family" || kind === "business") {
    const name = str(form, "workspaceName") ?? (kind === "family" ? "Família" : "Empresa");
    const id = await db.asUser(s.userId, (q) => createSharedWorkspace(q, name, kind));
    (await cookies()).set(WORKSPACE_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  }
  redirect("/app");
}

export async function openSupportCaseAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { s, ctx } = await deps();
  const subject = str(form, "subject");
  const body = str(form, "body");
  if (!subject || subject.length < 3 || !body) return { error: "Informe assunto e descrição." };
  const grant = form.get("grantAccess") === "on";
  return run(async () => {
    await db.asUser(s.userId, (q) =>
      q.query(
        "insert into support_cases (workspace_id, opened_by, subject, body, data_access_granted_until) values ($1, $2, $3, $4, $5)",
        [ctx.workspaceId, s.userId, subject.slice(0, 160), body.slice(0, 5000), grant ? new Date(Date.now() + 72 * 3600_000) : null],
      ),
    );
    return "Chamado aberto. Responderemos pelo seu e-mail.";
  });
}
