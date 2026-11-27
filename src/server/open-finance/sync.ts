import type { Database, Queryable } from "@/lib/db/types";
import { localDateString } from "@/lib/time";
import { BankProviderError, type BankProvider, type ProviderAccount, type ProviderItem } from "./types";

/**
 * Sincronização Open Finance → modelo interno (somente leitura):
 * - conexão/contas/saldos gravados com service role, SEMPRE no workspace/titular da conexão;
 * - transações importadas viram `transactions` com dedupe por (workspace, external_source, external_id) —
 *   reimportação atualiza (pendente → postado), nunca duplica;
 * - conexão revogada ou com consentimento expirado não sincroniza;
 * - cada sync gera log (`bank_sync_logs`).
 */
export interface ConnectionRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  provider: string;
  external_item_id: string;
  status: string;
  revoked_at: Date | null;
}

const SOURCE = (provider: string) => `open_finance:${provider}`;
const HISTORY_DAYS = 365;

export async function upsertConnection(
  db: Database,
  input: { workspaceId: string; ownerId: string; provider: string; item: ProviderItem },
): Promise<ConnectionRow> {
  const it = input.item;
  return db.asService(async (q) => {
    const [row] = await q.query<ConnectionRow>(
      `insert into bank_connections (workspace_id, owner_id, provider, external_item_id, institution_name, institution_logo_url, is_open_finance, is_sandbox,
         status, provider_status, provider_execution_status, status_detail, consent_expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (provider, external_item_id) do update set
         institution_name = excluded.institution_name, institution_logo_url = excluded.institution_logo_url,
         status = case when bank_connections.revoked_at is null then excluded.status else bank_connections.status end,
         provider_status = excluded.provider_status, provider_execution_status = excluded.provider_execution_status,
         status_detail = excluded.status_detail, consent_expires_at = excluded.consent_expires_at
       where bank_connections.workspace_id = excluded.workspace_id and bank_connections.owner_id = excluded.owner_id
       returning id, workspace_id, owner_id, provider, external_item_id, status, revoked_at`,
      [input.workspaceId, input.ownerId, input.provider, it.id, it.institution.name, it.institution.imageUrl, it.institution.isOpenFinance,
        it.institution.isSandbox, it.status, it.providerStatus, it.providerExecutionStatus, it.statusDetail, it.consentExpiresAt],
    );
    // Item de outro titular nunca é reatribuído (o where do upsert impede); não retorna linha.
    if (!row) throw new BankProviderError("Esta conexão bancária pertence a outro usuário.", 409);
    return row;
  });
}

async function upsertAccount(q: Queryable, conn: ConnectionRow, a: ProviderAccount, capturedAt: Date): Promise<{ id: string; kind: string; credit_card_id: string | null; financial_account_id: string | null }> {
  const [row] = await q.query<{ id: string; kind: string; credit_card_id: string | null; financial_account_id: string | null }>(
    `insert into bank_accounts (connection_id, workspace_id, owner_id, external_account_id, kind, subtype, name, number_masked, currency,
       balance_cents, balance_at, credit_limit_cents, credit_available_cents)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (connection_id, external_account_id) do update set
       name = excluded.name, subtype = excluded.subtype, number_masked = excluded.number_masked, balance_cents = excluded.balance_cents,
       balance_at = excluded.balance_at, credit_limit_cents = excluded.credit_limit_cents, credit_available_cents = excluded.credit_available_cents
     returning id, kind, credit_card_id, financial_account_id`,
    [conn.id, conn.workspace_id, conn.owner_id, a.id, a.kind, a.subtype, a.name, a.numberMasked, a.currency, a.balanceCents, capturedAt,
      a.creditLimitCents, a.creditAvailableCents],
  );
  if (a.balanceCents !== null) {
    await q.query(
      `insert into balance_snapshots (bank_account_id, workspace_id, owner_id, balance_cents, captured_at) values ($1, $2, $3, $4, $5)
       on conflict (bank_account_id, captured_at) do nothing`,
      [row.id, conn.workspace_id, conn.owner_id, a.balanceCents, capturedAt],
    );
  }
  // Vínculo com o modelo interno: conta corrente → financial_account; cartão → credit_card.
  if (a.kind === "bank" && !row.financial_account_id) {
    const [fa] = await q.query<{ id: string }>(
      `insert into financial_accounts (workspace_id, owner_id, name, kind, opening_balance_cents) values ($1, $2, $3, 'checking', 0) returning id`,
      [conn.workspace_id, conn.owner_id, a.name],
    );
    await q.query("update bank_accounts set financial_account_id = $2 where id = $1", [row.id, fa.id]);
    row.financial_account_id = fa.id;
  }
  if (a.kind === "credit" && !row.credit_card_id) {
    const closingDay = a.closingDate ? Number(a.closingDate.slice(8, 10)) : 1;
    const dueDay = a.dueDate ? Number(a.dueDate.slice(8, 10)) : 10;
    const [cc] = await q.query<{ id: string }>(
      `insert into credit_cards (workspace_id, owner_id, name, limit_cents, closing_day, due_day, source, external_id, last4)
       values ($1, $2, $3, $4, $5, $6, 'open_finance', $7, $8) returning id`,
      [conn.workspace_id, conn.owner_id, a.name, a.creditLimitCents ?? 0, closingDay, dueDay, a.id, a.numberMasked?.match(/(\d{4})$/)?.[1] ?? null],
    );
    await q.query("update bank_accounts set credit_card_id = $2 where id = $1", [row.id, cc.id]);
    row.credit_card_id = cc.id;
  }
  return row;
}

