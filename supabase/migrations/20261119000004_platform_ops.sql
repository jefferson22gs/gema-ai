-- GEMA AI — Integrações, canais, conversas/IA, automações, notificações, documentos e jobs.

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google_calendar', 'google_contacts', 'agendafacil365', 'evolution', 'meta_whatsapp')),
  status text not null default 'pending' check (status in ('pending', 'connected', 'error', 'revoked')),
  scopes text[] not null default '{}',
  external_account text,
  last_error text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, provider)
);

-- Server-only: tokens cifrados com AES-256-GCM na aplicação (OAUTH_ENCRYPTION_KEY).
-- Sem grants para anon/authenticated; somente service_role acessa.
create table public.encrypted_oauth_tokens (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  ciphertext text not null,
  key_version int not null default 1,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Estado OAuth anti-CSRF (uso único, expira em 10 min). Server-only.
create table public.oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null,
  code_verifier text not null,
  redirect_after text not null default '/app/integracoes',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Identidade de canal vinculada a um usuário/workspace somente após verificação de posse.
create table public.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('evolution', 'meta_cloud', 'baileys_whaileys', 'dashboard')),
  address text not null,
  status text not null default 'pending_verification' check (status in ('pending_verification', 'verified', 'revoked')),
  verification_code_hash text,
  verification_expires_at timestamptz,
  verification_attempts int not null default 0,
  verified_at timestamptz,
  opted_in_at timestamptz,
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Um endereço verificado aponta para um único titular por provedor.
create unique index channel_accounts_verified_uidx on public.channel_accounts (provider, address) where status = 'verified';
create index channel_accounts_user_idx on public.channel_accounts (user_id);

create table public.provider_webhook_events (
  id bigint generated always as identity primary key,
  provider text not null,
  provider_event_id text,
  signature_valid boolean not null,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'rejected', 'failed')),
  reason text,
  payload jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index provider_webhook_events_dedupe_uidx on public.provider_webhook_events (provider, provider_event_id) where provider_event_id is not null and signature_valid;
create index provider_webhook_events_recent_idx on public.provider_webhook_events (provider, received_at desc);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id),
  channel text not null default 'dashboard' check (channel in ('dashboard', 'whatsapp')),
  title text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_ws_owner_idx on public.conversations (workspace_id, owner_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references auth.users (id),
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  modality text not null default 'text' check (modality in ('text', 'audio', 'image', 'document')),
  provider text,
  provider_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
-- Dedupe de mensagens de canal: a mesma mensagem do provedor nunca é processada duas vezes.
create unique index messages_provider_dedupe_uidx on public.messages (provider, provider_message_id) where provider_message_id is not null;

create table public.ai_tool_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid not null references auth.users (id),
  conversation_id uuid references public.conversations (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  tool_name text not null,
  arguments jsonb not null,
  status text not null check (status in ('proposed', 'awaiting_confirmation', 'running', 'succeeded', 'failed', 'cancelled')),
  result jsonb,
  error text,
  idempotency_key text not null,
  requires_confirmation boolean not null default false,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index ai_tool_executions_pending_idx on public.ai_tool_executions (workspace_id, actor_id, status) where status = 'awaiting_confirmation';

create table public.ai_usage (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  model text not null,
  operation text not null default 'chat',
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  latency_ms int,
  succeeded boolean not null default true,
  created_at timestamptz not null default now()
);
create index ai_usage_ws_month_idx on public.ai_usage (workspace_id, created_at desc);

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id),
  template text not null check (template in ('daily_briefing', 'bill_due_soon', 'weekly_summary', 'task_overdue', 'event_upcoming')),
  name text not null,
  config jsonb not null default '{}'::jsonb,
  channels text[] not null default '{dashboard}',
  enabled boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automation_rules_due_idx on public.automation_rules (next_run_at) where enabled;

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.automation_rules (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  occurrence_key text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped', 'dead')),
  attempts int not null default 0,
  last_error text,
  output jsonb,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Idempotência por ocorrência: uma execução por regra por ocorrência.
  unique (rule_id, occurrence_key)
);
create index automation_runs_pending_idx on public.automation_runs (run_after) where status in ('pending', 'failed');

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  channels text[] not null default '{dashboard}',
  dedupe_key text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'partial', 'failed', 'dead', 'suppressed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notification_outbox_pending_idx on public.notification_outbox (next_attempt_at) where status in ('pending', 'failed');
create index notification_outbox_user_idx on public.notification_outbox (user_id, created_at desc);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.notification_outbox (id) on delete cascade,
  channel text not null check (channel in ('dashboard', 'email', 'whatsapp', 'push')),
  provider text,
  provider_message_id text,
  status text not null check (status in ('queued', 'accepted', 'delivered', 'failed', 'bounced', 'ambiguous')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notification_deliveries_outbox_idx on public.notification_deliveries (outbox_id);

-- Registro de e-mails: idempotência por template+destinatário+evento e tentativas por provedor.
create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete set null,
  idempotency_key text not null unique,
  template text not null,
  to_email text not null,
  subject text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'delivered', 'failed', 'bounced', 'ambiguous')),
  provider text,
  provider_message_id text,
  attempts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index email_messages_provider_idx on public.email_messages (provider, provider_message_id);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id),
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  kind text not null default 'other' check (kind in ('receipt', 'invoice', 'contract', 'id', 'other')),
  tags text[] not null default '{}',
  status text not null default 'uploaded' check (status in ('uploaded', 'extracting', 'extracted', 'reviewed', 'failed')),
  retention_until date,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_ws_idx on public.documents (workspace_id, created_at desc) where deleted_at is null;

alter table public.transactions
  add constraint transactions_document_fk foreign key (document_id) references public.documents (id) on delete set null;

create table public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references auth.users (id),
  model text,
  extracted jsonb not null,
  confidence numeric(4, 3),
  review_status text not null default 'pending_review' check (review_status in ('pending_review', 'accepted', 'rejected')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.system_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'dead')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index system_jobs_pending_idx on public.system_jobs (run_after) where status in ('pending', 'failed');

-- Rate limiting por janela fixa (usuário/workspace/IP). Server-only.
create table public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, window_start)
);

create or replace function public.rate_limit_hit(p_bucket text, p_window_seconds int, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into public.rate_limits (bucket, window_start, count)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  return v_count <= p_max;
end;
$$;
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

create trigger integrations_updated before update on public.integrations for each row execute function app.set_updated_at();
create trigger encrypted_oauth_tokens_updated before update on public.encrypted_oauth_tokens for each row execute function app.set_updated_at();
create trigger channel_accounts_updated before update on public.channel_accounts for each row execute function app.set_updated_at();
create trigger conversations_updated before update on public.conversations for each row execute function app.set_updated_at();
create trigger ai_tool_executions_updated before update on public.ai_tool_executions for each row execute function app.set_updated_at();
create trigger automation_rules_updated before update on public.automation_rules for each row execute function app.set_updated_at();
create trigger automation_runs_updated before update on public.automation_runs for each row execute function app.set_updated_at();
create trigger notification_outbox_updated before update on public.notification_outbox for each row execute function app.set_updated_at();
create trigger notification_deliveries_updated before update on public.notification_deliveries for each row execute function app.set_updated_at();
create trigger email_messages_updated before update on public.email_messages for each row execute function app.set_updated_at();
create trigger documents_updated before update on public.documents for each row execute function app.set_updated_at();
create trigger system_jobs_updated before update on public.system_jobs for each row execute function app.set_updated_at();
