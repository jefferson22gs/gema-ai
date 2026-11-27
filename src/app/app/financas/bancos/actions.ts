"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { enqueue } from "@/server/jobs/queue";
import { rateLimit } from "@/server/http";
import { revokeConnection } from "@/server/open-finance/sync";
import { bankProvider } from "@/server/runtime";
import { requireSession } from "@/server/session";

/** Sincronização manual (limitada: a Pluggy permite 20 atualizações/min e recomenda o sync diário). */
export async function syncNowAction(form: FormData) {
  const s = await requireSession();
  const id = z.string().uuid().parse(form.get("id"));
  if (!(await rateLimit(`of:manual:${s.userId}`, 4, 3600))) return;
  const [own] = await db.asUser(s.userId, (q) => q.query<{ id: string }>("select id from bank_connections where id = $1 and owner_id = $2 and revoked_at is null", [id, s.userId]));
  if (!own) return;
  const provider = bankProvider();
  const [conn] = await db.asService((q) => q.query<{ external_item_id: string }>("select external_item_id from bank_connections where id = $1", [id]));
  if (provider && conn) await provider.refreshItem(conn.external_item_id).catch(() => undefined);
  await db.asService((q) => enqueue(q, "open_finance.sync", { connectionId: id, trigger: "manual" }, { dedupeKey: `of:manual:${id}:${Math.floor(Date.now() / 300_000)}` }));
  refresh();
}

/** Revogação: exclui no provedor (revoga o consentimento Open Finance lá) e interrompe novos syncs. */
export async function revokeAction(form: FormData) {
  const s = await requireSession();
  const id = z.string().uuid().parse(form.get("id"));
  await revokeConnection(db, bankProvider(), s.userId, id);
  refresh();
}
