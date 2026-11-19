import { db } from "@/lib/db";
import { auditAsUser } from "@/server/context";
import { json } from "@/server/http";
import { listTransactions, transactionsToCsv } from "@/server/services/finance";
import { actorContext, getSession } from "@/server/session";

export async function GET() {
  const s = await getSession();
  if (!s) return json({ error: "Não autenticado." }, 401);
  const ctx = actorContext(s);
  const csv = await db.asUser(s.userId, async (q) => {
    const rows = await listTransactions({ q, ctx }, { limit: 500 });
    await auditAsUser(q, { workspaceId: ctx.workspaceId, action: "transactions.exported", metadata: { rows: rows.length } });
    return transactionsToCsv(rows);
  });
  return new Response(`﻿${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lancamentos-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
