import { localDateString } from "@/lib/time";
import { DomainError, type ServiceDeps } from "../context";
import { netWorth, netWorthChange, type AssetKind, type NetWorth } from "../finance/engine";

export const ASSET_KINDS = ["cash", "investment", "property", "vehicle", "business", "other"] as const;
export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  cash: "Dinheiro guardado", investment: "Investimento", property: "Imóvel", vehicle: "Veículo", business: "Participação/negócio", other: "Outro bem",
};

export interface AssetRow {
  id: string;
  name: string;
  kind: AssetKind;
  liquid: boolean;
  value_cents: number;
  valued_on: string;
  notes: string | null;
  owner_id: string;
  visibility: "private" | "workspace";
}

export async function listAssets({ q, ctx }: ServiceDeps): Promise<AssetRow[]> {
  return q.query<AssetRow>(
    `select id, name, kind, liquid, value_cents, to_char(valued_on, 'YYYY-MM-DD') as valued_on, notes, owner_id, visibility
     from assets where workspace_id = $1 and archived_at is null order by value_cents desc`,
    [ctx.workspaceId],
  );
}

export interface AssetInput {
  name: string;
  kind: AssetKind;
  valueCents: number;
  liquid?: boolean;
  valuedOn?: string;
  notes?: string | null;
  visibility?: "private" | "workspace";
}

function validate(input: AssetInput) {
  if (!input.name?.trim() || input.name.trim().length > 120) throw new DomainError("invalid", "Nome do bem obrigatório (até 120 caracteres).");
  if (!ASSET_KINDS.includes(input.kind)) throw new DomainError("invalid", "Tipo de bem inválido.");
  if (!Number.isInteger(input.valueCents) || input.valueCents < 0) throw new DomainError("invalid", "Valor inválido.");
  if (input.valuedOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.valuedOn)) throw new DomainError("invalid", "Data da avaliação inválida.");
}

