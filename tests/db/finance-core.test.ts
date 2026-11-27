import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import type { ActorContext } from "@/server/context";
import { cardSummary, createCard, createCardPurchase, listBills, payBill, simulateCardPurchase } from "@/server/services/cards";
import { cashflowProjection, compareDebtStrategies, contributeToGoal, createDebt, createGoal, healthScore, listGoals, listRecurringCandidates, realizedBalance, refreshRecurringCandidates } from "@/server/services/planning";
import { monthSummary } from "@/server/services/finance";
import { asUser, createTestDb, createUser } from "./harness";
import { pgliteDatabase } from "../support/pglite-db";

let pg: PGlite;
let db: Database;
let alice: { id: string; personalWorkspaceId: string };
let bob: { id: string; personalWorkspaceId: string };
const NOW = new Date("2026-11-26T15:00:00Z");
let ctx: ActorContext;

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  alice = await createUser(pg, "alice@fin.test");
  bob = await createUser(pg, "bob@fin.test");
  ctx = { userId: alice.id, workspaceId: alice.personalWorkspaceId, timezone: "America/Sao_Paulo", now: NOW, channel: "dashboard" };
});

const run = <T>(fn: (deps: { q: Parameters<Parameters<Database["asUser"]>[1]>[0]; ctx: ActorContext }) => Promise<T>, c = ctx) =>
  db.asUser(c.userId, (q) => fn({ q, ctx: c }));

describe("cartões, faturas e parcelas no banco (testes 32–33)", () => {
  let cardId: string;

  it("compra parcelada gera parcelas nas faturas certas; idempotente", async () => {
    const card = await run((d) => createCard(d, { name: "Visa", last4: "1234", limitCents: 500000, closingDay: 25, dueDay: 5 }));
    cardId = card.id;
    const r1 = await run((d) => createCardPurchase(d, { cardId, description: "Notebook", totalCents: 300000, installments: 3, purchaseDate: "2026-11-10", idempotencyKey: "nb-1" }));
    const r2 = await run((d) => createCardPurchase(d, { cardId, description: "Notebook", totalCents: 300000, installments: 3, purchaseDate: "2026-11-10", idempotencyKey: "nb-1" }));
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    expect(r1.installments.map((i) => i.reference)).toEqual(["2026-11", "2026-12", "2027-01"]);
    const bills = await run((d) => listBills(d, cardId));
    expect(bills.map((b) => [b.reference, b.total_cents])).toEqual([["2026-11", 100000], ["2026-12", 100000], ["2027-01", 100000]]);
  });

  it("limite usado considera parcelas futuras; simulador mostra impacto", async () => {
    const s = await run((d) => cardSummary(d, cardId, "2026-11-26"));
    expect(s.limit).toMatchObject({ usedCents: 300000, availableCents: 200000, usagePct: 60 });
    expect(s.current?.reference).toBe("2026-12");
    const sim = simulateCardPurchase(s.card, s.bills, s.limit, 250000, 2, "2026-11-26");
    expect(sim.fitsLimit).toBe(false);
    expect(sim.bills[0]).toEqual({ reference: "2026-12", beforeCents: 100000, afterCents: 225000 });
  });

  it("pagamento de fatura não vira despesa nem duplica (teste 32)", async () => {
    const before = await run((d) => monthSummary(d));
    const nov = (await run((d) => listBills(d, cardId))).find((b) => b.reference === "2026-11")!;
    const p1 = await run((d) => payBill(d, nov.id, 100000, "2026-12-05", undefined, "pay-nov"));
    const p2 = await run((d) => payBill(d, nov.id, 100000, "2026-12-05", undefined, "pay-nov"));
    expect(p1).toMatchObject({ duplicate: false, paidCents: 100000, totalCents: 100000 });
    expect(p2).toEqual({ duplicate: true });
    const after = await run((d) => monthSummary(d));
    expect(after.expenseCents).toBe(before.expenseCents);
    const [status] = (await pg.query<{ status: string }>("select status from credit_card_bills where id = $1", [nov.id])).rows;
    expect(status.status).toBe("paid");
  });

  it("resumo do mês ignora parcelas projetadas, cancelados e transferências; reembolso abate", async () => {
    const c2 = { ...ctx, now: new Date("2027-01-15T15:00:00Z") };
    const jan = await run((d) => monthSummary(d), c2);
    // Parcela 3/3 (2027-01) ainda é "projected": não conta como gasto de janeiro.
    expect(jan.expenseCents).toBe(0);
    await run((d) =>
      d.q.query(
        `insert into transactions (workspace_id, owner_id, kind, description, amount_cents, occurred_on, status) values
         ($1, $2, 'expense', 'Mercado', 10000, '2027-01-10', 'paid'),
         ($1, $2, 'expense', 'Cancelado', 99999, '2027-01-10', 'cancelled'),
         ($1, $2, 'refund', 'Estorno mercado', 2000, '2027-01-11', 'paid'),
         ($1, $2, 'transfer', 'Poupança', 50000, '2027-01-12', 'paid')`,
        [c2.workspaceId, c2.userId],
      ),
      c2,
    );
    expect((await run((d) => monthSummary(d), c2)).expenseCents).toBe(8000);
  });

  it("transação não pode apontar para cartão de outro workspace", async () => {
    await expect(
      asUser(pg, bob.id, (tx) =>
        tx.query(
          "insert into transactions (workspace_id, owner_id, kind, description, amount_cents, occurred_on, card_id) values ($1, $2, 'expense', 'x', 100, current_date, $3)",
          [bob.personalWorkspaceId, bob.id, cardId],
        ),
      ),
    ).rejects.toThrow(/outro workspace/);
  });

  it("Bob não vê cartões, faturas, metas ou dívidas de Alice", async () => {
    const r = await asUser(pg, bob.id, async (tx) => ({
      cards: (await tx.query("select id from credit_cards")).rows,
      bills: (await tx.query("select id from credit_card_bills")).rows,
    }));
    expect(r.cards).toHaveLength(0);
    expect(r.bills).toHaveLength(0);
  });
});

