import { createHash } from "node:crypto";
import type { Database } from "@/lib/db/types";
import { DomainError, type ActorContext } from "../context";
import { ConflictError } from "../services/calendar";
import type { GoogleGateway } from "../integrations/google/types";
import { TOOLS, type ToolRuntime } from "./tools";

export type ExecutionStatus = "proposed" | "awaiting_confirmation" | "running" | "succeeded" | "failed" | "cancelled" | "rejected" | "expired";

/** Aprovações expiram em 30 minutos. */
export const APPROVAL_TTL_MS = 30 * 60_000;

/** Consultas que expõem saldos/limites/projeções — no WhatsApp dependem de `channel_accounts.show_balances`. */
const SENSITIVE_ON_CHANNEL = new Set(["bank_balances", "list_credit_cards", "cashflow_forecast", "simulate_purchase", "financial_health", "net_worth"]);

export interface ToolCallRequest {
  name: string;
  args: unknown;
}

export interface ExecutionOutcome {
  executionId: string | null;
  tool: string;
  status: ExecutionStatus;
  message: string;
  data?: unknown;
  /** true quando a mesma chamada já havia sido processada (webhook/mensagem repetida). */
  replayed?: boolean;
}

interface ExecutionRow {
  id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  status: ExecutionStatus;
  result: { summary?: string; data?: unknown; confirmation?: string } | null;
  error: string | null;
  idempotency_key: string;
}

export interface ExecutorDeps {
  db: Database;
  ctx: ActorContext;
  google: GoogleGateway | null;
  conversationId?: string | null;
  messageId?: string | null;
  /** Ferramentas permitidas ao agente ativo (undefined = todas — orquestrador). */
  allowedTools?: ReadonlySet<string>;
}

function errorMessage(e: unknown): string {
  if (e instanceof DomainError) return e.message;
  if (e instanceof Error && e.name === "ZodError") return "Parâmetros inválidos para a ação.";
  return "Erro inesperado ao executar a ação.";
}

/**
 * Executa chamadas de ferramenta de forma INDEPENDENTE: cada uma tem seu próprio registro,
 * status e transação. Falha de uma não desfaz nem esconde o resultado das demais.
 */
export async function executeToolCalls(deps: ExecutorDeps, calls: ToolCallRequest[], baseKey: string): Promise<ExecutionOutcome[]> {
  const outcomes: ExecutionOutcome[] = [];
  for (const [index, call] of calls.entries()) {
    outcomes.push(await executeOne(deps, call, `${baseKey}:${index}`));
  }
  return outcomes;
}

async function executeOne(deps: ExecutorDeps, call: ToolCallRequest, key: string): Promise<ExecutionOutcome> {
  const { db, ctx } = deps;
  const tool = TOOLS.get(call.name);
  if (!tool) {
    return { executionId: null, tool: call.name, status: "failed", message: `Ação desconhecida: ${call.name}.` };
  }

  const parsed = tool.schema.safeParse(call.args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ");
    await record(db, ctx, deps, { tool: call.name, args: call.args, key, status: "failed", error: `validação: ${issues}` });
    return { executionId: null, tool: call.name, status: "failed", message: `Não entendi os dados da ação (${issues}).` };
  }
  const args = parsed.data;

  if (deps.allowedTools && !deps.allowedTools.has(call.name)) {
    await record(db, ctx, deps, { tool: call.name, args, key, status: "failed", error: "ferramenta fora do escopo do agente", risk: tool.risk });
    return { executionId: null, tool: call.name, status: "failed", message: "Esta ação não está disponível para o agente atual." };
  }

  // Privacidade do canal: pelo WhatsApp, valores/saldos só aparecem se o titular permitiu.
  if (ctx.channel === "whatsapp" && SENSITIVE_ON_CHANNEL.has(call.name)) {
    const [pref] = await db.asUser(ctx.userId, (q) =>
      q.query<{ show_balances: boolean }>("select show_balances from channel_accounts where user_id = $1 and status = 'verified' order by verified_at desc limit 1", [ctx.userId]),
    );
    if (!pref?.show_balances) {
      return { executionId: null, tool: call.name, status: "failed", message: "Por privacidade, saldos e valores consolidados não são exibidos no WhatsApp. Consulte no painel ou ative em Integrações → WhatsApp." };
    }
  }

  // Risco 4: nunca executa pela IA — registra como bloqueada para auditoria.
  if (tool.risk === 4) {
    const blocked = await record(db, ctx, deps, { tool: call.name, args, key, status: "blocked", risk: 4, error: "operação financeira crítica não executável pela IA" });
    return { executionId: blocked.row?.id ?? null, tool: call.name, status: "failed", message: "Operações financeiras críticas (pagamentos, transferências, investimentos) não são executadas pelo assistente." };
  }

  let needsConfirmation: boolean;
  let confirmationText: string;
  try {
    const rt = runtimeFor(deps, null, key);
    needsConfirmation = tool.risk >= 3 || tool.requiresConfirmation(args);
    confirmationText = tool.describe(args, rt);
  } catch (e) {
    await record(db, ctx, deps, { tool: call.name, args, key, status: "failed", error: errorMessage(e), risk: tool.risk });
    return { executionId: null, tool: call.name, status: "failed", message: errorMessage(e) };
  }

  const inserted = await record(db, ctx, deps, {
    tool: call.name,
    args,
    key,
    status: needsConfirmation ? "awaiting_confirmation" : "running",
    requiresConfirmation: needsConfirmation,
    result: needsConfirmation ? { confirmation: confirmationText } : null,
    risk: tool.risk,
    approvalSummary: needsConfirmation ? confirmationText : undefined,
  });

  if (!inserted.created) {
    const row = inserted.row;
    return {
      executionId: row.id,
      tool: row.tool_name,
      status: row.status,
      message: row.result?.summary ?? row.result?.confirmation ?? row.error ?? "Ação já registrada.",
      data: row.result?.data,
      replayed: true,
    };
  }

  if (needsConfirmation) {
    return { executionId: inserted.row.id, tool: call.name, status: "awaiting_confirmation", message: `Confirma? ${confirmationText}` };
  }
  return run(deps, inserted.row.id, call.name, args, key);
}

