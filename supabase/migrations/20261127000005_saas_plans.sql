-- GEMA AI — SaaS: planos editáveis (preço e limites fora do código), entitlements por módulo,
-- ciclos mensal/anual, cupons, add-ons e plano efetivo = assinatura (fonte única).

alter table public.plans
  add column if not exists price_yearly_cents integer check (price_yearly_cents is null or price_yearly_cents >= 0),
  add column if not exists trial_days integer not null default 14 check (trial_days between 0 and 90),
  add column if not exists active boolean not null default true,
  add column if not exists highlight boolean not null default false,
  add column if not exists workspace_kinds text[] not null default '{personal,family,professional,business}';
comment on column public.plans.price_cents is 'Preço mensal em centavos (editável no Super Admin; nunca fixado no código).';

-- Catálogo de entitlements (módulos/recursos liberados por plano).
create table public.plan_features (
  key text primary key,
  label text not null,
  description text not null,
  -- core = sempre disponível para acesso aos próprios dados, mesmo com assinatura vencida.
  core boolean not null default false,
  sort_order int not null default 0
);
alter table public.plan_features enable row level security;
create policy plan_features_read on public.plan_features for select to anon, authenticated using (true);
grant select on public.plan_features to anon;
revoke insert, update, delete on public.plan_features from authenticated;

insert into public.plan_features (key, label, description, core, sort_order) values
  ('finance', 'Finanças manuais', 'Lançamentos, categorias, orçamentos, cartões, metas e dívidas.', true, 1),
  ('calendar', 'Agenda', 'Compromissos, lembretes e conflitos.', true, 2),
  ('tasks', 'Tarefas e projetos', 'Tarefas, prioridades e projetos.', true, 3),
  ('documents', 'Documentos', 'Cofre privado de documentos.', true, 4),
  ('ai', 'Assistente de IA', 'Conversa com a GEMA no painel.', true, 5),
  ('whatsapp', 'WhatsApp', 'Assistente pelo WhatsApp.', false, 6),
  ('open_finance', 'Open Finance', 'Conexão de bancos (somente leitura).', false, 7),
  ('advanced_agents', 'Agentes avançados', 'Agentes especializados e pedidos compostos.', false, 8),
  ('automations', 'Automações', 'Rotinas automáticas e alertas.', false, 9),
  ('reports', 'Relatórios', 'Relatórios e exportações avançadas.', false, 10),
  ('smart_documents', 'Documentos inteligentes', 'Extração de comprovantes e busca.', false, 11),
  ('integrations', 'Integrações', 'Google Agenda e Contatos.', false, 12),
  ('family', 'Família', 'Workspace familiar, membros e despesas compartilhadas.', false, 13),
  ('business', 'Empresa', 'Workspace empresarial, CRM e indicadores.', false, 14),
  ('billing_charges', 'Cobranças', 'Cobranças a clientes (PIX/boleto).', false, 15),
  ('fiscal', 'Fiscal', 'Notas fiscais (depende de provedor homologado).', false, 16),
  ('team', 'Equipe', 'Membros, papéis e permissões.', false, 17)
on conflict (key) do nothing;

-- Planos V3 (valores comerciais SUJEITOS A CONFIRMAÇÃO e editáveis no Super Admin).
update public.plans set name = 'Essencial', features = array['finance', 'calendar', 'tasks', 'documents', 'ai', 'whatsapp'], sort_order = 1,
  workspace_kinds = '{personal,professional}' where id = 'essential';
update public.plans set name = 'Premium', highlight = true, sort_order = 2,
  features = array['finance', 'calendar', 'tasks', 'documents', 'ai', 'whatsapp', 'open_finance', 'advanced_agents', 'automations', 'reports', 'smart_documents', 'integrations'],
  workspace_kinds = '{personal,professional}' where id = 'premium';
