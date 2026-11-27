import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import type { ActorContext } from "@/server/context";
import { parseStatement } from "@/server/finance/statement-import";
import { createTransaction } from "@/server/services/finance";
import { commitImport, deleteRule, listRules, previewImport, recategorize } from "@/server/services/statement-import";
import { asUser, createTestDb, createUser } from "./harness";
import { pgliteDatabase } from "../support/pglite-db";

let pg: PGlite;
let db: Database;
let ana: { id: string; personalWorkspaceId: string };
let bia: { id: string; personalWorkspaceId: string };
const ctxOf = (u: { id: string; personalWorkspaceId: string }): ActorContext => ({
  userId: u.id, workspaceId: u.personalWorkspaceId, timezone: "America/Sao_Paulo", now: new Date("2026-11-20T12:00:00Z"), channel: "dashboard",
});

const CSV = "Data;Descrição;Valor\n03/11/2026;NETFLIX.COM 111;-39,90\n05/11/2026;Salário;9.800,00\n06/11/2026;Café;-5,00\n06/11/2026;Café;-5,00\n";
const CSV_OVERLAP = "Data;Descrição;Valor\n06/11/2026;Café;-5,00\n06/11/2026;Café;-5,00\n07/11/2026;NETFLIX.COM 222;-39,90\n";

async function catId(slug: string) {
  return (await pg.query<{ id: string }>("select id from categories where workspace_id is null and slug = $1", [slug])).rows[0].id;
}

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  ana = await createUser(pg, "ana@import.test");
  bia = await createUser(pg, "bia@import.test");
});

describe("importação CSV/OFX (FIN-11)", () => {
  it("prévia não grava e mostra novos/duplicados", async () => {
    const p = parseStatement("extrato.csv", CSV);
    const prev = await db.asUser(ana.id, (q) => previewImport({ q, ctx: ctxOf(ana) }, p));
    expect(prev).toMatchObject({ newCount: 4, duplicateCount: 0 });
    const [{ n }] = (await pg.query<{ n: number }>("select count(*)::int as n from transactions where workspace_id = $1", [ana.personalWorkspaceId])).rows;
    expect(n).toBe(0);
  });

  it("grava como pagos com origem 'import', categoria 'Outros' do tipo, e audita", async () => {
    const r = await db.asUser(ana.id, (q) => commitImport({ q, ctx: ctxOf(ana) }, parseStatement("extrato.csv", CSV)));
    expect(r).toEqual({ inserted: 4, duplicates: 0, skipped: 0 });
    const rows = (await pg.query<{ kind: string; amount_cents: string; source: string; status: string; slug: string }>(
      "select t.kind, t.amount_cents::text, t.source, t.status, c.slug from transactions t join categories c on c.id = t.category_id where t.workspace_id = $1 order by t.occurred_on, t.external_id",
      [ana.personalWorkspaceId],
    )).rows;
    expect(rows.every((r) => r.source === "import" && r.status === "paid")).toBe(true);
    expect(rows.find((r) => r.kind === "income")?.slug).toBe("outros-receita");
    const [audit] = (await pg.query<{ metadata: { inserted: number } }>("select metadata from audit_logs where action = 'finance.statement.imported'")).rows;
    expect(audit.metadata.inserted).toBe(4);
  });

  it("reimportar o mesmo arquivo ou período sobreposto não duplica", async () => {
    const again = await db.asUser(ana.id, (q) => commitImport({ q, ctx: ctxOf(ana) }, parseStatement("extrato.csv", CSV)));
    expect(again).toMatchObject({ inserted: 0, duplicates: 4 });
    const overlap = await db.asUser(ana.id, (q) => commitImport({ q, ctx: ctxOf(ana) }, parseStatement("extrato.csv", CSV_OVERLAP)));
    expect(overlap).toMatchObject({ inserted: 1, duplicates: 2 });
    const [{ n }] = (await pg.query<{ n: number }>("select count(*)::int as n from transactions where workspace_id = $1", [ana.personalWorkspaceId])).rows;
    expect(n).toBe(5);
  });

  it("dedupe é por workspace: outro usuário importa o mesmo arquivo normalmente e não vê os dados da Ana", async () => {
    const r = await db.asUser(bia.id, (q) => commitImport({ q, ctx: ctxOf(bia) }, parseStatement("extrato.csv", CSV)));
    expect(r.inserted).toBe(4);
    const seen = await asUser(pg, bia.id, (tx) => tx.query("select 1 from transactions where workspace_id = $1", [ana.personalWorkspaceId]));
    expect(seen.rows).toHaveLength(0);
    await expect(db.asUser(bia.id, (q) => commitImport({ q, ctx: { ...ctxOf(bia), workspaceId: ana.personalWorkspaceId } }, parseStatement("x.csv", "Data;Valor\n01/11/2026;-1,00"))))
      .rejects.toThrow();
  });

  it("conta de outro workspace é recusada", async () => {
    const acc = (await asUser(pg, bia.id, (tx) => tx.query<{ id: string }>(
      "insert into financial_accounts (workspace_id, owner_id, name) values ($1, $2, 'Conta Bia') returning id", [bia.personalWorkspaceId, bia.id],
    ))).rows[0].id;
    await expect(db.asUser(ana.id, (q) => commitImport({ q, ctx: ctxOf(ana) }, parseStatement("x.csv", "Data;Valor\n02/11/2026;-1,00"), { accountId: acc })))
      .rejects.toThrow(/Conta não encontrada/);
  });
});

