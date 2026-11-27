import "server-only";
import { db } from "@/lib/db";
import type { JobHandler } from "./queue";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { refreshRecurringCandidates } from "../services/planning";
import { takeSnapshot } from "../services/patrimony";
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
  /**
   * Fotografia mensal do patrimônio (dia 1): uma por titular e workspace, só para quem já registrou bens,
   * dívidas ou fotografias (não cria série vazia para quem não usa o módulo).
   */
  "patrimony.snapshot": async () => {
    const owners = await db.asService((q) =>
      q.query<{ owner_id: string; workspace_id: string; timezone: string | null }>(
        `select distinct x.owner_id, x.workspace_id, p.timezone from (
           select owner_id, workspace_id from assets where archived_at is null
           union select owner_id, workspace_id from debts where status = 'active'
           union select owner_id, workspace_id from net_worth_snapshots
         ) x join workspace_members m on m.workspace_id = x.workspace_id and m.user_id = x.owner_id
         left join profiles p on p.id = x.owner_id limit 5000`,
      ),
    );
    for (const o of owners) {
      await db.asUser(o.owner_id, (q) =>
        takeSnapshot({ q, ctx: { userId: o.owner_id, workspaceId: o.workspace_id, timezone: o.timezone || DEFAULT_TIMEZONE, now: new Date(), channel: "automation" } }),
      );
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
