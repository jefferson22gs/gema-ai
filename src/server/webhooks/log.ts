import type { Database } from "@/lib/db/types";

/**
 * Registra todo webhook recebido (inclusive rejeitados). Para assinaturas válidas, o índice único
 * (provider, provider_event_id) garante proteção contra replay: retorna duplicate=true na repetição.
 * Payload de webhooks rejeitados NÃO é armazenado (minimização).
 */
export async function logWebhook(
  db: Database,
  e: { provider: string; providerEventId: string | null; signatureValid: boolean; status: "received" | "rejected" | "ignored"; reason?: string; payload?: unknown },
): Promise<{ id: number | null; duplicate: boolean }> {
  return db.asService(async (q) => {
    if (e.signatureValid && e.providerEventId) {
      const rows = await q.query<{ id: number }>(
        `insert into provider_webhook_events (provider, provider_event_id, signature_valid, status, reason, payload)
         values ($1, $2, true, $3, $4, $5)
         on conflict (provider, provider_event_id) where provider_event_id is not null and signature_valid do nothing
         returning id`,
        [e.provider, e.providerEventId, e.status, e.reason ?? null, JSON.stringify(e.payload ?? null)],
      );
      return { id: rows[0]?.id ?? null, duplicate: rows.length === 0 };
    }
    const rows = await q.query<{ id: number }>(
      `insert into provider_webhook_events (provider, provider_event_id, signature_valid, status, reason, payload)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [e.provider, e.providerEventId, e.signatureValid, e.status, e.reason ?? null, e.signatureValid ? JSON.stringify(e.payload ?? null) : null],
    );
    return { id: rows[0].id, duplicate: false };
  });
}

export async function markWebhook(db: Database, id: number | null, status: "processed" | "ignored" | "failed", reason?: string) {
  if (!id) return;
  await db.asService((q) =>
    q.query("update provider_webhook_events set status = $2, reason = coalesce($3, reason), processed_at = now() where id = $1", [id, status, reason ?? null]),
  );
}