update public.plans set name = 'Família', sort_order = 3,
  features = array['finance', 'calendar', 'tasks', 'documents', 'ai', 'whatsapp', 'open_finance', 'automations', 'reports', 'smart_documents', 'integrations', 'family', 'team'],
  workspace_kinds = '{family}' where id = 'family';
-- "executive" é substituído por "business"; continua existindo para assinaturas antigas, mas fora de venda.
update public.plans set is_public = false, active = false, sort_order = 99, workspace_kinds = '{professional,business}',
  features = array['finance', 'calendar', 'tasks', 'documents', 'ai', 'whatsapp', 'open_finance', 'advanced_agents', 'automations', 'reports', 'smart_documents', 'integrations', 'business', 'team']
  where id = 'executive';
insert into public.plans (id, name, description, price_cents, limits, features, sort_order, workspace_kinds)
values ('business', 'Business', 'Workspace empresarial, CRM, cobranças, fiscal, equipe e indicadores gerenciais.', 11990,
  '{"ai_messages_month": 5000, "ai_tokens_month": 10000000, "storage_mb": 10240, "automations": 100, "members": 10, "whatsapp_messages_month": 5000, "bank_connections": 10}',
  array['finance', 'calendar', 'tasks', 'documents', 'ai', 'whatsapp', 'open_finance', 'advanced_agents', 'automations', 'reports', 'smart_documents', 'integrations', 'business', 'billing_charges', 'fiscal', 'team'],
  4, '{professional,business}')
on conflict (id) do nothing;

-- Limite de conexões bancárias nos planos existentes.
update public.plans set limits = limits || '{"bank_connections": 0}'::jsonb where id = 'essential' and not limits ? 'bank_connections';
update public.plans set limits = limits || '{"bank_connections": 5}'::jsonb where id in ('premium', 'executive') and not limits ? 'bank_connections';
update public.plans set limits = limits || '{"bank_connections": 10}'::jsonb where id = 'family' and not limits ? 'bank_connections';

-- Assinatura: ciclo, cupom e plano efetivo único (workspaces.plan_id é mantido em sincronia).
alter table public.subscriptions
  add column if not exists billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'yearly')),
  add column if not exists coupon_code text,
  add column if not exists discount_ends_at timestamptz;

create or replace function app.sync_workspace_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.workspaces set plan_id = new.plan_id where id = new.workspace_id and plan_id is distinct from new.plan_id;
  return new;
end;
$$;
create trigger subscriptions_sync_plan after insert or update of plan_id on public.subscriptions
  for each row execute function app.sync_workspace_plan();
-- Corrige divergências antigas (workspace criado com 'essential' e assinatura em outro plano).
update public.workspaces w set plan_id = s.plan_id from public.subscriptions s where s.workspace_id = w.id and w.plan_id <> s.plan_id;

-- Cupons.
create table public.coupons (
  code text primary key check (code ~ '^[A-Z0-9_-]{3,32}$'),
  description text,
  percent_off int check (percent_off between 1 and 100),
  amount_off_cents int check (amount_off_cents > 0),
  duration_months int check (duration_months between 1 and 36),
  plan_ids text[] not null default '{}',
  cycles text[] not null default '{monthly,yearly}',
  max_redemptions int check (max_redemptions > 0),
  redeemed_count int not null default 0,
  valid_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((percent_off is null) <> (amount_off_cents is null))
);
alter table public.coupons enable row level security;
revoke all on public.coupons from authenticated, anon;
create trigger coupons_updated before update on public.coupons for each row execute function app.set_updated_at();

