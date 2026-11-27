import { formatCents } from "@/lib/money";
import { DomainError, type ServiceDeps } from "../context";
import { toCsv, toPdf, toXlsx, type PdfLine, type XlsxCell } from "./formats";

export const REPORT_FORMATS = ["pdf", "xlsx", "csv"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
export const MAX_REPORT_ROWS = 5000;

const KIND: Record<string, string> = { expense: "Despesa", income: "Receita", refund: "Reembolso", transfer: "Transferência", card_payment: "Pagamento de fatura" };
const STATUS: Record<string, string> = { paid: "Pago", pending: "Pendente", projected: "Projetado", reconciled: "Conciliado", cancelled: "Cancelado", reversed: "Estornado" };

export interface MonthlyReport {
  workspace: string;
  month: string;
  incomeCents: number;
  expenseCents: number;
  refundCents: number;
  resultCents: number;
  byCategory: { category: string; cents: number }[];
  rows: { date: string; kind: string; description: string; category: string; status: string; amountCents: number; signedCents: number }[];
  truncated: boolean;
}

function range(month: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new DomainError("invalid", "Mês inválido (use AAAA-MM).");
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start: `${month}-01`, end: `${next}-01` };
}

/**
 * Relatório mensal pelas mesmas regras do resumo do painel: entram pagos, conciliados e pendentes; projetados,
 * cancelados e estornados aparecem na lista, mas não somam; transferências e pagamentos de fatura não são despesa.
 */
