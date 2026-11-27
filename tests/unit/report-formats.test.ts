import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { safeCell, toCsv, toPdf, toXlsx } from "@/server/reports/formats";
import { transactionsToCsv, type TransactionRow } from "@/server/services/finance";

/** Leitor mínimo de ZIP (central directory) para inspecionar o XLSX gerado. */
function unzip(buf: Buffer): Record<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const lnlen = buf.readUInt16LE(off + 26);
    const lelen = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnlen + lelen, off + 30 + lnlen + lelen + csize);
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    p += 46 + nlen + elen + clen;
  }
  return out;
}

const EVIL = ['=HYPERLINK("http://x","clique")', "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1"];

describe("CSV injection", () => {
  it.each(EVIL)("neutraliza %j", (v) => {
    expect(safeCell(v).startsWith("'")).toBe(true);
  });

  it("texto normal e números negativos (como número) não são alterados", () => {
    expect(safeCell("Mercado")).toBe("Mercado");
    expect(toCsv(["v"], [[-12.5]])).toBe("\uFEFF\"v\"\r\n-12,5");
  });

  it("export de lançamentos neutraliza descrição e categoria vindas de banco/IA", () => {
    const row = { occurred_on: "2026-11-03", kind: "expense", description: '=cmd|"/c calc"!A0', category_name: "@x", amount_cents: 1050, status: "paid", due_on: null } as unknown as TransactionRow;
    const csv = transactionsToCsv([row]);
    expect(csv).toContain(`"'=cmd|""/c calc""!A0"`);
    expect(csv).toContain(`"'@x"`);
    expect(csv).toContain("10,5");
  });
});

describe("XLSX", () => {
  const book = toXlsx([
    { name: "Resumo", rows: [["Indicador", "Valor"], ["Receitas", { money: 980000 }], ["Linhas", 3]] },
    { name: "Lança/mentos:[x]", rows: [["Descrição"], ...EVIL.map((e) => [e]), ["A & B <c>"]] },
  ]);
  const files = unzip(book);

  it("pacote OOXML completo e abas com nomes saneados", () => {
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]));
    expect(files["xl/workbook.xml"]).toContain('name="Lança mentos  x "');
  });

  it("textos viram inlineStr escapado, nunca fórmula; dinheiro vira número formatado", () => {
    const s2 = files["xl/worksheets/sheet2.xml"];
    expect(s2).not.toMatch(/<f[ >]/);
    expect(s2).toContain("=HYPERLINK(&quot;http://x&quot;,&quot;clique&quot;)");
    expect(s2).toContain("A &amp; B &lt;c&gt;");
    expect(s2.match(/t="inlineStr"/g)).toHaveLength(EVIL.length + 2);
    const s1 = files["xl/worksheets/sheet1.xml"];
    expect(s1).toContain('<c r="B2" s="1"><v>9800.00</v></c>');
    expect(s1).toContain('<c r="B3"><v>3</v></c>');
  });

  it("é determinístico", () => {
    expect(toXlsx([{ name: "A", rows: [["x"]] }]).equals(toXlsx([{ name: "A", rows: [["x"]] }]))).toBe(true);
  });
});

describe("PDF", () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ text: `Linha ${i} – Café (ação) \\ ok 😀` }));
  const pdf = toPdf("Relatório 2026-11", [{ text: "Título", size: 16, bold: true }, ...many, { text: "", cols: [["Total", 48, "left"], ["R$ 1.234,56", 547, "right"]] }], "GEMA AI");
  const txt = pdf.toString("latin1");

  it("estrutura válida: cabeçalho, xref com offsets corretos, trailer e EOF", () => {
    expect(txt.startsWith("%PDF-1.4")).toBe(true);
    expect(txt.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(txt.match(/startxref\n(\d+)/)![1]);
    expect(txt.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...txt.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(txt.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  it("pagina automaticamente e numera páginas", () => {
    const count = Number(txt.match(/\/Count (\d+)/)![1]);
    expect(count).toBeGreaterThan(1);
    expect(txt).toContain(`página ${count} de ${count}`);
  });

  it("acentos em WinAnsi, parênteses e barra escapados, emoji substituído", () => {
    expect(txt).toContain("Caf\xe9 \\(a\xe7\xe3o\\) \\\\ ok ?");
    expect(txt).toContain("\x96"); // travessão "–" no WinAnsi
  });
});
