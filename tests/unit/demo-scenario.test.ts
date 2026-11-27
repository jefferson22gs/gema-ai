import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_SCRIPT, buildDemoScenario } from "@/lib/demo/scenario";

describe("cenário da /demo (UX-03)", () => {
  const s = buildDemoScenario("2026-11-20");

  it("é determinístico para a mesma data", () => {
    expect(buildDemoScenario("2026-11-20")).toEqual(s);
  });

  it("totais seguem as regras do motor: cancelado, pendente e fatura fora; estorno abate", () => {
    expect(s.totals.incomeCents).toBe(980_000);
    expect(s.totals.expenseCents).toBe(280_000 + 64_350 + 8_500 + 22_000);
    expect(s.totals.resultCents).toBe(980_000 - (280_000 + 64_350 + 8_500 + 22_000) + 12_990);
    expect(s.totals.pendingOutCents).toBe(15_990);
  });

  it("projeção, recorrências e simulações vêm do motor (não são números decorativos)", () => {
    expect(s.cashflow.days).toHaveLength(45);
    expect(s.cashflow.days[0].date).toBe("2026-11-21");
    expect(s.recurring.map((r) => r.label)).toEqual(expect.arrayContaining(["Academia", "Streaming de vídeo"]));
    expect(s.recurring.find((r) => r.label === "Streaming de vídeo")?.priceChangePct).toBeGreaterThan(0);
    expect(s.recurring.some((r) => r.label === "Farmácia")).toBe(false); // irregular
    expect(s.payoff.avalanche.totalInterestCents).toBeLessThanOrEqual(s.payoff.snowball.totalInterestCents);
    expect(s.health.score).toBeGreaterThan(0);
    expect(s.health.score).toBeLessThanOrEqual(100);
  });

  it("roteiro do assistente nunca executa transferência", () => {
    const transfer = DEMO_SCRIPT.find((m) => /transfere/i.test(m.prompt));
    expect(transfer?.blocked).toBe(true);
    expect(transfer?.reply).toMatch(/não são executados/);
  });

  it("módulos da demo não importam banco, rede ou provedores", () => {
    for (const f of ["src/lib/demo/scenario.ts", "src/components/demo/demo-app.tsx", "src/app/(site)/demo/page.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/@\/lib\/db|fetch\(|@google\/genai|server\/(ai|messaging|email|open-finance|services)/);
    }
  });
});
