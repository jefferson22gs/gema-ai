-- GEMA AI — Open Finance (somente leitura). Provedor plugável (Pluggy; Belvo futuro).
-- Nenhuma senha bancária é recebida pelo GEMA: a conexão acontece no widget oficial do provedor.
-- Dados bancários pertencem ao titular (owner) e ficam privados por padrão.

create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  provider text not null check (provider in ('pluggy', 'belvo')),
  external_item_id text not null,
  institution_name text not null,
  institution_logo_url text,
  is_open_finance boolean not null default false,
  is_sandbox boolean not null default false,
  -- Estado normalizado (independe do provedor).
  status text not null default 'connecting' check (status in ('connecting', 'syncing', 'updated', 'outdated', 'error', 'consent_expired', 'revoked', 'waiting_user', 'unavailable')),
  provider_status text,
  provider_execution_status text,
  status_detail text,
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  last_sync_error text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_item_id)
);
create index bank_connections_ws_idx on public.bank_connections (workspace_id, owner_id) where revoked_at is null;

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.bank_connections (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  external_account_id text not null,
  kind text not null check (kind in ('bank', 'credit')),
  subtype text,
  name text not null,
  number_masked text,
  currency text not null default 'BRL',
  balance_cents bigint,
  balance_at timestamptz,
  credit_limit_cents bigint,
  credit_available_cents bigint,
  -- Vínculos com o modelo interno (lançamentos importados vão para estas entidades).
  financial_account_id uuid references public.financial_accounts (id) on delete set null,
  credit_card_id uuid references public.credit_cards (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_account_id)
);
create index bank_accounts_ws_idx on public.bank_accounts (workspace_id);

-- Histórico de saldos: nunca apresentar saldo antigo como tempo real (balance_at sempre exibido).
create table public.balance_snapshots (
  id bigint generated always as identity primary key,
  bank_account_id uuid not null references public.bank_accounts (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  balance_cents bigint not null,
  captured_at timestamptz not null,
  unique (bank_account_id, captured_at)
);

create table public.bank_sync_logs (
  id bigint generated always as identity primary key,
  connection_id uuid not null references public.bank_connections (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  trigger text not null check (trigger in ('initial', 'webhook', 'manual', 'scheduled')),
  status text not null check (status in ('succeeded', 'partial', 'failed', 'skipped')),
  accounts int not null default 0,
  transactions_created int not null default 0,
  transactions_updated int not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index bank_sync_logs_conn_idx on public.bank_sync_logs (connection_id, started_at desc);

-- Cursor de sincronização incremental por conta (Pluggy /v2/transactions usa cursor `next`).
create table public.bank_sync_cursors (
  bank_account_id uuid primary key references public.bank_accounts (id) on delete cascade,
  cursor text,
  last_date_from date,
  updated_at timestamptz not null default now()
);

create trigger bank_connections_updated before update on public.bank_connections for each row execute function app.set_updated_at();
create trigger bank_accounts_updated before update on public.bank_accounts for each row execute function app.set_updated_at();
create trigger bank_sync_cursors_updated before update on public.bank_sync_cursors for each row execute function app.set_updated_at();

-- Contas pertencem ao mesmo workspace/titular da conexão.
create or replace function app.assert_bank_account_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  select workspace_id, owner_id into v from public.bank_connections where id = new.connection_id;
  if v.workspace_id is distinct from new.workspace_id or v.owner_id is distinct from new.owner_id then
    raise exception 'conta bancária deve pertencer ao mesmo titular/workspace da conexão' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger bank_accounts_owner_guard before insert or update on public.bank_accounts for each row execute function app.assert_bank_account_owner();

-- RLS: leitura pelo padrão de visibilidade; escrita pelo cliente apenas para revogar/visibilidade.
-- Conexão, contas e sync são gravados pelo servidor (service role) a partir do provedor.
alter table public.bank_connections enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.balance_snapshots enable row level security;
alter table public.bank_sync_logs enable row level security;
alter table public.bank_sync_cursors enable row level security;

create policy bank_connections_read on public.bank_connections for select to authenticated using (app.can_read(workspace_id, visibility, owner_id));
create policy bank_connections_owner_update on public.bank_connections for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke insert, delete on public.bank_connections from authenticated;
-- O cliente só altera a visibilidade; status, ids e consentimento são gravados pelo servidor.
revoke update on public.bank_connections from authenticated;
grant update (visibility) on public.bank_connections to authenticated;

create policy bank_accounts_read on public.bank_accounts for select to authenticated using (app.can_read(workspace_id, visibility, owner_id));
revoke insert, update, delete on public.bank_accounts from authenticated;

create policy balance_snapshots_read on public.balance_snapshots for select to authenticated
  using (exists (select 1 from public.bank_accounts a where a.id = bank_account_id and app.can_read(a.workspace_id, a.visibility, a.owner_id)));
revoke insert, update, delete on public.balance_snapshots from authenticated;

create policy bank_sync_logs_read on public.bank_sync_logs for select to authenticated using (owner_id = auth.uid());
revoke insert, update, delete on public.bank_sync_logs from authenticated;

revoke all on public.bank_sync_cursors from authenticated;

insert into public.feature_flags (key, description, enabled) values
  ('integration.pluggy', 'Open Finance via Pluggy (somente leitura). Requer PLUGGY_CLIENT_ID/SECRET.', true),
  ('integration.belvo', 'Open Finance via Belvo — adaptador futuro, não implementado.', false)
on conflict (key) do nothing;
