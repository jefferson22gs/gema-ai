-- GEMA AI — Identidade, workspaces, papéis, planos e assinaturas.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  phone_e164 text,
  phone_verified_at timestamptz,
  locale text not null default 'pt-BR',
  timezone text not null default 'America/Sao_Paulo',
  currency text not null default 'BRL',
  assistant_name text not null default 'Gema',
  assistant_style text not null default 'objetivo' check (assistant_style in ('objetivo', 'detalhado', 'formal', 'amigavel')),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_phone_e164 check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

create table public.plans (
  id text primary key,
  name text not null,
  description text not null,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'BRL',
  limits jsonb not null,
  features text[] not null default '{}',
  is_public boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('personal', 'family', 'business')),
  created_by uuid not null references auth.users (id),
  plan_id text not null default 'essential' references public.plans (id),
  timezone text not null default 'America/Sao_Paulo',
  currency text not null default 'BRL',
  ai_retention_days int not null default 90 check (ai_retention_days between 1 and 3650),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workspaces_created_by_idx on public.workspaces (created_by);
-- Cada usuário tem exatamente um workspace pessoal ativo.
create unique index workspaces_one_personal_idx on public.workspaces (created_by) where kind = 'personal' and deleted_at is null;

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'member', 'viewer')),
  token_hash text not null unique,
  invited_by uuid not null references auth.users (id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index workspace_invitations_ws_idx on public.workspace_invitations (workspace_id);

-- Workspace pessoal nunca recebe outros membros.
create or replace function app.guard_personal_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_owner uuid;
begin
  select kind, created_by into v_kind, v_owner from public.workspaces where id = new.workspace_id;
  if v_kind = 'personal' and new.user_id <> v_owner then
    raise exception 'workspace pessoal não aceita outros membros' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger workspace_members_personal_guard
  before insert or update on public.workspace_members
  for each row execute function app.guard_personal_membership();

-- Helpers de autorização (security definer evita recursão de RLS em workspace_members).
create or replace function app.is_member(p_workspace uuid, p_min_role text default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id and w.deleted_at is null
    where m.workspace_id = p_workspace
      and m.user_id = auth.uid()
      and app.role_rank(m.role) >= app.role_rank(p_min_role)
  )
$$;

-- Leitura de item com visibilidade: 'workspace' (todos os membros) ou 'private' (somente o dono).
create or replace function app.can_read(p_workspace uuid, p_visibility text, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.is_member(p_workspace, 'viewer')
    and (p_visibility = 'workspace' or p_owner = auth.uid())
$$;

-- Escrita: membro (não viewer); itens privados só pelo dono; admin/owner editam itens compartilhados.
create or replace function app.can_write(p_workspace uuid, p_visibility text, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.is_member(p_workspace, 'member')
    and (p_owner = auth.uid() or (p_visibility = 'workspace' and app.is_member(p_workspace, 'admin')))
$$;

grant execute on function app.is_member(uuid, text) to authenticated;
grant execute on function app.can_read(uuid, text, uuid) to authenticated;
grant execute on function app.can_write(uuid, text, uuid) to authenticated;

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces (id) on delete cascade,
  plan_id text not null references public.plans (id),
  status text not null check (status in ('trialing', 'active', 'past_due', 'cancelled')),
  provider text,
  provider_subscription_id text,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  grace_until timestamptz,
  cancel_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);

create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  workspace_id uuid references public.workspaces (id) on delete set null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  briefing_time time not null default '07:00',
  briefing_enabled boolean not null default false,
  quiet_hours_start time default '22:00',
  quiet_hours_end time default '07:00',
  channels jsonb not null default '{"email": true, "whatsapp": false, "push": false, "dashboard": true}'::jsonb,
  calendar_auto_sync_google boolean not null default false,
  default_event_minutes int not null default 60 check (default_event_minutes between 5 and 720),
  memory_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  consent_type text not null check (consent_type in ('terms', 'privacy', 'marketing_email', 'whatsapp_optin', 'ai_memory', 'push')),
  granted boolean not null,
  version text not null,
  source text not null default 'web',
  created_at timestamptz not null default now()
);
create index consent_records_user_idx on public.consent_records (user_id, consent_type, created_at desc);

-- Administração global da plataforma: tabela separada, sem acesso via RLS de cliente.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'super_admin' check (role in ('super_admin', 'support')),
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces (id) on delete set null,
  actor_id uuid,
  actor_type text not null default 'user' check (actor_type in ('user', 'system', 'ai', 'admin', 'support', 'webhook')),
  action text not null,
  resource_type text,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip inet,
  created_at timestamptz not null default now()
);
create index audit_logs_ws_idx on public.audit_logs (workspace_id, created_at desc);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);

create table public.feature_flags (
  key text primary key,
  description text not null,
  enabled boolean not null default false,
  rules jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  opened_by uuid not null references auth.users (id),
  subject text not null check (char_length(subject) between 3 and 160),
  body text not null check (char_length(body) <= 5000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  -- Acesso de suporte a dados do cliente exige concessão explícita e temporária do titular.
  data_access_granted_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_cases_ws_idx on public.support_cases (workspace_id, created_at desc);

-- Triggers updated_at
create trigger profiles_updated before update on public.profiles for each row execute function app.set_updated_at();
create trigger plans_updated before update on public.plans for each row execute function app.set_updated_at();
create trigger workspaces_updated before update on public.workspaces for each row execute function app.set_updated_at();
create trigger workspace_members_updated before update on public.workspace_members for each row execute function app.set_updated_at();
create trigger subscriptions_updated before update on public.subscriptions for each row execute function app.set_updated_at();
create trigger user_preferences_updated before update on public.user_preferences for each row execute function app.set_updated_at();
create trigger support_cases_updated before update on public.support_cases for each row execute function app.set_updated_at();

-- Novo usuário: perfil, preferências e workspace pessoal com papel owner.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), new.email)
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id) values (new.id) on conflict do nothing;

  insert into public.workspaces (name, kind, created_by)
  values ('Pessoal', 'personal', new.id)
  returning id into v_ws;

  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, new.id, 'owner');

  insert into public.subscriptions (workspace_id, plan_id, status, trial_ends_at)
  values (v_ws, 'essential', 'trialing', now() + interval '14 days');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Criação de workspace compartilhado (family/business) pelo usuário autenticado.
create or replace function public.create_workspace(p_name text, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;
  if p_kind not in ('family', 'business') then
    raise exception 'tipo de workspace inválido' using errcode = '22023';
  end if;
  insert into public.workspaces (name, kind, created_by) values (p_name, p_kind, v_uid) returning id into v_ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_uid, 'owner');
  insert into public.subscriptions (workspace_id, plan_id, status, trial_ends_at)
  values (v_ws, case when p_kind = 'family' then 'family' else 'executive' end, 'trialing', now() + interval '14 days');
  insert into public.audit_logs (workspace_id, actor_id, action, resource_type, resource_id)
  values (v_ws, v_uid, 'workspace.created', 'workspace', v_ws::text);
  return v_ws;
end;
$$;
grant execute on function public.create_workspace(text, text) to authenticated;
