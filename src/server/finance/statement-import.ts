import { createHash } from "node:crypto";
import { merchantKey } from "./engine";

/**
 * Leitura de extratos OFX (1.x SGML e 2.x XML) e CSV de bancos brasileiros — sem I/O.
 * Cada linha recebe um id externo ESTÁVEL para que reimportar o mesmo arquivo (ou um período sobreposto)
 * nunca duplique lançamentos: OFX usa o FITID do banco; CSV usa o identificador da linha, se houver, ou um
 * hash de data|descrição|valor|n-ésima ocorrência (duas compras iguais no mesmo dia continuam sendo duas).
 */

export const MAX_IMPORT_BYTES = 900_000;
export const MAX_IMPORT_ROWS = 5000;

export interface StatementRow {
  date: string;
  description: string;
  amountCents: number;
  kind: "expense" | "income";
  externalId: string;
}

export interface ParsedStatement {
  format: "ofx" | "csv";
  /** Origem para dedupe (`transactions.external_source`): conta do OFX ou "csv". */
  source: string;
  rows: StatementRow[];
  /** Linhas ignoradas com motivo (data/valor ilegível, valor zero). */
  skipped: { line: number; reason: string }[];
}

export class StatementError extends Error {}

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** "1.234,56" | "-85,90" | "1234.56" | "R$ 40" | "(12,00)" → centavos com sinal. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/R\$\s?/i, "").replace(/\s/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { negative = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { negative = !negative; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;
  // Último separador decide: vírgula ⇒ padrão BR (1.234,56); ponto ⇒ decimal (1234.56 / 1,234.56),
  // exceto "1.234" / "1.234.567" (só milhares, formato BR sem centavos).
  const normalized = s.lastIndexOf(",") > s.lastIndexOf(".")
    ? s.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s.replace(/,/g, "");
  const v = Number(normalized);
  if (!Number.isFinite(v)) return null;
  const cents = Math.round(v * 100);
  return negative ? -cents : cents;
}

/** dd/mm/aaaa, dd/mm/aa, dd-mm-aaaa, aaaa-mm-dd, aaaammdd → "aaaa-mm-dd" válido ou null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let r: RegExpMatchArray | null;
  if ((r = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = s.match(/^(\d{4})(\d{2})(\d{2})/))) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/))) [d, m, y] = [+r[1], +r[2], r[3].length === 2 ? 2000 + +r[3] : +r[3]];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function toRow(date: string, description: string, signed: number, externalId: string): StatementRow {
  return { date, description: clean(description) || "Lançamento importado", amountCents: Math.abs(signed), kind: signed < 0 ? "expense" : "income", externalId };
}

// ---------------------------------------------------------------- OFX

function tag(block: string, name: string): string | null {
  // SGML (sem fechamento) e XML (com fechamento): pega o texto até o próximo "<".
  const r = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
  return r ? r[1].trim() : null;
}

export function parseOfx(text: string): ParsedStatement {
  if (!/<OFX>/i.test(text)) throw new StatementError("Arquivo OFX inválido (sem <OFX>).");
  const acct = tag(text, "ACCTID") ?? "conta";
  const bank = tag(text, "BANKID") ?? tag(text, "ORG") ?? "banco";
  const source = `ofx:${hash(`${bank}|${acct}`).slice(0, 16)}`;
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);
  const rows: StatementRow[] = [];
  const skipped: ParsedStatement["skipped"] = [];
  const seen = new Map<string, number>();
  blocks.forEach((b, i) => {
    const date = parseDate(tag(b, "DTPOSTED") ?? "");
    const amount = parseAmount(tag(b, "TRNAMT") ?? "");
    if (!date || amount === null) return skipped.push({ line: i + 1, reason: "data ou valor ilegível" });
    if (amount === 0) return skipped.push({ line: i + 1, reason: "valor zero" });
    const desc = [tag(b, "NAME"), tag(b, "MEMO")].filter((v): v is string => !!v && v.length > 0);
    const uniqueDesc = desc.filter((v, k) => desc.indexOf(v) === k).join(" · ");
    const base = tag(b, "FITID") || hash(`${date}|${uniqueDesc}|${amount}`);
    const n = (seen.get(base) ?? 0) + 1; // FITID repetido no mesmo arquivo (acontece em alguns bancos)
    seen.set(base, n);
    rows.push(toRow(date, uniqueDesc, amount, n > 1 ? `${base}#${n}` : base));
  });
  return { format: "ofx", source, rows, skipped };
}

// ---------------------------------------------------------------- CSV

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

const COLS = {
  date: ["data", "date", "dt", "data lancamento", "data da transacao", "data movimento", "data do lancamento"],
  description: ["descricao", "historico", "lancamento", "description", "estabelecimento", "title", "titulo", "memo", "detalhes"],
  amount: ["valor", "amount", "valor r", "quantia", "valor rs"],
  debit: ["debito", "saida", "saidas", "debit"],
  credit: ["credito", "entrada", "entradas", "credit"],
  id: ["identificador", "id", "fitid", "documento", "n documento"],
};

function findCol(header: string[], names: string[]): number {
  const h = header.map(norm);
  for (const n of names) {
    const i = h.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * `positiveIs`: extrato de conta usa positivo = entrada; muitas faturas de cartão exportam compras como positivas.
 */
export function parseCsv(text: string, positiveIs: "income" | "expense" = "income"): ParsedStatement {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new StatementError("CSV vazio ou sem cabeçalho.");
  const first = lines[0];
  const sep = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : (first.includes("\t") ? "\t" : ",");
  const header = splitCsvLine(first, sep);
  const c = {
    date: findCol(header, COLS.date),
    description: findCol(header, COLS.description),
    amount: findCol(header, COLS.amount),
    debit: findCol(header, COLS.debit),
    credit: findCol(header, COLS.credit),
    id: findCol(header, COLS.id),
  };
  if (c.date < 0 || (c.amount < 0 && c.debit < 0 && c.credit < 0)) {
    throw new StatementError("Não encontrei as colunas de data e valor. Cabeçalhos aceitos: Data; Descrição/Histórico; Valor (ou Débito/Crédito).");
  }
  const rows: StatementRow[] = [];
  const skipped: ParsedStatement["skipped"] = [];
  const seen = new Map<string, number>();
  lines.slice(1).forEach((line, i) => {
    const cells = splitCsvLine(line, sep);
    const date = parseDate(cells[c.date] ?? "");
    let signed: number | null;
    if (c.amount >= 0) {
      const v = parseAmount(cells[c.amount] ?? "");
      signed = v === null ? null : positiveIs === "income" ? v : -v;
    } else {
      const d = parseAmount(cells[c.debit] ?? "") ?? 0;
      const cr = parseAmount(cells[c.credit] ?? "") ?? 0;
      signed = !cells[c.debit] && !cells[c.credit] ? null : Math.abs(cr) - Math.abs(d);
    }
    if (!date || signed === null) return skipped.push({ line: i + 2, reason: "data ou valor ilegível" });
    if (signed === 0) return skipped.push({ line: i + 2, reason: "valor zero" });
    const description = c.description >= 0 ? cells[c.description] ?? "" : "";
    const own = c.id >= 0 ? cells[c.id]?.trim() : "";
    const base = own || hash(`${date}|${norm(description)}|${signed}`);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows.push(toRow(date, description, signed, n > 1 ? `${base}#${n}` : base));
  });
  return { format: "csv", source: "csv", rows, skipped };
}

export function parseStatement(fileName: string, text: string, positiveIs: "income" | "expense" = "income"): ParsedStatement {
  if (text.length > MAX_IMPORT_BYTES) throw new StatementError("Arquivo muito grande (máximo ~900 KB). Exporte um período menor.");
  const parsed = /\.ofx$/i.test(fileName) || /<OFX>/i.test(text.slice(0, 4000)) ? parseOfx(text) : parseCsv(text, positiveIs);
  if (parsed.rows.length > MAX_IMPORT_ROWS) throw new StatementError(`Arquivo com mais de ${MAX_IMPORT_ROWS} lançamentos. Exporte um período menor.`);
  if (!parsed.rows.length) throw new StatementError("Nenhum lançamento válido encontrado no arquivo.");
  return parsed;
}

// ---------------------------------------------------------------- Categorização por regras (FIN-10)

export interface CategoryRule {
  pattern: string;
  categoryId: string;
  kind?: "expense" | "income" | null;
}

/** Regra mais específica (padrão mais longo) contida na chave do estabelecimento vence. */
export function categorize(description: string, kind: "expense" | "income", rules: CategoryRule[]): string | null {
  const key = ` ${norm(description)} `;
  let best: CategoryRule | null = null;
  for (const r of rules) {
    if (r.kind && r.kind !== kind) continue;
    const p = norm(r.pattern);
    if (p.length < 2 || !key.includes(` ${p} `)) continue;
    if (!best || p.length > norm(best.pattern).length) best = r;
  }
  return best?.categoryId ?? null;
}

/** Padrão aprendido a partir de uma correção: chave do estabelecimento ("NETFLIX.COM 123" ⇒ "netflix com"). */
export function learnedPattern(description: string): string | null {
  const k = merchantKey(description);
  return k.length >= 2 ? k : null;
}
