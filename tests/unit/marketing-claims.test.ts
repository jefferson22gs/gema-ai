import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Páginas públicas não podem trazer métricas fabricadas, depoimentos ou preços fixos (regra V3). */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

const PAGES = [...files("src/app/(site)"), ...files("src/app/(auth)")].filter((f) => !f.includes(`${join("(site)", "demo")}`));

describe("marketing honesto (UX-04)", () => {
  it.each(PAGES)("%s sem métricas, depoimentos, certificações ou preço fixo", (f) => {
    const src = readFileSync(f, "utf8");
    expect(src).not.toMatch(/\b\d[\d.]*\s*(mil\s+)?(clientes|usuários|empresas atendidas)/i);
    expect(src).not.toMatch(/\b(9\d|100)\s?%\s*(de\s+)?(satisfa|uptime|disponibilidade|autonomia)/i);
    expect(src).not.toMatch(/depoimento|avaliação 5 estrelas|certificad[oa] (ISO|SOC|PCI)/i);
    expect(src).not.toMatch(/price:\s*\d{3,}/); // preço vem do banco
    expect(src).not.toMatch(/teste de \d+ dias/i); // duração do teste é configurável por plano
  });
});