async function run(deps: ExecutorDeps, executionId: string, toolName: string, args: unknown, key: string): Promise<ExecutionOutcome> {
  const tool = TOOLS.get(toolName)!;
  const { db, ctx } = deps;
  try {
    const result = await db.asUser(ctx.userId, async (q) => {
      const rt = runtimeFor(deps, q, key);
      const r = await tool.execute(args, rt);
      await q.query("update ai_tool_executions set status = 'succeeded', result = $2 where id = $1", [executionId, JSON.stringify(r)]);
      await q.query("select public.write_audit($1, 'ai', $2, 'ai_tool_execution', $3, $4)", [
        ctx.workspaceId, `ai.tool.${toolName}`, executionId, JSON.stringify({ channel: ctx.channel }),
      ]);
      return r;
    });
    return { executionId, tool: toolName, status: "succeeded", message: result.summary, data: result.data };
  } catch (e) {
    // Conflito de agenda: não cria silenciosamente; propõe manter mediante confirmação explícita.
    if (e instanceof ConflictError && toolName === "create_calendar_event") {
      const titles = e.conflicts.map((c) => c.title).join(", ");
      const message = `Conflito com: ${titles}. Confirma criar mesmo assim?`;
      const newArgs = { ...(args as object), allow_conflict: true };
      await db.asUser(ctx.userId, (q) =>
        q.query(
          `update ai_tool_executions set status = 'awaiting_confirmation', requires_confirmation = true, arguments = $2, result = $3,
             args_hash = $4, approval_summary = $5, expires_at = $6
           where id = $1`,
          [executionId, JSON.stringify(newArgs), JSON.stringify({ confirmation: message, conflicts: e.details }), hashArgs(toolName, newArgs), message,
            new Date(Date.now() + APPROVAL_TTL_MS)],
        ),
      );
      return { executionId, tool: toolName, status: "awaiting_confirmation", message, data: { conflicts: e.details } };
    }
    const message = errorMessage(e);
    if (!(e instanceof DomainError)) console.error(`[ai.tool] ${toolName} falhou`, e instanceof Error ? e.message : e);
    await db.asUser(ctx.userId, (q) =>
      q.query("update ai_tool_executions set status = 'failed', error = $2 where id = $1", [executionId, message]),
    );
    return { executionId, tool: toolName, status: "failed", message };
  }
}

/**
 * Confirma uma ação pendente do próprio ator. Revalida antes de executar:
 * não expirada, argumentos com o MESMO hash aprovado (qualquer mudança exige nova aprovação),
 * ferramenta ainda existente e com risco < 4.
 */
export async function confirmExecution(deps: ExecutorDeps, executionId: string): Promise<ExecutionOutcome> {
  const { db, ctx } = deps;
  const claimed = await db.asUser(ctx.userId, (q) =>
    q.query<ExecutionRow & { args_hash: string | null; risk_level: number }>(
      `update ai_tool_executions set status = 'running', confirmed_at = now(), decided_at = now(), decision = 'approved'
       where id = $1 and actor_id = $2 and workspace_id = $3 and status = 'awaiting_confirmation'
         and coalesce(expires_at, updated_at + interval '30 minutes') > now()
       returning id, tool_name, arguments, status, result, error, idempotency_key, args_hash, risk_level`,
      [executionId, ctx.userId, ctx.workspaceId],
    ),
  );
  const row = claimed[0];
  if (!row) {
    // Marca expiradas para a central de aprovações não exibi-las como pendentes.
    await db.asUser(ctx.userId, (q) =>
      q.query(
        `update ai_tool_executions set status = 'expired', decision = 'expired', decided_at = now()
         where id = $1 and actor_id = $2 and status = 'awaiting_confirmation' and coalesce(expires_at, updated_at + interval '30 minutes') <= now()`,
        [executionId, ctx.userId],
      ),
    );
    return { executionId, tool: "unknown", status: "failed", message: "Nada pendente para confirmar (expirado, já processado ou sem permissão)." };
  }
  const tool = TOOLS.get(row.tool_name);
  if (!tool || tool.risk === 4 || (row.args_hash && row.args_hash !== hashArgs(row.tool_name, row.arguments))) {
    await db.asUser(ctx.userId, (q) =>
      q.query("update ai_tool_executions set status = 'failed', error = 'revalidação falhou: operação alterada ou indisponível' where id = $1", [row.id]),
    );
    return { executionId, tool: row.tool_name, status: "failed", message: "A operação mudou ou não está mais disponível. Peça novamente para gerar uma nova aprovação." };
  }
  return run(deps, row.id, row.tool_name, row.arguments, row.idempotency_key);
}

