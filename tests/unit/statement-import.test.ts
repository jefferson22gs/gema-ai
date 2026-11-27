import { describe, expect, it } from "vitest";
import { StatementError, categorize, learnedPattern, parseAmount, parseCsv, parseDate, parseOfx, parseStatement } from "@/server/finance/statement-import";

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0341<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261103120000[-3:BRT]<TRNAMT>-85.90<FITID>A1<MEMO>PIX ENVIADO RESTAURANTE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261105<TRNAMT>9800.00<FITID>A2<NAME>SALARIO EMPRESA X</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261106<TRNAMT>-39.90<FITID>A3<NAME>NETFLIX.COM<MEMO>NETFLIX.COM</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261106<TRNAMT>0.00<FITID>A4<MEMO>TARIFA ZERADA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>2026XX06<TRNAMT>-1<FITID>A5</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const OFX_XML = `<?xml version="1.0"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>260</BANKID><ACCTID>999</ACCTID></BANKACCTFROM>
<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261110</DTPOSTED><TRNAMT>-12.50</TRNAMT><FITID>X1</FITID><MEMO>Padaria</MEMO></STMTTRN></BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("valores e datas", () => {
  it.each([
    ["1.234,56", 123456], ["-85,90", -8590], ["85.90", 8590], ["R$ 40", 4000], ["(12,00)", -1200], ["1,234.56", 123456],
    ["1.234", 123400], ["12,5", 1250], ["50-", -5000], ["abc", null], ["", null],
  ])("parseAmount(%s) = %s", (raw, cents) => expect(parseAmount(raw)).toBe(cents));

  it.each([
    ["03/11/2026", "2026-11-03"], ["3/11/26", "2026-11-03"], ["2026-11-03", "2026-11-03"], ["20261103120000[-3:BRT]", "2026-11-03"],
    ["31/02/2026", null], ["13/13/2026", null], ["ontem", null],
  ])("parseDate(%s) = %s", (raw, iso) => expect(parseDate(raw)).toBe(iso));
});

describe("OFX", () => {
  it("SGML: tipos pelo sinal, FITID como id, ignora valor zero e linha ilegível, sem MEMO repetido", () => {
    const p = parseOfx(OFX_SGML);
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]).toEqual({ date: "2026-11-03", description: "PIX ENVIADO RESTAURANTE", amountCents: 8590, kind: "expense", externalId: "A1" });
    expect(p.rows[1]).toMatchObject({ kind: "income", amountCents: 980000, description: "SALARIO EMPRESA X" });
    expect(p.rows[2].description).toBe("NETFLIX.COM");
    expect(p.skipped.map((s) => s.reason)).toEqual(["valor zero", "data ou valor ilegível"]);
    expect(p.source).toMatch(/^ofx:[0-9a-f]{16}$/);
  });

  it("XML 2.x e origem distinta por conta (não deduplica entre contas diferentes)", () => {
    const p = parseOfx(OFX_XML);
    expect(p.rows).toEqual([{ date: "2026-11-10", description: "Padaria", amountCents: 1250, kind: "expense", externalId: "X1" }]);
    expect(p.source).not.toBe(parseOfx(OFX_SGML).source);
  });

  it("arquivo sem <OFX> é recusado", () => {
    expect(() => parseOfx("qualquer coisa")).toThrow(StatementError);
  });
});

describe("CSV", () => {
  it("ponto e vírgula, BOM, aspas e cabeçalho com acento", () => {
    const csv = '﻿Data;Histórico;Valor\n03/11/2026;"PADARIA ""PÃO BOM""";-12,50\n05/11/2026;Salário;9.800,00\n';
    const p = parseCsv(csv);
    expect(p.rows.map((r) => [r.date, r.description, r.kind, r.amountCents])).toEqual([
      ["2026-11-03", 'PADARIA "PÃO BOM"', "expense", 1250],
      ["2026-11-05", "Salário", "income", 980000],
    ]);
  });

  it("colunas Débito/Crédito e fatura com compras positivas", () => {
    const dc = parseCsv("Data,Descrição,Débito,Crédito\n2026-11-03,Mercado,150.00,\n2026-11-04,Estorno,,20.00\n");
    expect(dc.rows.map((r) => [r.kind, r.amountCents])).toEqual([["expense", 15000], ["income", 2000]]);
    const fatura = parseCsv("date,title,amount\n2026-11-03,Uber,23.40\n", "expense");
    expect(fatura.rows[0]).toMatchObject({ kind: "expense", amountCents: 2340 });
  });

  it("id estável: mesmo arquivo gera os mesmos ids; compras idênticas no mesmo dia continuam distintas", () => {
    const csv = "Data;Descrição;Valor\n03/11/2026;Café;-5,00\n03/11/2026;Café;-5,00\n";
    const a = parseCsv(csv).rows.map((r) => r.externalId);
    const b = parseCsv(csv).rows.map((r) => r.externalId);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(2);
  });

  it("sem colunas reconhecíveis ou vazio dá erro claro; linhas ruins ficam listadas", () => {
    expect(() => parseCsv("foo;bar\n1;2")).toThrow(/colunas de data e valor/);
    expect(() => parseCsv("Data;Valor")).toThrow(/vazio/);
    const p = parseCsv("Data;Valor\nxx;1,00\n01/11/2026;10,00\n");
    expect(p.skipped).toEqual([{ line: 2, reason: "data ou valor ilegível" }]);
  });

  it("parseStatement detecta formato, limita tamanho e exige ao menos um lançamento", () => {
    expect(parseStatement("extrato.ofx", OFX_XML).format).toBe("ofx");
    expect(parseStatement("extrato.txt", OFX_XML).format).toBe("ofx");
    expect(parseStatement("extrato.csv", "Data;Valor\n01/11/2026;10,00").format).toBe("csv");
    expect(() => parseStatement("a.csv", "x".repeat(1_000_000))).toThrow(/muito grande/);
    expect(() => parseStatement("a.csv", "Data;Valor\nxx;yy")).toThrow(/Nenhum lançamento/);
  });
});

describe("categorização por regras (FIN-10)", () => {
  const rules = [
    { pattern: "netflix", categoryId: "streaming", kind: "expense" as const },
    { pattern: "uber", categoryId: "transporte", kind: "expense" as const },
    { pattern: "uber eats", categoryId: "alimentacao", kind: "expense" as const },
    { pattern: "empresa x", categoryId: "salario", kind: "income" as const },
  ];
  it("palavra inteira, regra mais específica vence e tipo precisa bater", () => {
    expect(categorize("NETFLIX.COM 123", "expense", rules)).toBe("streaming");
    expect(categorize("UBER *EATS PENDING", "expense", rules)).toBe("alimentacao");
    expect(categorize("UBER TRIP", "expense", rules)).toBe("transporte");
    expect(categorize("SUPERUBERX", "expense", rules)).toBeNull();
    expect(categorize("SALARIO EMPRESA X", "income", rules)).toBe("salario");
    expect(categorize("PIX EMPRESA X", "expense", rules)).toBeNull();
  });
  it("padrão aprendido usa a chave do estabelecimento", () => {
    expect(learnedPattern("NETFLIX.COM 123")).toBe("netflix com");
    expect(learnedPattern("12345")).toBeNull();
  });
});