export async function createAsset(deps: ServiceDeps, input: AssetInput): Promise<string> {
  validate(input);
  const today = localDateString(deps.ctx.now, deps.ctx.timezone);
  if (input.valuedOn && input.valuedOn > today) throw new DomainError("invalid", "A data da avaliação não pode ser futura.");
  const [row] = await deps.q.query<{ id: string }>(
    `insert into assets (workspace_id, owner_id, visibility, name, kind, liquid, value_cents, valued_on, notes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [deps.ctx.workspaceId, deps.ctx.userId, input.visibility ?? "private", input.name.trim(), input.kind,
      input.liquid ?? (input.kind === "cash"), input.valueCents, input.valuedOn ?? today, input.notes?.trim() || null],
  );
  return row.id;
}

/** Atualiza o valor (nova avaliação). RLS garante que só quem pode escrever altera. */
export async function revalueAsset(deps: ServiceDeps, id: string, valueCents: number, valuedOn?: string) {
  if (!Number.isInteger(valueCents) || valueCents < 0) throw new DomainError("invalid", "Valor inválido.");
  const day = valuedOn ?? localDateString(deps.ctx.now, deps.ctx.timezone);
  const rows = await deps.q.query("update assets set value_cents = $3, valued_on = $4 where id = $1 and workspace_id = $2 and archived_at is null returning id", [id, deps.ctx.workspaceId, valueCents, day]);
  if (!rows.length) throw new DomainError("not_found", "Bem não encontrado.");
}

export async function archiveAsset(deps: ServiceDeps, id: string) {
  const rows = await deps.q.query("update assets set archived_at = now() where id = $1 and workspace_id = $2 and archived_at is null returning id", [id, deps.ctx.workspaceId]);
  return rows.length > 0;
}

/**
 * Monta o patrimônio a partir do que o usuário enxerga (RLS): bens, contas (banco conectado prevalece sobre os
 * lançamentos da conta vinculada), dívidas ativas e compras de cartão ainda não pagas.
 */
export async function computeNetWorth(deps: ServiceDeps): Promise<NetWorth & { today: string }> {
  const { q, ctx } = deps;
  const today = localDateString(ctx.now, ctx.timezone);
  const assets = await listAssets(deps);
  const banks = await q.query<{ name: string; institution_name: string; balance_cents: number | null; balance_at: Date | null }>(
    `select a.name, c.institution_name, a.balance_cents, a.balance_at from bank_accounts a join bank_connections c on c.id = a.connection_id
     where a.workspace_id = $1 and a.kind = 'bank' and c.revoked_at is null`,
    [ctx.workspaceId],
  );
  // Contas manuais (sem banco conectado ativo vinculado): saldo de abertura + efeito dos lançamentos pagos.
  const [manual] = await q.query<{ n: number; cents: number }>(
    `with contas as (
       select f.id, f.opening_balance_cents from financial_accounts f
       where f.workspace_id = $1 and f.archived_at is null
         and not exists (select 1 from bank_accounts b join bank_connections c on c.id = b.connection_id
                         where b.financial_account_id = f.id and c.revoked_at is null)
     )
     select (select count(*) from contas)::int as n,
       ((select coalesce(sum(opening_balance_cents), 0) from contas)
       + coalesce((select sum(case when t.kind in ('income', 'refund') then t.amount_cents
                                   when t.kind = 'expense' and t.card_id is null then -t.amount_cents
                                   when t.kind = 'card_payment' then -t.amount_cents else 0 end)
                   from transactions t where t.workspace_id = $1 and t.deleted_at is null and t.status in ('paid', 'reconciled')
                     and (t.account_id is null or t.account_id in (select id from contas))), 0))::bigint as cents`,
    [ctx.workspaceId],
  );
  const hasLedger = manual.n > 0 || (await q.query("select 1 from transactions where workspace_id = $1 and deleted_at is null and account_id is null and status in ('paid','reconciled') limit 1", [ctx.workspaceId])).length > 0;
  const debts = await q.query<{ creditor: string; kind: string; balance_cents: number }>(
    "select creditor, kind, balance_cents from debts where workspace_id = $1 and status = 'active'", [ctx.workspaceId],
  );
  const cards = await q.query<{ name: string; open_cents: number }>(
    `select c.name, coalesce((select sum(t.amount_cents) from transactions t left join credit_card_bills b on b.id = t.card_bill_id
       where t.card_id = c.id and t.kind = 'expense' and t.deleted_at is null and t.status not in ('cancelled', 'reversed')
         and (b.id is null or b.status <> 'paid')), 0)::bigint as open_cents
     from credit_cards c where c.workspace_id = $1 and c.archived_at is null`,
    [ctx.workspaceId],
  );
  const nw = netWorth({
    today,
    assets: assets.map((a) => ({ name: a.name, kind: a.kind, valueCents: Number(a.value_cents), liquid: a.liquid, valuedOn: a.valued_on })),
    bankAccounts: banks.map((b) => ({ name: `${b.institution_name} · ${b.name}`, balanceCents: b.balance_cents === null ? null : Number(b.balance_cents), balanceAt: b.balance_at ? new Date(b.balance_at).toISOString() : null })),
    registeredCashCents: hasLedger ? Number(manual.cents) : null,
    debts: debts.map((d) => ({ creditor: d.creditor, kind: d.kind, balanceCents: Number(d.balance_cents) })),
    cards: cards.map((c) => ({ name: c.name, openCents: Number(c.open_cents) })),
  });
  return { ...nw, today };
}

/**
 * Fotografia do patrimônio do usuário no dia (uma por dia; refazer no mesmo dia atualiza).
 * Fica privada: o valor reflete tudo o que o usuário enxerga, inclusive dados privados dele.
 */
export async function takeSnapshot(deps: ServiceDeps) {
  const nw = await computeNetWorth(deps);
  await deps.q.query(
    `insert into net_worth_snapshots (workspace_id, owner_id, snapshot_on, assets_cents, liabilities_cents) values ($1, $2, $3, $4, $5)
     on conflict (workspace_id, owner_id, snapshot_on) do update set assets_cents = excluded.assets_cents, liabilities_cents = excluded.liabilities_cents`,
    [deps.ctx.workspaceId, deps.ctx.userId, nw.today, nw.assetsCents, nw.liabilitiesCents],
  );
  return nw;
}

export async function listSnapshots({ q, ctx }: ServiceDeps, limit = 24) {
  const rows = await q.query<{ snapshot_on: string; assets_cents: number; liabilities_cents: number; net_worth_cents: number }>(
    `select to_char(snapshot_on, 'YYYY-MM-DD') as snapshot_on, assets_cents, liabilities_cents, net_worth_cents from net_worth_snapshots
     where workspace_id = $1 and owner_id = $2 order by snapshot_on desc limit $3`,
    [ctx.workspaceId, ctx.userId, limit],
  );
  const asc = rows.reverse().map((r) => ({ date: r.snapshot_on, assetsCents: Number(r.assets_cents), liabilitiesCents: Number(r.liabilities_cents), netWorthCents: Number(r.net_worth_cents) }));
  const last = asc.at(-1) ?? null;
  const prev = asc.at(-2) ?? null;
  return { series: asc, change: last ? netWorthChange(last.netWorthCents, prev?.netWorthCents ?? null) : null };
}