export async function buildMonthlyReport({ q, ctx }: ServiceDeps, month: string): Promise<MonthlyReport> {
  const { start, end } = range(month);
  const [{ allowed }] = await q.query<{ allowed: boolean }>("select app.can($1, 'reports', 'export') as allowed", [ctx.workspaceId]);
  if (!allowed) throw new DomainError("forbidden", "Seu papel neste workspace não permite exportar relatórios.");
  const [ws] = await q.query<{ name: string }>("select name from workspaces where id = $1", [ctx.workspaceId]);
  const raw = await q.query<{ occurred_on: string; kind: string; description: string; category: string | null; status: string; amount_cents: number }>(
    `select to_char(t.occurred_on, 'YYYY-MM-DD') as occurred_on, t.kind, t.description, c.name as category, t.status, t.amount_cents
     from transactions t left join categories c on c.id = t.category_id
     where t.workspace_id = $1 and t.deleted_at is null and t.occurred_on >= $2 and t.occurred_on < $3
     order by t.occurred_on, t.created_at limit $4`,
    [ctx.workspaceId, start, end, MAX_REPORT_ROWS + 1],
  );
  const truncated = raw.length > MAX_REPORT_ROWS;
  const counts = (s: string) => s === "paid" || s === "reconciled" || s === "pending";
  let income = 0, expense = 0, refund = 0;
  const cat = new Map<string, number>();
  const rows = raw.slice(0, MAX_REPORT_ROWS).map((r) => {
    const amount = Number(r.amount_cents);
    const signed = !counts(r.status) ? 0 : r.kind === "income" || r.kind === "refund" ? amount : r.kind === "expense" ? -amount : 0;
    if (counts(r.status)) {
      if (r.kind === "income") income += amount;
      else if (r.kind === "expense") { expense += amount; cat.set(r.category ?? "Sem categoria", (cat.get(r.category ?? "Sem categoria") ?? 0) + amount); }
      else if (r.kind === "refund") refund += amount;
    }
    return { date: r.occurred_on, kind: KIND[r.kind] ?? r.kind, description: r.description, category: r.category ?? "", status: STATUS[r.status] ?? r.status, amountCents: amount, signedCents: signed };
  });
  return {
    workspace: ws?.name ?? "",
    month,
    incomeCents: income,
    expenseCents: expense - refund,
    refundCents: refund,
    resultCents: income - (expense - refund),
    byCategory: [...cat].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents),
    rows,
    truncated,
  };
}

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function renderReport(r: MonthlyReport, format: ReportFormat, generatedAt: string): { body: Buffer | string; contentType: string; ext: string } {
  if (format === "csv") {
    return {
      body: toCsv(["data", "tipo", "descrição", "categoria", "status", "valor"], r.rows.map((x) => [x.date, x.kind, x.description, x.category, x.status, x.amountCents / 100])),
      contentType: "text/csv; charset=utf-8",
      ext: "csv",
    };
  }
  if (format === "xlsx") {
    const resumo: XlsxCell[][] = [
      ["Indicador", "Valor"],
      ["Receitas", { money: r.incomeCents }],
      ["Despesas (líquidas de reembolsos)", { money: r.expenseCents }],
      ["Reembolsos", { money: r.refundCents }],
      ["Resultado", { money: r.resultCents }],
      [],
      ["Categoria", "Despesas"],
      ...r.byCategory.map((c): XlsxCell[] => [c.category, { money: c.cents }]),
    ];
    const lanc: XlsxCell[][] = [
      ["Data", "Tipo", "Descrição", "Categoria", "Status", "Valor", "Efeito no resultado"],
      ...r.rows.map((x): XlsxCell[] => [br(x.date), x.kind, x.description, x.category, x.status, { money: x.amountCents }, { money: x.signedCents }]),
    ];
    return { body: toXlsx([{ name: "Resumo", rows: resumo }, { name: "Lançamentos", rows: lanc }]), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
  }
  const L = 48, R = 547;
  const lines: PdfLine[] = [
    { text: "GEMA AI · Relatório financeiro", size: 9 },
    { text: `${r.workspace} — ${monthLabel(r.month)}`, size: 16, bold: true, gapBefore: 4 },
    { text: `Gerado em ${generatedAt}. Valores calculados a partir dos lançamentos registrados; não é documento contábil ou fiscal.`, size: 8 },
    { text: "Resumo", size: 12, bold: true, gapBefore: 10 },
    ...([["Receitas", r.incomeCents], ["Despesas (líquidas de reembolsos)", r.expenseCents], ["Reembolsos", r.refundCents], ["Resultado", r.resultCents]] as const)
      .map(([k, v], i): PdfLine => ({ text: "", bold: i === 3, cols: [[k, L, "left"], [formatCents(v), R, "right"]] })),
    { text: "Despesas por categoria", size: 12, bold: true, gapBefore: 10 },
    ...(r.byCategory.length ? r.byCategory.map((c): PdfLine => ({ text: "", cols: [[c.category, L, "left"], [formatCents(c.cents), R, "right"]] })) : [{ text: "Sem despesas no período." }]),
    { text: "Lançamentos", size: 12, bold: true, gapBefore: 10 },
    { text: "", size: 8, bold: true, cols: [["Data", L, "left"], ["Descrição", L + 52, "left"], ["Categoria", L + 290, "left"], ["Status", L + 390, "left"], ["Valor", R, "right"]] },
    ...r.rows.map((x): PdfLine => ({
      text: "",
      size: 8,
      cols: [[br(x.date), L, "left"], [x.description.slice(0, 48), L + 52, "left"], [x.category.slice(0, 18), L + 290, "left"], [x.status, L + 390, "left"],
        [`${x.signedCents < 0 ? "-" : ""}${formatCents(x.amountCents)}`, R, "right"]],
    })),
  ];
  if (!r.rows.length) lines.push({ text: "Nenhum lançamento no período.", size: 9 });
  if (r.truncated) lines.push({ text: `Lista limitada a ${MAX_REPORT_ROWS} lançamentos; use a exportação XLSX por períodos menores.`, size: 8, gapBefore: 6 });
  return { body: toPdf(`Relatório ${r.month}`, lines, `GEMA AI · ${r.workspace} · ${r.month}`), contentType: "application/pdf", ext: "pdf" };
}
