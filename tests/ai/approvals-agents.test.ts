import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import type { ActorContext } from "@/server/context";
import { AGENTS, routeAgent, toolsForAgent } from "@/server/ai/agents";
import { confirmExecution, executeToolCalls, hashArgs, listPendingConfirmations, rejectExecution } from "@/server/ai/executor";
import { handleUserMessage } from "@/server/ai/orchestrator";
import { TOOLS } from "@/server/ai/tools";
import { createTestDb, createUser } from "../db/harness";
import { pgliteDatabase } from "../support/pglite-db";
import { ScriptedModel } from "../support/fakes";

let pg: PGlite;
let db: Database;
let ctx: ActorContext;

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  const u = await createUser(pg, "risk@example.test");
  ctx = { userId: u.id, workspaceId: u.personalWorkspaceId, timezone: "America/Sao_Paulo", now: new Date(), channel: "dashboard" };
});

beforeEach(async () => {
  await pg.exec("delete from ai_tool_executions; delete from contacts;");
});

describe("classificação de risco (Central de Aprovações)", () => {
  it("toda ferramenta tem risco 1–4 e agente", () => {
    for (const t of TOOLS.values()) {
      expect([1, 2, 3, 4]).toContain(t.risk);
      expect(t.agent).toBeTruthy();
    }
    expect(TOOLS.get("request_payment_or_transfer")!.risk).toBe(4);
    expect(TOOLS.get("create_contact")!.risk).toBe(3);
  });

  it("risco 4 nunca executa e fica registrado como bloqueado", async () => {
    const [o] = await executeToolCalls({ db, ctx, google: null }, [{ name: "request_payment_or_transfer", args: { kind: "pix", amount: 500, to: "Fulano" } }], "r4");
    expect(o.status).toBe("failed");
    expect(o.message).toMatch(/não são executadas/);
    const { rows } = await pg.query<{ status: string; risk_level: number }>("select status, risk_level from ai_tool_executions");
    expect(rows).toEqual([{ status: "blocked", risk_level: 4 }]);
  });

  it("banco impede que uma execução de risco 4 vire 'succeeded'", async () => {
    await expect(
      pg.query(
        "insert into ai_tool_executions (workspace_id, actor_id, tool_name, arguments, status, idempotency_key, risk_level) values ($1, $2, 'x', '{}', 'succeeded', 'k4', 4)",
        [ctx.workspaceId, ctx.userId],
      ),
    ).rejects.toThrow(/risk4/);
  });

  it("risco 3 sempre pede aprovação, com resumo, hash e expiração", async () => {
    const [o] = await executeToolCalls({ db, ctx, google: null }, [{ name: "create_contact", args: { name: "Lia", phone: "+55 11 97777-1111" } }], "r3");
    expect(o.status).toBe("awaiting_confirmation");
    const [p] = await listPendingConfirmations({ db, ctx });
    expect(p.risk_level).toBe(3);
    expect(p.approval_summary).toContain("Lia");
    expect(p.expires_at).not.toBeNull();
  });
});

