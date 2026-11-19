import type { Database } from "@/lib/db/types";
import { DomainError, type ActorContext } from "../context";
import { ConflictError } from "../services/calendar";
import type { GoogleGateway } from "../integrations/google/types";
import { TOOLS, type ToolRuntime } from "./tools";

export type ExecutionStatus = "proposed" | "awaiting_confirmation" | "running" | "succeeded" | "failed" | "cancelled";

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

  let needsConfirmation: boolean;
  let confirmationText: string;
  try {
    const rt = runtimeFor(deps, null, key);
    needsConfirmation = tool.requiresConfirmation(args);
    confirmationText = tool.describe(args, rt);
  } catch (e) {
    await record(db, ctx, deps, { tool: call.name, args, key, status: "failed", error: errorMessage(e) });
    return { executionId: null, tool: call.name, status: "failed", message: errorMessage(e) };
  }

  const inserted = await record(db, ctx, deps, {
    tool: call.name,
    args,
    key,
    status: needsConfirmation ? "awaiting_confirmation" : "running",
    requiresConfirmation: needsConfirmation,
    result: needsConfirmation ? { confirmation: confirmationText } : null,
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
      await db.asUser(ctx.userId, (q) =>
        q.query(
          "update ai_tool_executions set status = 'awaiting_confirmation', requires_confirmation = true, arguments = $2, result = $3 where id = $1",
          [executionId, JSON.stringify({ ...(args as object), allow_conflict: true }), JSON.stringify({ confirmation: message, conflicts: e.details })],
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

/** Confirma uma ação pendente do próprio ator (expira em 30 minutos). */
export async function confirmExecution(deps: ExecutorDeps, executionId: string): Promise<ExecutionOutcome> {
  const { db, ctx } = deps;
  const claimed = await db.asUser(ctx.userId, (q) =>
    q.query<ExecutionRow>(
      `update ai_tool_executions set status = 'running', confirmed_at = now()
       where id = $1 and actor_id = $2 and workspace_id = $3 and status = 'awaiting_confirmation'
         and updated_at > now() - interval '30 minutes'
       returning id, tool_name, arguments, status, result, error, idempotency_key`,
      [executionId, ctx.userId, ctx.workspaceId],
    ),
  );
  const row = claimed[0];
  if (!row) {
    return { executionId, tool: "unknown", status: "failed", message: "Nada pendente para confirmar (expirado, já processado ou sem permissão)." };
  }
  return run(deps, row.id, row.tool_name, row.arguments, row.idempotency_key);
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
    q.query<{ id: string; tool_name: string; result: { confirmation?: string } | null; created_at: Date }>(
      `select id, tool_name, result, created_at from ai_tool_executions
       where workspace_id = $1 and actor_id = $2 and status = 'awaiting_confirmation' and updated_at > now() - interval '30 minutes'
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
  r: { tool: string; args: unknown; key: string; status: ExecutionStatus; error?: string; requiresConfirmation?: boolean; result?: unknown },
): Promise<{ created: boolean; row: ExecutionRow }> {
  return db.asUser(ctx.userId, async (q) => {
    const inserted = await q.query<ExecutionRow>(
      `insert into ai_tool_executions (workspace_id, actor_id, conversation_id, message_id, tool_name, arguments, status, error, idempotency_key, requires_confirmation, result)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (workspace_id, idempotency_key) do nothing
       returning id, tool_name, arguments, status, result, error, idempotency_key`,
      [ctx.workspaceId, ctx.userId, deps.conversationId ?? null, deps.messageId ?? null, r.tool, JSON.stringify(r.args ?? {}), r.status,
        r.error ?? null, r.key, r.requiresConfirmation ?? false, r.result ? JSON.stringify(r.result) : null],
    );
    if (inserted.length) return { created: true, row: inserted[0] };
    const existing = await q.query<ExecutionRow>(
      "select id, tool_name, arguments, status, result, error, idempotency_key from ai_tool_executions where workspace_id = $1 and idempotency_key = $2",
      [ctx.workspaceId, r.key],
    );
    return { created: false, row: existing[0] };
  });
}