/** Rejeição explícita (diferente de cancelamento pelo sistema) — auditada. */
export async function rejectExecution(deps: ExecutorDeps, executionId: string): Promise<boolean> {
  const rows = await deps.db.asUser(deps.ctx.userId, async (q) => {
    const r = await q.query(
      "update ai_tool_executions set status = 'rejected', decision = 'rejected', decided_at = now() where id = $1 and actor_id = $2 and status = 'awaiting_confirmation' returning id",
      [executionId, deps.ctx.userId],
    );
    if (r.length) await q.query("select public.write_audit($1, 'user', 'ai.approval.rejected', 'ai_tool_execution', $2, '{}'::jsonb)", [deps.ctx.workspaceId, executionId]);
    return r;
  });
  return rows.length > 0;
}

/** Hash estável dos argumentos (chaves ordenadas) — vincula a aprovação à operação exata. */
export function hashArgs(toolName: string, args: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v;
  return createHash("sha256").update(`${toolName}:${JSON.stringify(stable(args))}`).digest("hex");
}

export async function cancelExecution(deps: ExecutorDeps, executionId: string): Promise<boolean> {
  const rows = await deps.db.asUser(deps.ctx.userId, (q) =>
    q.query(
      "update ai_tool_executions set status = 'cancelled' where id = $1 and actor_id = $2 and status = 'awaiting_confirmation' returning id",
      [executionId, deps.ctx.userId],
    ),
  );
  return rows.length > 0;
}

export async function listPendingConfirmations(deps: Pick<ExecutorDeps, "db" | "ctx">) {
  return deps.db.asUser(deps.ctx.userId, (q) =>
    q.query<{ id: string; tool_name: string; result: { confirmation?: string } | null; created_at: Date; risk_level: number; approval_summary: string | null; expires_at: Date | null }>(
      `select id, tool_name, result, created_at, risk_level, approval_summary, expires_at from ai_tool_executions
       where workspace_id = $1 and actor_id = $2 and status = 'awaiting_confirmation'
         and coalesce(expires_at, updated_at + interval '30 minutes') > now()
       order by created_at`,
      [deps.ctx.workspaceId, deps.ctx.userId],
    ),
  );
}

function runtimeFor(deps: ExecutorDeps, q: ToolRuntime["q"] | null, key: string): ToolRuntime {
  return {
    q: q ?? { query: () => Promise.reject(new Error("sem transação")) },
    ctx: deps.ctx,
    google: deps.google,
    idempotencyKey: key,
  };
}

async function record(
  db: Database,
  ctx: ActorContext,
  deps: ExecutorDeps,
  r: {
    tool: string; args: unknown; key: string; status: ExecutionStatus | "blocked"; error?: string; requiresConfirmation?: boolean; result?: unknown;
    risk?: number; approvalSummary?: string;
  },
): Promise<{ created: boolean; row: ExecutionRow }> {
  const tool = TOOLS.get(r.tool);
  const awaiting = r.status === "awaiting_confirmation";
  return db.asUser(ctx.userId, async (q) => {
    const inserted = await q.query<ExecutionRow>(
      `insert into ai_tool_executions (workspace_id, actor_id, conversation_id, message_id, tool_name, arguments, status, error, idempotency_key,
         requires_confirmation, result, risk_level, agent, args_hash, approval_summary, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       on conflict (workspace_id, idempotency_key) do nothing
       returning id, tool_name, arguments, status, result, error, idempotency_key`,
      [ctx.workspaceId, ctx.userId, deps.conversationId ?? null, deps.messageId ?? null, r.tool, JSON.stringify(r.args ?? {}), r.status,
        r.error ?? null, r.key, r.requiresConfirmation ?? false, r.result ? JSON.stringify(r.result) : null,
        r.risk ?? tool?.risk ?? 1, tool?.agent ?? null, awaiting ? hashArgs(r.tool, r.args ?? {}) : null, r.approvalSummary ?? null,
        awaiting ? new Date(Date.now() + APPROVAL_TTL_MS) : null],
    );
    if (inserted.length) return { created: true, row: inserted[0] };
    const existing = await q.query<ExecutionRow>(
      "select id, tool_name, arguments, status, result, error, idempotency_key from ai_tool_executions where workspace_id = $1 and idempotency_key = $2",
      [ctx.workspaceId, r.key],
    );
    return { created: false, row: existing[0] };
  });
}
