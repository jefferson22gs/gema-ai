/** Valores monetários sempre em centavos inteiros (sem ponto flutuante na persistência). */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatCents(cents: number, currency = "BRL"): string {
  if (currency === "BRL") return brl.format(cents / 100);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

/**
 * Converte valor informado (número em reais ou texto pt-BR: "85", "85,90", "1.234,56", "R$ 40")
 * em centavos inteiros. Retorna null para entradas inválidas ou não positivas.
 */
export function toCents(input: number | string): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input <= 0) return null;
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/R\$\s?/i, "").replace(/\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(cleaned)) return null;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}
