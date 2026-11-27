import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import type { ActorContext } from "@/server/context";
import { createCard, createCardPurchase, payBill, listBills } from "@/server/services/cards";
import { archiveAsset, computeNetWorth, createAsset, listAssets, listSnapshots, revalueAsset, takeSnapshot } from "@/server/services/patrimony";
import { createDebt } from "@/server/services/planning";
import { asUser, createTestDb, createUser } from "./harness";
import { pgliteDatabase } from "../support/pglite-db";

let pg: PGlite;
let db: Database;
let ana: { id: string; personalWorkspaceId: string };
let beto: { id: string; personalWorkspaceId: string };
let familyId: string;
const ctx = (userId: string, workspaceId: string, now = "2026-11-27T12:00:00Z"): ActorContext => ({ userId, workspaceId, timezone: "America/Sao_Paulo", now: new Date(now), channel: "dashboard" });

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  ana = await createUser(pg, "ana@patrimonio.test");
  beto = await createUser(pg, "beto@patrimonio.test");
  familyId = await asUser(pg, ana.id, async (tx) => (await tx.query<{ id: string }>("select public.create_workspace('Casa', 'family') as id")).rows[0].id);
});

describe("patrimônio no banco (PAT-01)", () => {
  const c = () => ctx(ana.id, ana.personalWorkspaceId);

  it("sem dados: zero, sem caixa inventado", async () => {
    const nw = await db.asUser(ana.id, (q) => computeNetWorth({ q, ctx: c() }));
    expect(nw).toMatchObject({ assetsCents: 0, liabilitiesCents: 0, netWorthCents: 0, assets: [] });
  });

  it("bens validados; caixa conta lançamentos; cartão em aberto e dívida são passivos", async () => {
    await expect(db.asUser(ana.id, (q) => createAsset({ q, ctx: c() }, { name: "", kind: "property", valueCents: 1 }))).rejects.toThrow(/Nome/);
    await expect(db.asUser(ana.id, (q) => createAsset({ q, ctx: c() }, { name: "X", kind: "property", valueCents: 1, valuedOn: "2027-01-01" }))).rejects.toThrow(/futura/);
    const apto = await db.asUser(ana.id, (q) => createAsset({ q, ctx: c() }, { name: "Apartamento", kind: "property", valueCents: 40_000_000 }));
    await db.asUser(ana.id, (q) => createAsset({ q, ctx: c() }, { name: "Reserva no cofrinho", kind: "cash", valueCents: 500_000 }));
    expect((await db.asUser(ana.id, (q) => listAssets({ q, ctx: c() }))).find((a) => a.name.startsWith("Reserva"))?.liquid).toBe(true); // dinheiro é líquido por padrão

    await asUser(pg, ana.id, (tx) => tx.query(
      `insert into transactions (workspace_id, owner_id, kind, status, amount_cents, occurred_on, description) values
       ($1, $2, 'income', 'paid', 800000, '2026-11-05', 'Salário'), ($1, $2, 'expense', 'paid', 300000, '2026-11-06', 'Aluguel'),
       ($1, $2, 'expense', 'cancelled', 999999, '2026-11-07', 'Cancelada'), ($1, $2, 'expense', 'pending', 10000, '2026-11-30', 'Pendente')`,
      [ana.personalWorkspaceId, ana.id],
    ));
    const card = await db.asUser(ana.id, (q) => createCard({ q, ctx: c() }, { name: "Cartão", limitCents: 1_000_000, closingDay: 3, dueDay: 10 }));
    await db.asUser(ana.id, (q) => createCardPurchase({ q, ctx: c() }, { cardId: card.id, description: "TV", totalCents: 300_000, installments: 3, purchaseDate: "2026-11-20" }));
    await db.asUser(ana.id, (q) => createDebt({ q, ctx: c() }, { creditor: "Financiamento", kind: "financing", balanceCents: 25_000_000, monthlyRatePct: 0.9, minPaymentCents: 250_000 }));

    const nw = await db.asUser(ana.id, (q) => computeNetWorth({ q, ctx: c() }));
    const cash = nw.assets.find((a) => a.label === "Contas registradas no GEMA")!.cents;
    expect(cash).toBe(800000 - 300000); // compra no cartão não sai do caixa; cancelada/pendente não contam
    expect(nw.liabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Financiamento", cents: 25_000_000 }),
      expect.objectContaining({ label: "Cartão", cents: 300_000 }), // todas as parcelas não pagas
    ]));
    expect(nw.netWorthCents).toBe(40_000_000 + 500_000 + 500_000 - 25_000_000 - 300_000);
    expect(nw.liquidCents).toBe(500_000 + 500_000);

    await db.asUser(ana.id, (q) => revalueAsset({ q, ctx: c() }, apto, 42_000_000));
    expect((await db.asUser(ana.id, (q) => computeNetWorth({ q, ctx: c() }))).netWorthCents).toBe(nw.netWorthCents + 2_000_000);
  });

  it("pagar a fatura reduz caixa e passivo na mesma medida (patrimônio não muda)", async () => {
    const before = await db.asUser(ana.id, (q) => computeNetWorth({ q, ctx: c() }));
    const [card] = (await pg.query<{ id: string }>("select id from credit_cards where workspace_id = $1", [ana.personalWorkspaceId])).rows;
    const bills = await db.asUser(ana.id, (q) => listBills({ q, ctx: c() }, card.id));
    const first = bills.find((b) => Number(b.total_cents) > 0)!;
    await db.asUser(ana.id, (q) => payBill({ q, ctx: c() }, first.id, Number(first.total_cents), "2026-11-27"));
    const after = await db.asUser(ana.id, (q) => computeNetWorth({ q, ctx: c() }));
    expect(after.liabilitiesCents).toBe(before.liabilitiesCents - Number(first.total_cents));
    expect(after.netWorthCents).toBe(before.netWorthCents);
  });

  it("conta vinculada a banco conectado entra pelo saldo do banco, sem somar os lançamentos de novo", async () => {
    const [fa] = (await pg.query<{ id: string }>(
      "insert into financial_accounts (workspace_id, owner_id, name, opening_balance_cents) values ($1, $2, 'Corrente', 0) returning id", [ana.personalWorkspaceId, ana.id],
    )).rows;
    await pg.query("insert into transactions (workspace_id, owner_id, kind, status, amount_cents, occurred_on, description, account_id, source) values ($1, $2, 'income', 'paid', 123400, '2026-11-26', 'Importado', $3, 'import')", [ana.personalWorkspaceId, ana.id, fa.id]);
    const before = await db.asUser(ana.id, (q) => computeNetWorth({ q, ctx: c() }));
    const [conn] = (await pg.query<{ id: string }>(
      "insert into bank_connections (workspace_id, owner_id, provider, external_item_id, institution_name, status) values ($1, $2, 'pluggy', 'item-1', 'Banco Teste', 'updated') returning id",
      [ana.personalWorkspaceId, ana.id],
    )).rows;
    await pg.query(
      "insert into bank_accounts (connection_id, workspace_id, owner_id, external_account_id, kind, name, balance_cents, balance_at, financial_account_id) values ($1, $2, $3, 'acc-1', 'bank', 'Corrente', 200000, now(), $4)",
      [conn.id, ana.personalWorkspaceId, ana.id, fa.id],
    );
    const after = await db.asUser(ana.id, (q) => computeNetWorth({ q, ctx: c() }));
    expect(after.assets.find((a) => a.label === "Banco Teste · Corrente")?.cents).toBe(200000);
    expect(after.assetsCents).toBe(before.assetsCents - 123400 + 200000);
    // Revogada a conexão, a conta volta a valer pelos lançamentos.
    await pg.query("update bank_connections set revoked_at = now(), status = 'revoked' where id = $1", [conn.id]);
    expect((await db.asUser(ana.id, (q) => computeNetWorth({ q, ctx: c() }))).assetsCents).toBe(before.assetsCents);
  });

  it("fotografia diária única por usuário; série e variação", async () => {
    await db.asUser(ana.id, (q) => takeSnapshot({ q, ctx: ctx(ana.id, ana.personalWorkspaceId, "2026-10-31T12:00:00Z") }));
    await db.asUser(ana.id, (q) => takeSnapshot({ q, ctx: c() }));
    await db.asUser(ana.id, (q) => takeSnapshot({ q, ctx: c() })); // mesmo dia: atualiza
    const s = await db.asUser(ana.id, (q) => listSnapshots({ q, ctx: c() }));
    expect(s.series.map((x) => x.date)).toEqual(["2026-10-31", "2026-11-27"]);
    expect(s.change).not.toBeNull();
  });

  it("isolamento: outro usuário não vê bens nem fotografias; no workspace familiar só o compartilhado", async () => {
    const bnw = await db.asUser(beto.id, (q) => computeNetWorth({ q, ctx: ctx(beto.id, ana.personalWorkspaceId) }));
    expect(bnw.assetsCents).toBe(0);
    expect((await db.asUser(beto.id, (q) => listSnapshots({ q, ctx: ctx(beto.id, ana.personalWorkspaceId) }))).series).toEqual([]);
    const fc = ctx(ana.id, familyId);
    await db.asUser(ana.id, (q) => createAsset({ q, ctx: fc }, { name: "Casa de praia", kind: "property", valueCents: 1_000_000, visibility: "workspace" }));
    const priv = await db.asUser(ana.id, (q) => createAsset({ q, ctx: fc }, { name: "Joias", kind: "other", valueCents: 50_000 }));
    await pg.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'family')", [familyId, beto.id]);
    const seen = await db.asUser(beto.id, (q) => listAssets({ q, ctx: ctx(beto.id, familyId) }));
    expect(seen.map((a) => a.name)).toEqual(["Casa de praia"]);
    expect(await db.asUser(beto.id, (q) => archiveAsset({ q, ctx: ctx(beto.id, familyId) }, priv))).toBe(false);
    expect(await db.asUser(ana.id, (q) => archiveAsset({ q, ctx: fc }, priv))).toBe(true);
  });
});
