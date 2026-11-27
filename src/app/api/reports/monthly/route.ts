import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { auditAsUser } from "@/server/context";
import { errorResponse, json, rateLimit } from "@/server/http";
import { REPORT_FORMATS, buildMonthlyReport, renderReport, type ReportFormat } from "@/server/reports/monthly";
import { actorContext, getSession } from "@/server/session";

/** GET /api/reports/monthly?month=AAAA-MM&format=pdf|xlsx|csv — sob RLS e permissão reports.export. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return json({ error: "Não autenticado." }, 401);
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? "";
  const format = (url.searchParams.get("format") ?? "pdf") as ReportFormat;
  if (!REPORT_FORMATS.includes(format)) return json({ error: "Formato inválido." }, 400);
  if (!(await rateLimit(`report:${s.userId}`, 30, 3600))) return json({ error: "Muitas exportações. Aguarde alguns minutos." }, 429);
  const ctx = actorContext(s);
  try {
    const report = await db.asUser(s.userId, async (q) => {
      const r = await buildMonthlyReport({ q, ctx }, month);
      await auditAsUser(q, { workspaceId: ctx.workspaceId, action: "report.exported", metadata: { month, format, rows: r.rows.length } });
      return r;
    });
    const out = renderReport(report, format, formatDateTime(ctx.now, ctx.timezone));
    return new Response(typeof out.body === "string" ? out.body : new Uint8Array(out.body), {
      headers: {
        "content-type": out.contentType,
        "content-disposition": `attachment; filename="relatorio-${month}.${out.ext}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