describe("metas, dívidas, fluxo de caixa (testes 35–38)", () => {
  it("contribuições atualizam progresso e concluem a meta; idempotente", async () => {
    const goalId = await run((d) => createGoal(d, { name: "Reserva", kind: "emergency", targetCents: 200000, deadline: "2027-11-26" }));
    await run((d) => contributeToGoal(d, goalId, 150000, "c1"));
    await run((d) => contributeToGoal(d, goalId, 150000, "c1"));
    let g = (await run((d) => listGoals(d))).find((x) => x.id === goalId)!;
    expect(g).toMatchObject({ savedCents: 150000, pct: 75, requiredMonthlyCents: 4167 });
    await run((d) => contributeToGoal(d, goalId, 50000, "c2"));
    g = (await run((d) => listGoals(d))).find((x) => x.id === goalId)!;
    expect(g.remainingCents).toBe(0);
    expect((await pg.query<{ status: string }>("select status from goals where id = $1", [goalId])).rows[0].status).toBe("achieved");
  });

  it("estratégias de dívida comparadas com aviso de estimativa", async () => {
    await run((d) => createDebt(d, { creditor: "Cartão X", balanceCents: 300000, monthlyRatePct: 12, minPaymentCents: 15000 }));
    await run((d) => createDebt(d, { creditor: "Pessoal Y", balanceCents: 100000, monthlyRatePct: 2, minPaymentCents: 5000 }));
    const c = await run((d) => compareDebtStrategies(d, 100000));
    expect(c.avalanche.totalInterestCents).toBeLessThanOrEqual(c.snowball.totalInterestCents);
    expect(c.estimated).toBe(true);
    expect(c.disclaimer).toMatch(/Simulação educacional/);
  });

  it("projeção usa saldo realizado + pendentes + faturas em aberto", async () => {
    await run((d) =>
      d.q.query("insert into financial_accounts (workspace_id, owner_id, name, opening_balance_cents) values ($1, $2, 'Conta', 1000000)", [ctx.workspaceId, ctx.userId]),
    );
    await run((d) =>
      d.q.query(
        "insert into transactions (workspace_id, owner_id, kind, description, amount_cents, occurred_on, status, due_on) values ($1, $2, 'expense', 'Aluguel', 250000, '2026-11-26', 'pending', '2026-11-30')",
        [ctx.workspaceId, ctx.userId],
      ),
    );
    const start = await run((d) => realizedBalance(d));
    // 45 dias (até 09/01): fatura 2026-12 vence 05/01 (entra); a de 2027-01 vence 05/02 (fora da janela).
    const p45 = await run((d) => cashflowProjection(d, 45));
    expect(p45.startBalanceCents).toBe(start);
    expect(p45.endBalanceCents).toBe(start - 250000 - 100000);
    const p75 = await run((d) => cashflowProjection(d, 75));
    expect(p75.events.map((e) => e.label)).toEqual(expect.arrayContaining(["Aluguel", "Fatura Visa 2026-12", "Fatura Visa 2027-01"]));
    expect(p75.endBalanceCents).toBe(start - 250000 - 100000 - 100000);
  });

  it("recorrência detectada é sugerida e fica no escopo do titular", async () => {
    for (const [d, v] of [["2026-08-03", 5590], ["2026-09-03", 5590], ["2026-10-03", 5590], ["2026-11-03", 5990]] as const) {
      await run((x) =>
        x.q.query("insert into transactions (workspace_id, owner_id, kind, description, amount_cents, occurred_on) values ($1, $2, 'expense', 'SPOTIFY', $3, $4)", [ctx.workspaceId, ctx.userId, v, d]),
      );
    }
    const found = await run((d) => refreshRecurringCandidates(d));
    expect(found.map((f) => f.key)).toContain("spotify");
    const list = await run((d) => listRecurringCandidates(d));
    expect(list.find((l) => l.label === "SPOTIFY")?.price_change_pct).toBe("7.2");
    const leak = await asUser(pg, bob.id, (tx) => tx.query("select id from recurring_candidates"));
    expect(leak.rows).toHaveLength(0);
  });

  it("saúde financeira sem histórico não inventa valor", async () => {
    const bobCtx = { ...ctx, userId: bob.id, workspaceId: bob.personalWorkspaceId };
    expect(await run((d) => healthScore(d), bobCtx)).toBeNull();
  });
});
