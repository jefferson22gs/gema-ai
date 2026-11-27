import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import type { ActorContext } from "@/server/context";
import { acceptInvitation, createInvitation } from "@/server/services/members";
import { buildMonthlyReport, renderReport } from "@/server/reports/monthly";
import { asUser, createTestDb, createUser } from "./harness";
import { pgliteDatabase } from "../support/pglite-db";

let pg: PGlite;
let db: Database;
let dona: { id: string; personalWorkspaceId: string };
let visual: { id: string; personalWorkspaceId: string };
let companyId: string;
const ctx = (userId: string, workspaceId: string): ActorContext => ({ userId, workspaceId, timezone: "America/Sao_Paulo", now: new Date("2026-11-27T12:00:00Z"), channel: "dashboard" });

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  dona = await createUser(pg, "dona@relatorio.test");
  visual = await createUser(pg, "visual@relatorio.test");
  companyId = await asUser(pg, dona.id, async (tx) => (await tx.query<{ id: string }>("select public.create_workspace('Loja', 'business') as id")).rows[0].id);
  const ins = (kind: string, status: string, cents: number, date: string, desc: string, vis = "workspace") =>
    asUser(pg, dona.id, (tx) => tx.query(
      "insert into transactions (workspace_id, owner_id, visibility, kind, status, amount_cents, occurred_on, description) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [companyId, dona.id, vis, kind, status, cents, date, desc],
    ));
  await ins("income", "paid", 500000, "2026-11-05", "Vendas");
  await ins("expense", "paid", 120000, "2026-11-06", "=HYPERLINK(\"x\")");
  await ins("expense", "pending", 30000, "2026-11-20", "Fornecedor");
  await ins("expense", "cancelled", 99999, "2026-11-07", "Cancelada");
  await ins("expense", "projected", 88888, "2026-11-28", "Projetada");
  await ins("refund", "paid", 10000, "2026-11-08", "Reembolso");
  await ins("card_payment", "paid", 70000, "2026-11-10", "Fatura");
  await ins("expense", "paid", 5000, "2026-10-31", "Mês anterior");
  await ins("expense", "paid", 7777, "2026-11-09", "Privada da dona", "private");
  const inv = await db.asUser(dona.id, (q) => createInvitation(q, { workspaceId: companyId, invitedBy: dona.id, email: "visual@relatorio.test", role: "viewer" }));
  await db.asUser(visual.id, (q) => acceptInvitation(q, inv.token));
});

describe("relatório mensal (FIN-13)", () => {
  it("soma pelas regras do painel: sem cancelado/projetado/fatura, reembolso abate, mês fechado", async () => {
    const r = await db.asUser(dona.id, (q) => buildMonthlyReport({ q, ctx: ctx(dona.id, companyId) }, "2026-11"));
    expect(r.incomeCents).toBe(500000);
    expect(r.expenseCents).toBe(120000 + 30000 + 7777 - 10000);
    expect(r.resultCents).toBe(500000 - (120000 + 30000 + 7777 - 10000));
    expect(r.rows.map((x) => x.description)).not.toContain("Mês anterior");
    expect(r.rows.find((x) => x.description === "Cancelada")?.signedCents).toBe(0);
    expect(r.rows.find((x) => x.description === "Fatura")).toMatchObject({ kind: "Pagamento de fatura", signedCents: 0 });
  });

  it("respeita RLS e papel: visualizador não exporta; mês inválido é recusado", async () => {
    await expect(db.asUser(visual.id, (q) => buildMonthlyReport({ q, ctx: ctx(visual.id, companyId) }, "2026-11"))).rejects.toThrow(/não permite exportar/);
    await expect(db.asUser(dona.id, (q) => buildMonthlyReport({ q, ctx: ctx(dona.id, companyId) }, "2026-13"))).rejects.toThrow(/Mês inválido/);
    // Ao virar financeiro, exporta, mas sem os lançamentos privados da dona.
    await pg.query("update workspace_members set role = 'finance' where workspace_id = $1 and user_id = $2", [companyId, visual.id]);
    const r = await db.asUser(visual.id, (q) => buildMonthlyReport({ q, ctx: ctx(visual.id, companyId) }, "2026-11"));
    expect(r.rows.map((x) => x.description)).not.toContain("Privada da dona");
  });

  it("renderiza os três formatos com nome de arquivo e tipo corretos e sem fórmula", async () => {
    const r = await db.asUser(dona.id, (q) => buildMonthlyReport({ q, ctx: ctx(dona.id, companyId) }, "2026-11"));
    const pdf = renderReport(r, "pdf", "27/11/2026 09:00");
    expect(pdf.contentType).toBe("application/pdf");
    expect((pdf.body as Buffer).subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    const csv = renderReport(r, "csv", "x");
    expect(csv.body).toContain(`"'=HYPERLINK(""x"")"`);
    const xlsx = renderReport(r, "xlsx", "x");
    expect(xlsx.ext).toBe("xlsx");
    expect((xlsx.body as Buffer).subarray(0, 2).toString("latin1")).toBe("PK");
  });
});
