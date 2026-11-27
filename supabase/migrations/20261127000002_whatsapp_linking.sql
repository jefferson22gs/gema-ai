-- GEMA AI — Vinculação do WhatsApp por código enviado PELO USUÁRIO ao número oficial (inbound).
-- O código é gerado no painel autenticado; quem o envia do próprio WhatsApp comprova a posse do número.

create table public.channel_link_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('evolution', 'meta_cloud', 'baileys_whaileys')),
  code_hash text not null unique,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz,
  used_by_address text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index channel_link_codes_user_idx on public.channel_link_codes (user_id, created_at desc);
alter table public.channel_link_codes enable row level security;
-- Server-only: o código em claro só é mostrado uma vez, ao ser gerado.
revoke all on public.channel_link_codes from authenticated;

-- Tentativas de vinculação por endereço (bloqueio de força bruta por número remetente).
create table public.channel_link_attempts (
  id bigint generated always as identity primary key,
  provider text not null,
  address text not null,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index channel_link_attempts_addr_idx on public.channel_link_attempts (provider, address, created_at desc);
alter table public.channel_link_attempts enable row level security;
revoke all on public.channel_link_attempts from authenticated;

-- Preferências do canal: o que o assistente pode revelar pelo WhatsApp e quais ações exigem
-- reautenticação no painel. Padrão conservador: valores financeiros ocultos.
alter table public.channel_accounts
  add column if not exists show_balances boolean not null default false,
  add column if not exists show_transactions boolean not null default true,
  add column if not exists show_documents boolean not null default false,
  add column if not exists link_method text check (link_method in ('outbound_code', 'inbound_code')),
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_reason text;

-- O titular pode alterar apenas as preferências de exibição do próprio canal.
grant update (show_balances, show_transactions, show_documents) on public.channel_accounts to authenticated;
create policy channel_accounts_self_prefs on public.channel_accounts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