describe("aprovação vinculada à operação exata", () => {
  it("alterar argumentos de ação pendente é bloqueado no banco", async () => {
    const [o] = await executeToolCalls({ db, ctx, google: null }, [{ name: "create_contact", args: { name: "Rui", phone: "+55 11 96666-2222" } }], "h1");
    await expect(
      pg.query("update ai_tool_executions set arguments = $2 where id = $1", [o.executionId, JSON.stringify({ name: "Outro", phone: "+5511900000000" })]),
    ).rejects.toThrow(/não podem ser alterados/);
  });

  it("hash divergente invalida a aprovação (revalidação antes de executar)", async () => {
    const [o] = await executeToolCalls({ db, ctx, google: null }, [{ name: "create_contact", args: { name: "Ana", phone: "+55 11 95555-3333" } }], "h2");
    await pg.query("update ai_tool_executions set args_hash = 'adulterado' where id = $1", [o.executionId]);
    const r = await confirmExecution({ db, ctx, google: null }, o.executionId!);
    expect(r.status).toBe("failed");
    expect(r.message).toMatch(/mudou/);
    expect((await pg.query("select 1 from contacts")).rows).toHaveLength(0);
  });

  it("hash estável independe da ordem das chaves", () => {
    expect(hashArgs("t", { a: 1, b: { c: 2, d: 3 } })).toBe(hashArgs("t", { b: { d: 3, c: 2 }, a: 1 }));
    expect(hashArgs("t", { a: 1 })).not.toBe(hashArgs("t", { a: 2 }));
  });

  it("aprovação expirada não executa e é marcada como expirada", async () => {
    const [o] = await executeToolCalls({ db, ctx, google: null }, [{ name: "create_contact", args: { name: "Edu", phone: "+55 11 94444-4444" } }], "h3");
    await pg.query("update ai_tool_executions set expires_at = now() - interval '1 minute' where id = $1", [o.executionId]);
    const r = await confirmExecution({ db, ctx, google: null }, o.executionId!);
    expect(r.status).toBe("failed");
    const { rows } = await pg.query<{ status: string }>("select status from ai_tool_executions where id = $1", [o.executionId]);
    expect(rows[0].status).toBe("expired");
  });

  it("rejeição é registrada e auditada", async () => {
    const [o] = await executeToolCalls({ db, ctx, google: null }, [{ name: "create_contact", args: { name: "Bia", phone: "+55 11 93333-5555" } }], "h4");
    expect(await rejectExecution({ db, ctx, google: null }, o.executionId!)).toBe(true);
    const audit = await pg.query("select 1 from audit_logs where action = 'ai.approval.rejected'");
    expect(audit.rows).toHaveLength(1);
    expect((await confirmExecution({ db, ctx, google: null }, o.executionId!)).status).toBe("failed");
  });
});

describe("agentes especializados", () => {
  it("13 agentes com identidade e status honesto", () => {
    expect(AGENTS).toHaveLength(13);
    for (const a of AGENTS) expect(a.name && a.title && a.description).toBeTruthy();
    // Agente "disponível" precisa ter ao menos uma ferramenta própria.
    for (const a of AGENTS.filter((x) => x.status !== "planned" && x.key !== "orchestrator")) {
      expect([...TOOLS.values()].some((t) => t.agent === a.key), a.key).toBe(true);
    }
  });

  it("roteamento: pedido simples vai ao especialista; composto ao orquestrador", () => {
    expect(routeAgent("gastei 85 no almoço").key).toBe("finance");
    expect(routeAgent("marca reunião amanhã às 10").key).toBe("secretary");
    expect(routeAgent("gastei 50 e marca reunião amanhã").key).toBe("orchestrator");
    expect(routeAgent("oi").key).toBe("orchestrator");
    expect(routeAgent("pesquise hotel em Gramado").key).toBe("orchestrator"); // agente planejado não assume
  });

  it("agente só recebe ferramentas do seu domínio", () => {
    const fin = toolsForAgent("finance");
    expect(fin.has("create_expense")).toBe(true);
    expect(fin.has("create_contact")).toBe(false);
    expect(fin.has("request_confirmation")).toBe(true);
  });

  it("ferramenta fora do escopo do agente ativo é recusada (tool abuse)", async () => {
    const model = new ScriptedModel(() => ({ functionCalls: [{ name: "create_contact", args: { name: "X", phone: "+55 11 92222-6666" } }] }));
    const r = await handleUserMessage({ db, ctx, model, google: null }, { text: "gastei 30 no café", provider: "dashboard", providerMessageId: "scope-1" });
    expect(r.agent?.key).toBe("finance");
    expect(r.outcomes[0].status).toBe("failed");
    expect(r.outcomes[0].message).toMatch(/não está disponível para o agente/);
    expect(model.calls[0].tools?.has("create_contact")).toBe(false);
    expect(model.calls[0].systemInstruction).toMatch(/Agente financeiro/);
  });
});
