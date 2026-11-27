import { describe, expect, it } from "vitest";
import { netWorth, netWorthChange, type NetWorthInput } from "@/server/finance/engine";

const base: NetWorthInput = {
  today: "2026-11-27",
  assets: [
    { name: "Apartamento", kind: "property", valueCents: 45_000_000, liquid: false, valuedOn: "2026-06-01" },
    { name: "Tesouro Selic", kind: "investment", valueCents: 2_000_000, liquid: true, valuedOn: "2026-11-01" },
    { name: "Carro", kind: "vehicle", valueCents: 6_000_000, liquid: false, valuedOn: "2025-08-10" },
  ],
  bankAccounts: [
    { name: "Banco A · Corrente", balanceCents: 350_000, balanceAt: "2026-11-27T09:00:00Z" },
    { name: "Banco B · Poupança", balanceCents: null, balanceAt: null },
  ],
  registeredCashCents: 120_000,
  debts: [
    { creditor: "Financiamento imobiliário", kind: "financing", balanceCents: 30_000_000 },
    { creditor: "Quitada", kind: "other", balanceCents: 0 },
  ],
  cards: [{ name: "Cartão X", openCents: 250_000 }, { name: "Cartão Y", openCents: 0 }],
};

describe("patrimônio líquido (PAT-01)", () => {
  const nw = netWorth(base);

  it("ativos − passivos, em centavos inteiros", () => {
    expect(nw.assetsCents).toBe(45_000_000 + 2_000_000 + 6_000_000 + 350_000 + 120_000);
    expect(nw.liabilitiesCents).toBe(30_000_000 + 250_000);
    expect(nw.netWorthCents).toBe(nw.assetsCents - nw.liabilitiesCents);
  });

  it("liquidez: contas, caixa registrado e bens marcados como líquidos", () => {
    expect(nw.liquidCents).toBe(350_000 + 120_000 + 2_000_000);
  });

  it("não inventa saldo: banco sem saldo fica fora com aviso; zeros não viram linha", () => {
    expect(nw.assets.some((a) => a.label.includes("Poupança"))).toBe(false);
    expect(nw.warnings.join(" ")).toMatch(/Poupança.*não informou/);
    expect(nw.liabilities.map((l) => l.label)).toEqual(["Financiamento imobiliário", "Cartão X"]);
  });

  it("avisa sobre avaliação antiga e possível dupla contagem de cartão", () => {
    expect(nw.warnings.join(" ")).toMatch(/Carro.*12 meses/);
    expect(nw.warnings.join(" ")).not.toMatch(/Apartamento.*12 meses/);
    const dup = netWorth({ ...base, debts: [{ creditor: "Fatura atrasada", kind: "credit_card", balanceCents: 100 }] });
    expect(dup.warnings.join(" ")).toMatch(/contado duas vezes/);
  });

  it("sem dados: tudo zero, sem linha de caixa registrado inventada", () => {
    const empty = netWorth({ today: "2026-11-27", assets: [], bankAccounts: [], registeredCashCents: null, debts: [], cards: [] });
    expect(empty).toMatchObject({ assetsCents: 0, liabilitiesCents: 0, netWorthCents: 0, liquidCents: 0, assets: [], liabilities: [] });
  });

  it("patrimônio negativo é permitido; liquidez nunca negativa", () => {
    const neg = netWorth({ ...base, assets: [], bankAccounts: [], registeredCashCents: -50_000 });
    expect(neg.netWorthCents).toBeLessThan(0);
    expect(neg.liquidCents).toBe(0);
  });

  it("variação entre fotografias", () => {
    expect(netWorthChange(110, null)).toBeNull();
    expect(netWorthChange(110, 100)).toEqual({ cents: 10, pct: 10 });
    expect(netWorthChange(-50, -100)).toEqual({ cents: 50, pct: 50 });
    expect(netWorthChange(10, 0)).toEqual({ cents: 10, pct: null });
  });
});
