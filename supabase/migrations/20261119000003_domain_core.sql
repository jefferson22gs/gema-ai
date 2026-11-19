-- GEMA AI — Domínio: contatos, agenda, finanças, tarefas, projetos e lembretes.
-- Convenções: workspace_id + owner_id em todo recurso; visibility 'private' (só o dono)
-- ou 'workspace' (membros do workspace). Valores monetários em centavos inteiros (bigint).
-- idempotency_key (opcional) impede duplicidade de lançamentos vindos de IA/webhooks.

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id),
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  name text not null check (char_length(name) between 1 and 160),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text,
  company text,
  notes text,
  tags text[] not null default '{}',
  google_resource_name text,
  source text not null default 'local' check (source in ('local', 'google', 'ai', 'import')),
  idempotency_key text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index contacts_ws_idx on public.contacts (workspace_id, name) where deleted_at is null;
create unique index contacts_ws_phone_uidx on public.contacts (workspace_id, owner_id, phone_e164) where deleted_at is null and phone_e164 is not null;
create unique index contacts_google_uidx on public.contacts (workspace_id, google_resource_name) where google_resource_name is not null;

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id),
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  title text not null check (char_length(title) between 1 and 200),
  description text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  timezone text not null default 'America/Sao_Paulo',
  recurrence_rule text,
  attendees jsonb not null default '[]'::jsonb,
  status text not null default 'confirmed' check (status in ('tentative', 'confirmed', 'cancelled')),
  source text not null default 'local' check (source in ('local', 'google', 'ai', 'agendafacil')),
  external_provider text,
  external_id text,
  external_etag text,
  sync_status text not null default 'local_only' check (sync_status in ('local_only', 'pending_push', 'synced', 'error')),
  sync_error text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_range check (ends_at > starts_at),
  unique (workspace_id, idempotency_key)
);
create index calendar_events_ws_range_idx on public.calendar_events (workspace_id, starts_at, ends_at) where status <> 'cancelled';
create unique index calendar_events_external_uidx on public.calendar_events (workspace_id, external_provider, external_id) where external_id is not null;

create table public.calendar_sync_state (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'google',
  calendar_id text not null default 'primary',
  sync_token text,
  channel_id text,
  channel_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, provider, calendar_id)
);

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id),
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'checking' check (kind in ('checking', 'savings', 'credit_card', 'cash', 'investment', 'other')),
  currency text not null default 'BRL',
  opening_balance_cents bigint not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index financial_accounts_ws_idx on public.financial_accounts (workspace_id);

-- Categorias com workspace_id nulo são globais (padrão do sistema, somente leitura).
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  slug text not null,
  name text not null,
  kind text not null check (kind in ('expense', 'income')),
  icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index categories_global_slug_uidx on public.categories (slug, kind) where workspace_id is null;
create unique index categories_ws_slug_uidx on public.categories (workspace_id, slug, kind) where workspace_id is not null;

create table public.recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id),
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  kind text not null check (kind in ('expense', 'income')),
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  category_id uuid references public.categories (id),
  account_id uuid references public.financial_accounts (id) on delete set null,
  frequency text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  day_of_month int check (day_of_month between 1 and 31),
  next_occurrence date not null,
  ends_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recurring_transactions_ws_idx on public.recurring_transactions (workspace_id, next_occurrence) where active;

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id),
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  kind text not null check (kind in ('expense', 'income')),
  description text not null check (char_length(description) between 1 and 200),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'BRL',
  category_id uuid references public.categories (id),
  account_id uuid references public.financial_accounts (id) on delete set null,
  payment_method text check (payment_method in ('pix', 'debit', 'credit', 'cash', 'boleto', 'transfer', 'other')),
  tags text[] not null default '{}',
  occurred_on date not null,
  due_on date,
  status text not null default 'paid' check (status in ('paid', 'pending')),
  installment_number int,
  installment_total int,
  recurring_id uuid references public.recurring_transactions (id) on delete set null,
  document_id uuid,
  source text not null default 'manual' check (source in ('manual', 'ai', 'whatsapp', 'import', 'recurring', 'document')),
  idempotency_key text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_installments check (
    (installment_number is null and installment_total is null)
    or (installment_number between 1 and installment_total)
  ),
  unique (workspace_id, idempotency_key)
);
create index transactions_ws_date_idx on public.transactions (workspace_id, occurred_on desc) where deleted_at is null;
create index transactions_ws_due_idx on public.transactions (workspace_id, due_on) where status = 'pending' and deleted_at is null;

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id),
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  category_id uuid not null references public.categories (id),
  month date not null check (extract(day from month) = 1),
  limit_cents bigint not null check (limit_cents > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, owner_id, category_id, month)
);

create table public.task_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id),
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id),
  visibility text not null default 'workspace' check (visibility in ('private', 'workspace')),
  name text not null check (char_length(name) between 1 and 120),
  description text,
  status text not null default 'active' check (status in ('planned', 'active', 'on_hold', 'done', 'archived')),
  due_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_ws_idx on public.projects (workspace_id, status);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id),
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  assignee_id uuid references auth.users (id),
  list_id uuid references public.task_lists (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  depends_on uuid references public.tasks (id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  notes text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  tags text[] not null default '{}',
  checklist jsonb not null default '[]'::jsonb,
  due_at timestamptz,
  recurrence_rule text,
  completed_at timestamptz,
  source text not null default 'manual' check (source in ('manual', 'ai', 'whatsapp', 'automation')),
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index tasks_ws_open_idx on public.tasks (workspace_id, due_at) where completed_at is null;

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id),
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  title text not null check (char_length(title) between 1 and 200),
  remind_at timestamptz not null,
  timezone text not null default 'America/Sao_Paulo',
  -- Recorrência por horário local: o próximo disparo é recalculado no timezone (correto em DST).
  recurrence text check (recurrence in ('daily', 'weekly', 'monthly')),
  local_time time,
  channels text[] not null default '{dashboard}',
  related_type text check (related_type in ('task', 'event', 'transaction')),
  related_id uuid,
  active boolean not null default true,
  last_fired_at timestamptz,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index reminders_due_idx on public.reminders (remind_at) where active;

create trigger contacts_updated before update on public.contacts for each row execute function app.set_updated_at();
create trigger calendar_events_updated before update on public.calendar_events for each row execute function app.set_updated_at();
create trigger calendar_sync_state_updated before update on public.calendar_sync_state for each row execute function app.set_updated_at();
create trigger financial_accounts_updated before update on public.financial_accounts for each row execute function app.set_updated_at();
create trigger categories_updated before update on public.categories for each row execute function app.set_updated_at();
create trigger recurring_transactions_updated before update on public.recurring_transactions for each row execute function app.set_updated_at();
create trigger transactions_updated before update on public.transactions for each row execute function app.set_updated_at();
create trigger budgets_updated before update on public.budgets for each row execute function app.set_updated_at();
create trigger task_lists_updated before update on public.task_lists for each row execute function app.set_updated_at();
create trigger projects_updated before update on public.projects for each row execute function app.set_updated_at();
create trigger tasks_updated before update on public.tasks for each row execute function app.set_updated_at();
create trigger reminders_updated before update on public.reminders for each row execute function app.set_updated_at();