export interface SyncResult {
  status: "succeeded" | "partial" | "failed" | "skipped";
  accounts: number;
  created: number;
  updated: number;
  error?: string;
}

export async function syncConnection(
  db: Database,
  provider: BankProvider,
  connectionId: string,
  trigger: "initial" | "webhook" | "manual" | "scheduled",
  now = new Date(),
): Promise<SyncResult> {
  const [conn] = await db.asService((q) =>
    q.query<ConnectionRow>("select id, workspace_id, owner_id, provider, external_item_id, status, revoked_at from bank_connections where id = $1", [connectionId]),
  );
  if (!conn) return { status: "skipped", accounts: 0, created: 0, updated: 0, error: "conexão inexistente" };
  const log = async (r: SyncResult) => {
    await db.asService((q) =>
      q.query(
        `insert into bank_sync_logs (connection_id, workspace_id, owner_id, trigger, status, accounts, transactions_created, transactions_updated, error, started_at, finished_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
        [conn.id, conn.workspace_id, conn.owner_id, trigger, r.status, r.accounts, r.created, r.updated, r.error ?? null, now],
      ),
    );
    return r;
  };
  if (conn.revoked_at || conn.status === "revoked") return log({ status: "skipped", accounts: 0, created: 0, updated: 0, error: "conexão revogada" });

  let item: ProviderItem;
  try {
    item = await provider.getItem(conn.external_item_id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro";
    await db.asService((q) => q.query("update bank_connections set status = 'error', last_sync_error = $2 where id = $1", [conn.id, msg.slice(0, 500)]));
    if (e instanceof BankProviderError && e.retryable) throw e; // fila reprocessa com backoff
    return log({ status: "failed", accounts: 0, created: 0, updated: 0, error: msg });
  }
  await db.asService((q) =>
    q.query(
      `update bank_connections set status = $2, provider_status = $3, provider_execution_status = $4, status_detail = $5, consent_expires_at = $6 where id = $1`,
      [conn.id, item.status, item.providerStatus, item.providerExecutionStatus, item.statusDetail, item.consentExpiresAt],
    ),
  );
  // Consentimento expirado/revogado: a API devolve vazio sem erro — não podemos tratar isso como "sem transações".
  if (item.status === "revoked" || item.status === "consent_expired") {
    return log({ status: "skipped", accounts: 0, created: 0, updated: 0, error: item.status === "revoked" ? "consentimento revogado no banco" : "consentimento expirado" });
  }
  if (item.status === "syncing" || item.status === "waiting_user") {
    return log({ status: "skipped", accounts: 0, created: 0, updated: 0, error: "provedor ainda sincronizando" });
  }

  const accounts = await provider.listAccounts(conn.external_item_id);
  const from = localDateString(new Date(now.getTime() - HISTORY_DAYS * 86_400_000), "America/Sao_Paulo");
  let created = 0;
  let updated = 0;
  let partial = false;
  for (const a of accounts) {
    const acc = await db.asService((q) => upsertAccount(q, conn, a, item.lastUpdatedAt ?? now));
    let cursor: string | null = null;
    for (let page = 0; page < 50; page++) {
      let res;
      try {
        res = await provider.listTransactions(a.id, { from, cursor });
      } catch (e) {
        if (e instanceof BankProviderError && e.retryable) throw e;
        partial = true;
        break;
      }
      const counts = await db.asService((q) => importTransactions(q, conn, acc, res.transactions));
      created += counts.created;
      updated += counts.updated;
      cursor = res.next;
      if (!cursor) break;
    }
  }
  await db.asService((q) =>
    q.query("update bank_connections set last_synced_at = $2, last_sync_error = null, status = $3 where id = $1", [conn.id, now, partial ? "outdated" : "updated"]),
  );
  return log({ status: partial ? "partial" : "succeeded", accounts: accounts.length, created, updated });
}

async function importTransactions(
  q: Queryable,
  conn: ConnectionRow,
  acc: { kind: string; credit_card_id: string | null; financial_account_id: string | null },
  txs: { id: string; description: string; amountCents: number; direction: "out" | "in"; date: string; status: "posted" | "pending"; merchant: string | null; installment: { number: number; total: number } | null }[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const t of txs) {
    if (t.amountCents === 0) continue;
    // Cartão: entrada = pagamento de fatura ou estorno; conta: entrada = receita.
    const kind = t.direction === "out" ? "expense" : acc.kind === "credit" ? (/pagamento|pgto|payment/i.test(t.description) ? "card_payment" : "refund") : "income";
    const status = t.status === "pending" ? "pending" : "paid";
    const rows = await q.query<{ inserted: boolean }>(
      `insert into transactions (workspace_id, owner_id, kind, description, merchant, amount_cents, occurred_on, status, account_id, card_id,
         installment_number, installment_total, source, external_source, external_id, payment_method)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'import', $13, $14, $15)
       on conflict (workspace_id, external_source, external_id) where external_id is not null do update set
         status = case when transactions.status in ('cancelled', 'reversed', 'reconciled') then transactions.status else excluded.status end,
         amount_cents = excluded.amount_cents, occurred_on = excluded.occurred_on
       returning (xmax = 0) as inserted`,
      [conn.workspace_id, conn.owner_id, kind, t.description.slice(0, 200), t.merchant, t.amountCents, t.date, status,
        acc.kind === "bank" ? acc.financial_account_id : null, acc.kind === "credit" ? acc.credit_card_id : null,
        t.installment?.number ?? null, t.installment?.total ?? null, SOURCE(conn.provider), t.id, acc.kind === "credit" ? "credit" : null],
    );
    if (rows[0]?.inserted) created++;
    else updated++;
  }
  return { created, updated };
}

/** Revogação pelo titular: exclui no provedor (revoga o consentimento lá) e interrompe novos syncs. */
export async function revokeConnection(db: Database, provider: BankProvider | null, userId: string, connectionId: string): Promise<boolean> {
  const [conn] = await db.asUser(userId, (q) =>
    q.query<ConnectionRow>("select id, workspace_id, owner_id, provider, external_item_id, status, revoked_at from bank_connections where id = $1 and owner_id = $2", [connectionId, userId]),
  );
  if (!conn) return false;
  if (provider) await provider.deleteItem(conn.external_item_id);
  await db.asService(async (q) => {
    await q.query("update bank_connections set status = 'revoked', revoked_at = now() where id = $1", [conn.id]);
    await q.query(
      "insert into audit_logs (workspace_id, actor_id, actor_type, action, resource_type, resource_id) values ($1, $2, 'user', 'bank.connection.revoked', 'bank_connection', $3)",
      [conn.workspace_id, userId, conn.id],
    );
  });
  return true;
}
