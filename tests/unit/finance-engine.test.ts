import { describe, expect, it } from "vitest";
import {
  billFor, canAfford, cardLimit, detectRecurring, financialHealth, goalProgress, merchantKey, monthsToGoal, periodTotals,
  projectCashflow, resultEffect, simulatePayoff, simulatePurchase, splitInstallments, type LedgerEntry,
} from "@/server/finance/engine";

const cycle = { closingDay: 25, dueDay: 5 };

describe("resultado sem dupla contabilização (testes 31–34)", () => {
  it("transferência própria e pagamento de fatura não são despesa; estorno reduz; cancelado não conta", () => {
    const entries: LedgerEntry[] = [
      { kind: "income", status: "paid", amountCents: 500000, date: "2026-11-01" },
      { kind: "expense", status: "paid", amountCents: 20000, date: "2026-11-02" }, // compra no cartão
      { kind: "card_payment", status: "paid", amountCents: 20000, date: "2026-11-05" }, // pagamento da fatura
      { kind: "transfer", status: "paid", amountCents: 100000, date: "2026-11-06", internalTransfer: true },
      { kind: "refund", status: "paid", amountCents: 5000, date: "2026-11-07" },
      { kind: "expense", status: "cancelled", amountCents: 99999, date: "2026-11-08" },
      { kind: "expense", status: "reversed", amountCents: 7000, date: "2026-11-09" },
      { kind: "expense", status: "pending", amountCents: 15000, date: "2026-11-20" },
    ];
    const t = periodTotals(entries);
    expect(t).toEqual({ incomeCents: 500000, expenseCents: 20000, refundCents: 5000, resultCents: 485000, pendingOutCents: 15000, pendingInCents: 0 });
    expect(resultEffect(entries[2])).toBe(0);
    expect(resultEffect(entries[3])).toBe(0);
  });

  it("pendente que depois é confirmado conta uma única vez", () => {
    const pending: LedgerEntry = { kind: "expense", status: "pending", amountCents: 1000, date: "2026-11-10" };
    const confirmed: LedgerEntry = { ...pending, status: "paid" };
    expect(periodTotals([pending]).expenseCents).toBe(0);
    expect(periodTotals([confirmed]).expenseCents).toBe(1000);
  });
});