describe("regras aprendidas (FIN-10)", () => {
  it("corrigir a categoria aprende a regra; próxima importação e lançamento manual usam a regra", async () => {
    const servicos = await catId("servicos");
    const [netflix] = (await pg.query<{ id: string }>("select id from transactions where workspace_id = $1 and description like 'NETFLIX%' limit 1", [ana.personalWorkspaceId])).rows;
    const r = await db.asUser(ana.id, (q) => recategorize({ q, ctx: ctxOf(ana) }, netflix.id, servicos, true));
    expect(r.learnedPattern).toBe("netflix com");

    const prev = await db.asUser(ana.id, (q) => previewImport({ q, ctx: ctxOf(ana) }, parseStatement("x.csv", "Data;Descrição;Valor\n03/12/2026;NETFLIX.COM 999;-44,90")));
    expect(prev.rows[0]).toMatchObject({ categoryId: servicos, categoryName: "Serviços e assinaturas" });

    const manual = await db.asUser(ana.id, (q) => createTransaction({ q, ctx: ctxOf(ana) }, { kind: "expense", description: "Netflix.com mensal", amountCents: 4490, occurredOn: "2026-12-04" }));
    expect(manual.transaction.category_id).toBe(servicos);
    // Regra de despesa não categoriza receita com o mesmo nome.
    const income = await db.asUser(ana.id, (q) => createTransaction({ q, ctx: ctxOf(ana) }, { kind: "income", description: "Netflix.com reembolso", amountCents: 100, occurredOn: "2026-12-04" }));
    expect(income.transaction.category_id).toBe(await catId("outros-receita"));
  });

  it("categoria de tipo errado é recusada; regra é do workspace (Bia não é afetada) e pode ser apagada", async () => {
    const [netflix] = (await pg.query<{ id: string }>("select id from transactions where workspace_id = $1 and description like 'NETFLIX%' limit 1", [ana.personalWorkspaceId])).rows;
    await expect(db.asUser(ana.id, (q) => recategorize({ q, ctx: ctxOf(ana) }, netflix.id, "00000000-0000-4000-8000-000000000000", false))).rejects.toThrow(/incompatível/);
    const salario = await catId("salario"); // fora da transação: PGlite tem conexão única
    await expect(db.asUser(ana.id, (q) => recategorize({ q, ctx: ctxOf(ana) }, netflix.id, salario, false))).rejects.toThrow(/incompatível/);

    const prevBia = await db.asUser(bia.id, (q) => previewImport({ q, ctx: ctxOf(bia) }, parseStatement("x.csv", "Data;Descrição;Valor\n03/12/2026;NETFLIX.COM 999;-44,90")));
    expect(prevBia.rows[0].categoryId).toBeNull();

    const rules = await db.asUser(ana.id, (q) => listRules({ q, ctx: ctxOf(ana) }));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ pattern: "netflix com", origin: "learned" });
    expect(await db.asUser(bia.id, (q) => deleteRule({ q, ctx: ctxOf(bia) }, rules[0].id))).toBe(false);
    expect(await db.asUser(ana.id, (q) => deleteRule({ q, ctx: ctxOf(ana) }, rules[0].id))).toBe(true);
  });
});
