-- GEMA AI — Motor financeiro V3 (aditivo): estados/tipos ampliados, cartões, faturas, parcelas,
-- metas, dívidas, recorrências detectadas, regras de categorização, patrimônio.
-- Convenção mantida: workspace_id + owner_id + visibility; centavos bigint; RLS por app.can_read/can_write.

-- 1) Transações: tipos e estados ampliados ------------------------------------------------------
alter table public.transactions drop constraint if exists transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check
  check (kind in ('expense', 'income', 'transfer', 'refund', 'card_payment'));

alter table public.transactions drop constraint if exists transactions_status_check;
alter table public.transactions add constraint transactions_status_check
  check (status in ('paid', 'pending', 'projected', 'reconciled', 'cancelled', 'reversed'));

alter table public.transactions
  add column if not exists internal_transfer boolean not null default false,
  add column if not exists counterpart_account_id uuid references public.financial_accounts (id) on delete set null,
  add column if not exists reverses_id uuid references public.transactions (id) on delete set null,
  add column if not exists card_id uuid,
  add column if not exists card_bill_id uuid,
  add column if not exists installment_group_id uuid,
  add column if not exists merchant text,
  add column if not exists external_source text,
  add column if not exists external_id text,
  add column if not exists cost_center text;

-- Importações externas (Open Finance, OFX/CSV) nunca duplicam: dedupe por origem + id externo.
create unique index if not exists transactions_external_uidx
  on public.transactions (workspace_id, external_source, external_id) where external_id is not null;

-- 2) Cartões de crédito ------------------------------------------------------------------------
create table public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  name text not null check (char_length(name) between 1 and 80),
  brand text,
  last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  limit_cents bigint not null check (limit_cents >= 0),
  closing_day int not null check (closing_day between 1 and 31),
  due_day int not null check (due_day between 1 and 31),
  payment_account_id uuid references public.financial_accounts (id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'open_finance')),
  external_id text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index credit_cards_ws_idx on public.credit_cards (workspace_id) where archived_at is null;
comment on column public.credit_cards.last4 is 'Apenas os 4 últimos dígitos. Número completo do cartão NUNCA é armazenado.';

create table public.credit_card_bills (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.credit_cards (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  reference text not null check (reference ~ '^[0-9]{4}-[0-9]{2}$'),
  closing_date date not null,
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'closed', 'paid', 'partial', 'overdue')),
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (card_id, reference)
);
create index credit_card_bills_due_idx on public.credit_card_bills (workspace_id, due_date);

alter table public.transactions
  add constraint transactions_card_fk foreign key (card_id) references public.credit_cards (id) on delete set null,
  add constraint transactions_card_bill_fk foreign key (card_bill_id) references public.credit_card_bills (id) on delete set null;
create index transactions_card_bill_idx on public.transactions (card_bill_id) where card_bill_id is not null;

-- 3) Metas -------------------------------------------------------------------------------------
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  name text not null check (char_length(name) between 1 and 120),
  kind text not null default 'custom' check (kind in ('emergency', 'property', 'vehicle', 'travel', 'education', 'retirement', 'debt_payoff', 'custom')),
  target_cents bigint not null check (target_cents > 0),
  deadline date,
  status text not null default 'active' check (status in ('active', 'achieved', 'paused', 'cancelled')),
  achieved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goals_ws_idx on public.goals (workspace_id, status);

create table public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount_cents bigint not null check (amount_cents <> 0),
  contributed_on date not null,
  note text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index goal_contributions_goal_idx on public.goal_contributions (goal_id);

-- 4) Dívidas -----------------------------------------------------------------------------------
create table public.debts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  creditor text not null check (char_length(creditor) between 1 and 120),
  kind text not null default 'other' check (kind in ('credit_card', 'personal_loan', 'financing', 'overdraft', 'other')),
  balance_cents bigint not null check (balance_cents >= 0),
  monthly_rate numeric(8, 6) not null default 0 check (monthly_rate >= 0 and monthly_rate < 1),
  min_payment_cents bigint not null default 0 check (min_payment_cents >= 0),
  due_day int check (due_day between 1 and 31),
  installments_left int check (installments_left >= 0),
  -- 'estimated' = informado pelo usuário; 'contractual' = confirmado em contrato/extrato.
  terms_source text not null default 'estimated' check (terms_source in ('estimated', 'contractual')),
  status text not null default 'active' check (status in ('active', 'paid_off', 'renegotiated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index debts_ws_idx on public.debts (workspace_id, status);

-- 5) Recorrências/assinaturas detectadas (sugestão → confirmação) ----------------------------
create table public.recurring_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  merchant_key text not null,
  label text not null,
  interval_days int not null check (interval_days in (7, 30, 365)),
  average_cents bigint not null,
  last_cents bigint not null,
  last_date date not null,
  next_estimated_date date not null,
  price_change_pct numeric(6, 1),
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'dismissed', 'cancel_requested')),
  recurring_id uuid references public.recurring_transactions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, owner_id, merchant_key)
);

