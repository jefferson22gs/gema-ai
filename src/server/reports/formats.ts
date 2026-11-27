import { crc32, deflateRawSync } from "node:zlib";

/**
 * Geradores de arquivo sem dependências externas (PDF, XLSX, CSV) para relatórios.
 * Segurança: nenhum texto vindo do usuário vira fórmula — CSV neutraliza prefixos perigosos e o XLSX grava texto como
 * inlineStr (nunca <f>), números como número.
 */

// ---------------------------------------------------------------- CSV

/** OWASP CSV injection: célula que começa com = + - @ TAB CR é prefixada com apóstrofo. */
export function safeCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    if (v === null) return "";
    if (typeof v === "number") return String(v).replace(".", ",");
    return `"${safeCell(v).replace(/"/g, '""')}"`;
  };
  return `﻿${[header.map(cell), ...rows.map((r) => r.map(cell))].map((r) => r.join(";")).join("\r\n")}`;
}

// ---------------------------------------------------------------- ZIP (store/deflate) para XLSX

function zip(files: { name: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const comp = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt32LE(0x00210000, 10); // 1980-01-01 (data fixa: arquivo determinístico)
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(comp.length, 18);
    head.writeUInt32LE(f.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    local.push(head, name, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(0x00210000, 12);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(f.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += head.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

// ---------------------------------------------------------------- XLSX

export type XlsxCell = string | number | null | { money: number };

const xmlEsc = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sheetXml(rows: XlsxCell[][]): string {
  const body = rows.map((r, ri) => {
    const cells = r.map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      if (v === null || v === "") return "";
      if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
      if (typeof v === "object") return `<c r="${ref}" s="1"><v>${(v.money / 100).toFixed(2)}</v></c>`;
      // Texto sempre inlineStr: o Excel nunca interpreta como fórmula.
      return `<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="2"' : ""}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    }).join("");
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** Planilha .xlsx com uma aba por entrada. Linha 0 de cada aba = cabeçalho (negrito). */
export function toXlsx(sheets: { name: string; rows: XlsxCell[][] }[]): Buffer {
  const names = sheets.map((s, i) => xmlEsc(s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || `Aba ${i + 1}`));
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00;-&quot;R$&quot; #,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows) })),
  ];
  return zip(files.map((f) => ({ name: f.name, data: Buffer.from(f.data, "utf8") })));
}

// ---------------------------------------------------------------- PDF (texto, Helvetica, WinAnsi)

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Colunas alinhadas: [texto, x em pt, alinhamento]. Substitui `text`. */
  cols?: [string, number, "left" | "right"][];
  gapBefore?: number;
}

/** Caracteres fora do WinAnsi viram "?" (o PDF base não embute fonte). */
function winAnsi(s: string): Buffer {
  const map: Record<string, number> = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99 };
  const bytes: number[] = [];
  for (const ch of s.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    if (map[ch] !== undefined) bytes.push(map[ch]);
    else if (c === 0x09 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) bytes.push(c === 0x09 ? 0x20 : c);
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

function pdfString(s: string): Buffer {
  const raw = winAnsi(s);
  const out: number[] = [0x28];
  for (const b of raw) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out.push(0x5c);
    out.push(b);
  }
  out.push(0x29);
  return Buffer.from(out);
}

/** Largura aproximada (Helvetica ~0,5 em por caractere) — usada só para alinhar à direita. */
const approxWidth = (s: string, size: number) => s.length * size * 0.5;

export function toPdf(title: string, lines: PdfLine[], footer: string): Buffer {
  const W = 595, H = 842, M = 48; // A4
  const pages: Buffer[][] = [[]];
  let y = H - M;
  const push = (b: Buffer | string) => pages[pages.length - 1].push(typeof b === "string" ? Buffer.from(b, "latin1") : b);
  const text = (x: number, yy: number, s: string, size: number, bold: boolean) => {
    push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td `);
    push(pdfString(s));
    push(" Tj ET\n");
  };
  for (const l of lines) {
    const size = l.size ?? 10;
    const lh = size * 1.45 + (l.gapBefore ?? 0);
    if (y - lh < M + 20) { pages.push([]); y = H - M; }
    y -= lh;
    if (l.cols) {
      for (const [t, x, align] of l.cols) text(align === "right" ? x - approxWidth(t, size) : x, y, t, size, !!l.bold);
    } else {
      text(M, y, l.text, size, !!l.bold);
    }
  }
  const objs: Buffer[] = [];
  const add = (b: Buffer | string) => objs.push(typeof b === "string" ? Buffer.from(b, "latin1") : b) ;
  // 1 catálogo, 2 páginas, 3-4 fontes, 5 info; depois pares (página, conteúdo).
  add("<< /Type /Catalog /Pages 2 0 R >>");
  const pageIds = pages.map((_, i) => 6 + i * 2);
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  add(Buffer.concat([Buffer.from("<< /Title ", "latin1"), pdfString(title), Buffer.from(" /Producer (GEMA AI) >>", "latin1")]));
  pages.forEach((content, i) => {
    const foot = Buffer.concat([
      Buffer.from(`BT /F1 8 Tf ${M} 28 Td `, "latin1"), pdfString(`${footer} · página ${i + 1} de ${pages.length}`), Buffer.from(" Tj ET\n", "latin1"),
    ]);
    const stream = Buffer.concat([...content, foot]);
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`);
    add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream", "latin1")]));
  });
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets: number[] = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), o, Buffer.from("\nendobj\n", "latin1")]);
    offsets.push(pos);
    parts.push(b);
    pos += b.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${pos}\n%%EOF\n`, "latin1"));
  return Buffer.concat(parts);
}