describe("cartão: faturas e parcelamento (teste 33)", () => {
  it("compra antes do fechamento entra na fatura do mês; no dia do fechamento ou depois, na seguinte", () => {
    expect(billFor("2026-11-24", cycle)).toEqual({ reference: "2026-11", closingDate: "2026-11-25", dueDate: "2026-12-05" });
    expect(billFor("2026-11-25", cycle).reference).toBe("2026-12");
    expect(billFor("2026-12-28", cycle)).toEqual({ reference: "2027-01", closingDate: "2027-01-25", dueDate: "2027-02-05" });
  });

  it("vencimento no mesmo mês quando dueDay > closingDay e dia ajustado em fevereiro", () => {
    // Fechamento "dia 31" em fevereiro cai em 28/02; vencimento dia 31 (não > fechamento) vai para março.
    expect(billFor("2026-02-01", { closingDay: 31, dueDay: 31 })).toEqual({ reference: "2026-02", closingDate: "2026-02-28", dueDate: "2026-03-31" });
    expect(billFor("2026-01-20", { closingDay: 25, dueDay: 30 }).dueDate).toBe("2026-01-30");
    expect(billFor("2026-02-20", { closingDay: 25, dueDay: 30 }).dueDate).toBe("2026-02-28");
    expect(billFor("2026-03-01", { closingDay: 3, dueDay: 10 })).toMatchObject({ reference: "2026-03", dueDate: "2026-03-10" });
  });

  it("parcelas somam exatamente o total; resto do arredondamento na primeira", () => {
    const parts = splitInstallments(100000, 3, "2026-11-10", cycle);
    expect(parts.map((p) => p.amountCents)).toEqual([33334, 33333, 33333]);
    expect(parts.reduce((s, p) => s + p.amountCents, 0)).toBe(100000);
    expect(parts.map((p) => p.bill.reference)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(() => splitInstallments(100, 0, "2026-11-10", cycle)).toThrow();
  });

  it("limite usado/disponível e simulador de nova compra", () => {
    const lim = cardLimit(500000, [100000, 50000], 0);
    expect(lim).toEqual({ limitCents: 500000, usedCents: 150000, availableCents: 350000, usagePct: 30 });
    const sim = simulatePurchase(120000, 4, "2026-11-10", cycle, { "2026-11": 100000 }, lim);
    expect(sim.bills[0]).toEqual({ reference: "2026-11", beforeCents: 100000, afterCents: 130000 });
    expect(sim.fitsLimit).toBe(true);
    expect(sim.availableAfterCents).toBe(230000);
    expect(simulatePurchase(400000, 1, "2026-11-10", cycle, {}, lim).fitsLimit).toBe(false);
  });
});

describe("metas (teste 37)", () => {
  it("progresso e contribuição mensal necessária", () => {
    expect(goalProgress(1200000, 300000, "2026-11-26", "2027-11-26")).toEqual({
      targetCents: 1200000, savedCents: 300000, remainingCents: 900000, pct: 25, monthsLeft: 12, requiredMonthlyCents: 75000,
    });
    expect(goalProgress(100000, 150000, "2026-11-26").pct).toBe(100);
    expect(monthsToGoal(900000, 100000)).toBe(9);
    expect(monthsToGoal(900000, 0)).toBeNull();
  });
});

describe("fluxo de caixa e simulação de compra", () => {
  it("projeta saldo diário com hipóteses e detecta o menor saldo", () => {
    const p = projectCashflow(100000, "2026-11-26", 10, [
      { date: "2026-11-28", deltaCents: -80000, label: "Aluguel", source: "pending" },
      { date: "2026-12-01", deltaCents: 300000, label: "Salário", source: "recurring" },
      { date: "2026-12-05", deltaCents: -50000, label: "Fatura", source: "card_bill" },
    ]);
    expect(p.lowest).toEqual({ date: "2026-11-28", balanceCents: 20000 });
    expect(p.endBalanceCents).toBe(270000);
    expect(p.assumptions.length).toBeGreaterThan(0);
    expect(canAfford(p, 30000, "2026-11-26", 0).ok).toBe(false);
    expect(canAfford(p, 15000, "2026-11-26", 0).ok).toBe(true);
  });
});

describe("dívidas: bola de neve vs avalanche (teste 38)", () => {
  const debts = [
    { id: "cartao", name: "Cartão", balanceCents: 500000, monthlyRate: 0.12, minPaymentCents: 20000 },
    { id: "pessoal", name: "Empréstimo", balanceCents: 200000, monthlyRate: 0.03, minPaymentCents: 10000 },
  ];
  it("avalanche paga menos juros; snowball quita a menor primeiro", () => {
    const av = simulatePayoff(debts, 150000, "avalanche");
    const sb = simulatePayoff(debts, 150000, "snowball");
    expect(av.feasible && sb.feasible).toBe(true);
    expect(av.totalInterestCents).toBeLessThan(sb.totalInterestCents);
    expect(sb.order[0]).toBe("pessoal");
    expect(av.order[0]).toBe("cartao");
  });
  it("orçamento abaixo do mínimo é inviável", () => {
    expect(simulatePayoff(debts, 25000, "snowball").feasible).toBe(false);
  });
});

describe("recorrências", () => {
  it("detecta assinatura mensal e variação de preço; ignora gasto irregular", () => {
    const txs = [
      { description: "NETFLIX.COM 0001", amountCents: 3990, date: "2026-08-05" },
      { description: "Netflix.com 0002", amountCents: 3990, date: "2026-09-05" },
      { description: "NETFLIX.COM", amountCents: 3990, date: "2026-10-06" },
      { description: "NETFLIX.COM", amountCents: 4490, date: "2026-11-05" },
      { description: "Mercado Bom Preço", amountCents: 23000, date: "2026-11-01" },
      { description: "Mercado Bom Preço", amountCents: 5000, date: "2026-11-03" },
      { description: "Mercado Bom Preço", amountCents: 31000, date: "2026-11-20" },
    ];
    const r = detectRecurring(txs);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: "netflix com", occurrences: 4, intervalDays: 30, lastCents: 4490, nextEstimatedDate: "2026-12-05" });
    expect(r[0].priceChangePct).toBe(12.5);
    expect(merchantKey("PIX - João 123")).toBe("pix joao");
  });
});

describe("saúde financeira", () => {
  it("componentes somam até 100 e trazem metodologia e aviso", () => {
    const h = financialHealth({
      monthlyIncomeCents: 1000000, monthlyExpenseCents: 800000, liquidReserveCents: 4800000, debtPaymentsCents: 0,
      creditCardUsagePct: 30, monthsWithPositiveResult: 6, monthsObserved: 6,
    });
    expect(h.score).toBe(100);
    expect(h.components.map((c) => c.max).reduce((a, b) => a + b)).toBe(100);
    expect(h.disclaimer).toMatch(/Não é score de crédito/);
    const weak = financialHealth({ monthlyIncomeCents: 100000, monthlyExpenseCents: 150000, liquidReserveCents: 0, debtPaymentsCents: 60000, creditCardUsagePct: 100, monthsWithPositiveResult: 0, monthsObserved: 3 });
    expect(weak.score).toBe(0);
  });
});