-- 6) Regras de categorização do usuário --------------------------------------------------------
create table public.categorization_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  pattern text not null check (char_length(pattern) between 2 and 120),
  category_id uuid not null references public.categories (id) on delete cascade,
  origin text not null default 'manual' check (origin in ('manual', 'learned')),
  enabled boolean not null default true,
  hits int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, owner_id, pattern)
);

-- 7) Patrimônio --------------------------------------------------------------------------------
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  name text not null check (char_length(name) between 1 and 120),
  kind text not null check (kind in ('cash', 'investment', 'property', 'vehicle', 'business', 'other')),
  liquid boolean not null default false,
  value_cents bigint not null check (value_cents >= 0),
  valued_on date not null default current_date,
  source text not null default 'manual' check (source in ('manual', 'open_finance')),
  external_id text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assets_ws_idx on public.assets (workspace_id) where archived_at is null;

create table public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  snapshot_on date not null,
  assets_cents bigint not null,
  liabilities_cents bigint not null,
  net_worth_cents bigint generated always as (assets_cents - liabilities_cents) stored,
  created_at timestamptz not null default now(),
  unique (workspace_id, owner_id, snapshot_on)
);

-- 8) Integridade entre workspaces: filho deve pertencer ao mesmo workspace do pai -------------
create or replace function app.assert_same_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  if tg_table_name = 'credit_card_bills' then
    select workspace_id into v_ws from public.credit_cards where id = new.card_id;
  elsif tg_table_name = 'goal_contributions' then
    select workspace_id into v_ws from public.goals where id = new.goal_id;
  elsif tg_table_name = 'transactions' then
    if new.card_id is not null then
      select workspace_id into v_ws from public.credit_cards where id = new.card_id;
      if v_ws is distinct from new.workspace_id then raise exception 'cartão de outro workspace' using errcode = '42501'; end if;
    end if;
    if new.account_id is not null then
      select workspace_id into v_ws from public.financial_accounts where id = new.account_id;
      if v_ws is distinct from new.workspace_id then raise exception 'conta de outro workspace' using errcode = '42501'; end if;
    end if;
    if new.counterpart_account_id is not null then
      select workspace_id into v_ws from public.financial_accounts where id = new.counterpart_account_id;
      if v_ws is distinct from new.workspace_id then raise exception 'conta de destino de outro workspace' using errcode = '42501'; end if;
    end if;
    return new;
  end if;
  if v_ws is distinct from new.workspace_id then
    raise exception 'registro vinculado a outro workspace' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger credit_card_bills_same_ws before insert or update on public.credit_card_bills for each row execute function app.assert_same_workspace();
create trigger goal_contributions_same_ws before insert or update on public.goal_contributions for each row execute function app.assert_same_workspace();
create trigger transactions_same_ws before insert or update of workspace_id, card_id, account_id, counterpart_account_id on public.transactions
  for each row execute function app.assert_same_workspace();

-- 9) updated_at e RLS --------------------------------------------------------------------------
create trigger credit_cards_updated before update on public.credit_cards for each row execute function app.set_updated_at();
create trigger credit_card_bills_updated before update on public.credit_card_bills for each row execute function app.set_updated_at();
create trigger goals_updated before update on public.goals for each row execute function app.set_updated_at();
create trigger debts_updated before update on public.debts for each row execute function app.set_updated_at();
create trigger recurring_candidates_updated before update on public.recurring_candidates for each row execute function app.set_updated_at();
create trigger categorization_rules_updated before update on public.categorization_rules for each row execute function app.set_updated_at();
create trigger assets_updated before update on public.assets for each row execute function app.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array['credit_cards', 'credit_card_bills', 'goals', 'debts', 'recurring_candidates', 'categorization_rules', 'assets', 'net_worth_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (app.can_read(workspace_id, visibility, owner_id))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (owner_id = auth.uid() and app.is_member(workspace_id, ''member''))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (app.can_write(workspace_id, visibility, owner_id)) with check (app.can_write(workspace_id, visibility, owner_id))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (app.can_write(workspace_id, visibility, owner_id))', t);
  end loop;
end;
$$;

-- Contribuições herdam o acesso da meta (sem visibilidade própria).
alter table public.goal_contributions enable row level security;
create policy goal_contributions_read on public.goal_contributions for select to authenticated
  using (exists (select 1 from public.goals g where g.id = goal_id and app.can_read(g.workspace_id, g.visibility, g.owner_id)));
create policy goal_contributions_insert on public.goal_contributions for insert to authenticated
  with check (owner_id = auth.uid() and exists (select 1 from public.goals g where g.id = goal_id and app.can_write(g.workspace_id, g.visibility, g.owner_id)));
create policy goal_contributions_delete on public.goal_contributions for delete to authenticated using (owner_id = auth.uid());