-- Add-ons (limites extras somados ao plano).
create table public.plan_addons (
  id text primary key check (id ~ '^[a-z0-9_]{3,40}$'),
  name text not null,
  description text not null,
  price_cents int not null check (price_cents >= 0),
  limits_delta jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.plan_addons enable row level security;
create policy plan_addons_read on public.plan_addons for select to anon, authenticated using (active);
grant select on public.plan_addons to anon;
revoke insert, update, delete on public.plan_addons from authenticated;
create trigger plan_addons_updated before update on public.plan_addons for each row execute function app.set_updated_at();

create table public.subscription_addons (
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  addon_id text not null references public.plan_addons (id),
  quantity int not null default 1 check (quantity between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (subscription_id, addon_id)
);
alter table public.subscription_addons enable row level security;
create policy subscription_addons_read on public.subscription_addons for select to authenticated
  using (exists (select 1 from public.subscriptions s where s.id = subscription_id and app.is_member(s.workspace_id, 'viewer')));
revoke insert, update, delete on public.subscription_addons from authenticated;

-- Entitlement efetivo: recursos "core" sempre; demais exigem assinatura ativa, trial válido ou carência.
create or replace function app.entitled(p_workspace uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select core from public.plan_features where key = p_feature), false)
      or exists (
        select 1 from public.subscriptions s join public.plans p on p.id = s.plan_id
        where s.workspace_id = p_workspace and p_feature = any (p.features)
          and (s.status = 'active'
               or (s.status = 'trialing' and coalesce(s.trial_ends_at, now() + interval '1 day') > now())
               or (s.status = 'past_due' and coalesce(s.grace_until, now()) > now()))
      )
$$;
grant execute on function app.entitled(uuid, text) to authenticated, service_role;

-- Limite efetivo: plano + add-ons (null = sem limite definido no plano).
create or replace function app.plan_limit(p_workspace uuid, p_key text)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (p.limits ->> p_key)::bigint
       + coalesce((select sum((a.limits_delta ->> p_key)::bigint * sa.quantity)
                   from public.subscription_addons sa join public.plan_addons a on a.id = sa.addon_id
                   where sa.subscription_id = s.id and a.limits_delta ? p_key), 0)
  from public.subscriptions s join public.plans p on p.id = s.plan_id
  where s.workspace_id = p_workspace
$$;
grant execute on function app.plan_limit(uuid, text) to authenticated, service_role;

-- Novo usuário: workspace pessoal em trial do Premium (experiência completa); ao fim do trial sem assinatura,
-- só os recursos "core" continuam (os dados nunca ficam inacessíveis).
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_trial int;
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), new.email)
  on conflict (id) do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict do nothing;
  select trial_days into v_trial from public.plans where id = 'premium';
  insert into public.workspaces (name, kind, created_by, plan_id) values ('Pessoal', 'personal', new.id, 'premium') returning id into v_ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, new.id, 'owner');
  insert into public.subscriptions (workspace_id, plan_id, status, trial_ends_at)
  values (v_ws, 'premium', 'trialing', now() + make_interval(days => coalesce(v_trial, 14)));
  return new;
end;
$$;

-- Novos workspaces: plano conforme o tipo; trial conforme o plano.
create or replace function public.create_workspace(p_name text, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_uid uuid := auth.uid();
  v_plan text;
  v_trial int;
begin
  if v_uid is null then raise exception 'não autenticado' using errcode = '28000'; end if;
  if p_kind not in ('family', 'professional', 'business') then raise exception 'tipo de workspace inválido' using errcode = '22023'; end if;
  v_plan := case p_kind when 'family' then 'family' when 'business' then 'business' else 'premium' end;
  select trial_days into v_trial from public.plans where id = v_plan;
  insert into public.workspaces (name, kind, created_by, plan_id) values (p_name, p_kind, v_uid, v_plan) returning id into v_ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_uid, 'owner');
  insert into public.subscriptions (workspace_id, plan_id, status, trial_ends_at)
  values (v_ws, v_plan, 'trialing', now() + make_interval(days => coalesce(v_trial, 14)));
  insert into public.audit_logs (workspace_id, actor_id, action, resource_type, resource_id)
  values (v_ws, v_uid, 'workspace.created', 'workspace', v_ws::text);
  return v_ws;
end;
$$;
