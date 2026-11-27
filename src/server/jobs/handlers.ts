import "server-only";
import { db } from "@/lib/db";
import type { JobHandler } from "./queue";
import { refreshRecurringCandidates } from "../services/planning";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { syncConnection } from "../open-finance/sync";
import { aiModel, bankProvider, evolutionProvider, googleGateway, metaProvider, whaileysProvider } from "../runtime";
import { enqueue } from "./queue";
import { processInboundEvent } from "../messaging/ingest";
import type { InboundMessage, MessagingProvider } from "../messaging/types";

function providerByName(name: unknown): MessagingProvider | null {
  if (name === "evolution") return evolutionProvider();
  if (name === "meta_cloud") return metaProvider();
  if (name === "baileys_whaileys") return whaileysProvider();
  return null;
}

/**
 * Registro central de handlers da fila. Cada handler recebe payload validado e roda com o
 * contexto do titular (RLS), nunca com acesso amplo, salvo jobs de sistema explícitos.
 */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  /** Mensagem de WhatsApp já verificada no webhook; processada fora do request (WA-05). */
  "whatsapp.inbound": async (payload) => {
    const provider = providerByName(payload.provider);
    if (!provider) throw new Error(`canal ${String(payload.provider)} não configurado`);
    const raw = payload.event as InboundMessage & { timestamp: string };
    await processInboundEvent({ db, provider, model: aiModel(), google: googleGateway() }, { ...raw, timestamp: new Date(raw.timestamp) });
  },
  /** Sincronização de uma conexão Open Finance (inicial, webhook, manual ou agendada). */
  "open_finance.sync": async (payload) => {
    const provider = bankProvider();
    if (!provider) throw new Error("Open Finance não configurado");
    const trigger = (["initial", "webhook", "manual", "scheduled"] as const).find((t) => t === payload.trigger) ?? "scheduled";
    const result = await syncConnection(db, provider, String(payload.connectionId), trigger);
    // Após importar transações, reanalisa recorrências do titular.
    if (result.created > 0) {
      const [conn] = await db.asService((q) => q.query<{ workspace_id: string; owner_id: string }>("select workspace_id, owner_id from bank_connections where id = $1", [payload.connectionId]));
      if (conn) {
        await db.asService((q) =>
          enqueue(q, "finance.recurring.refresh", { userId: conn.owner_id, workspaceId: conn.workspace_id }, { dedupeKey: `rec:${conn.owner_id}:${new Date().toISOString().slice(0, 10)}` }),
        );
      }
    }
  },
  /** Varredura diária: enfileira sync das conexões ativas sem atualização nas últimas 20 h. */
  "open_finance.schedule": async () => {
    const day = new Date().toISOString().slice(0, 10);
    const conns = await db.asService((q) =>
      q.query<{ id: string }>(
        `select id from bank_connections where revoked_at is null and status not in ('revoked', 'consent_expired')
           and (last_synced_at is null or last_synced_at < now() - interval '20 hours') limit 500`,
      ),
    );
    for (const c of conns) {
      await db.asService((q) => enqueue(q, "open_finance.sync", { connectionId: c.id, trigger: "scheduled" }, { dedupeKey: `of:daily:${c.id}:${day}` }));
    }
  },
  /** Reanálise de recorrências de um titular (disparada após importações). */
  "finance.recurring.refresh": async (payload) => {
    const userId = String(payload.userId ?? "");
    const workspaceId = String(payload.workspaceId ?? "");
    if (!userId || !workspaceId) throw new Error("payload inválido");
    await db.asUser(userId, (q) =>
      refreshRecurringCandidates({ q, ctx: { userId, workspaceId, timezone: String(payload.timezone ?? DEFAULT_TIMEZONE), now: new Date(), channel: "automation" } }),
    );
  },
};
