-- GEMA AI — Central de Conversas ao vivo: modos de atendimento com exclusão mútua IA × humano,
-- notas internas, acesso de suporte com autorização temporária e auditoria.

alter table public.conversations
  add column if not exists mode text not null default 'ai' check (mode in ('ai', 'human', 'copilot', 'paused')),
  add column if not exists assigned_to uuid references auth.users (id) on delete set null,
  add column if not exists lock_version int not null default 0,
  add column if not exists mode_changed_at timestamptz,
  add column if not exists tags text[] not null default '{}',
  add column if not exists last_inbound_at timestamptz,
  add column if not exists contact_label text;

alter table public.messages
  add column if not exists author_id uuid references auth.users (id) on delete set null,
  add column if not exists author_kind text not null default 'user' check (author_kind in ('user', 'ai', 'human_agent', 'system')),
  add column if not exists delivery_status text check (delivery_status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  add column if not exists reply_to_provider_id text;

create table public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index conversation_notes_conv_idx on public.conversation_notes (conversation_id, created_at);
alter table public.conversation_notes enable row level security;
create policy conversation_notes_owner on public.conversation_notes for all to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and c.owner_id = auth.uid()))
  with check (author_id = auth.uid() and exists (select 1 from public.conversations c where c.id = conversation_id and c.owner_id = auth.uid()));

/**
 * Troca de modo com controle otimista (lock_version): duas pessoas/processos não conseguem assumir
 * a mesma conversa ao mesmo tempo. Só o titular (ou suporte com autorização ativa via função admin) altera.
 */
create or replace function public.set_conversation_mode(p_conversation uuid, p_mode text, p_expected_version int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_ws uuid;
  v_new int;
begin
  if p_mode not in ('ai', 'human', 'copilot', 'paused') then raise exception 'modo inválido' using errcode = '22023'; end if;
  select owner_id, workspace_id into v_owner, v_ws from public.conversations where id = p_conversation for update;
  if v_owner is null or v_owner <> auth.uid() then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.conversations
     set mode = p_mode,
         assigned_to = case when p_mode in ('human', 'copilot') then auth.uid() else null end,
         lock_version = lock_version + 1,
         mode_changed_at = now()
   where id = p_conversation and lock_version = p_expected_version
   returning lock_version into v_new;
  if v_new is null then raise exception 'conversa alterada por outra sessão; recarregue' using errcode = '40001'; end if;
  insert into public.audit_logs (workspace_id, actor_id, actor_type, action, resource_type, resource_id, metadata)
  values (v_ws, auth.uid(), 'user', 'conversation.mode_changed', 'conversation', p_conversation::text, jsonb_build_object('mode', p_mode));
  return v_new;
end;
$$;
revoke all on function public.set_conversation_mode(uuid, text, int) from public, anon;
grant execute on function public.set_conversation_mode(uuid, text, int) to authenticated;

-- Acesso de suporte: sempre temporário, justificado, ligado a chamado com consentimento e auditado.
create table public.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  support_case_id uuid not null references public.support_cases (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  operator_id uuid not null references auth.users (id) on delete cascade,
  justification text not null check (char_length(justification) between 10 and 1000),
  scope text not null default 'conversations' check (scope in ('conversations', 'metadata')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index support_access_grants_active_idx on public.support_access_grants (workspace_id, operator_id, expires_at) where revoked_at is null;
alter table public.support_access_grants enable row level security;
-- Titular vê quem acessou/pode acessar seu workspace.
create policy support_access_grants_owner_read on public.support_access_grants for select to authenticated
  using (app.is_member(workspace_id, 'admin'));
revoke insert, update, delete on public.support_access_grants from authenticated;
