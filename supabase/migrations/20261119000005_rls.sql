-- GEMA AI — Row Level Security em TODAS as tabelas do schema public.
-- Regras:
--  * Recursos de negócio: leitura por app.can_read (membro + visibilidade), escrita por app.can_write.
--  * Inserção exige owner_id = auth.uid() e papel >= member.
--  * Tabelas server-only: RLS habilitada, sem políticas e sem grants para anon/authenticated.
--  * Super Admin NÃO é contemplado por RLS de cliente; atua via rotas administrativas auditadas.

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    -- Sem FORCE: funções security definer (dono da tabela) precisam ler membership sem recursão.
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- anon só lê planos públicos.
revoke all on all tables in schema public from anon;
grant select on public.plans to anon;

-- Server-only.
revoke all on table
  public.encrypted_oauth_tokens,
  public.oauth_states,
  public.provider_webhook_events,
  public.billing_events,
  public.platform_admins,
  public.rate_limits,
  public.system_jobs,
  public.email_messages,
  public.notification_deliveries,
  public.push_subscriptions
from authenticated;

-- Planos
create policy plans_read on public.plans for select to anon, authenticated using (is_public);

-- Perfis e preferências: somente o próprio usuário.
create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy prefs_self_read on public.user_preferences for select to authenticated using (user_id = auth.uid());
create policy prefs_self_update on public.user_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy consent_self_read on public.consent_records for select to authenticated using (user_id = auth.uid());
create policy consent_self_insert on public.consent_records for insert to authenticated with check (user_id = auth.uid());

-- Workspaces e membros
create policy workspaces_member_read on public.workspaces for select to authenticated using (app.is_member(id, 'viewer'));
create policy workspaces_admin_update on public.workspaces for update to authenticated
  using (app.is_member(id, 'admin')) with check (app.is_member(id, 'admin'));

create policy members_read on public.workspace_members for select to authenticated using (app.is_member(workspace_id, 'viewer'));
create policy members_admin_insert on public.workspace_members for insert to authenticated
  with check (app.is_member(workspace_id, 'admin') and role <> 'owner');
create policy members_admin_update on public.workspace_members for update to authenticated
  using (app.is_member(workspace_id, 'admin') and role <> 'owner')
  with check (app.is_member(workspace_id, 'admin') and role <> 'owner');
create policy members_admin_delete on public.workspace_members for delete to authenticated
  using ((app.is_member(workspace_id, 'admin') and role <> 'owner') or (user_id = auth.uid() and role <> 'owner'));

create policy invitations_admin_all on public.workspace_invitations for all to authenticated
  using (app.is_member(workspace_id, 'admin')) with check (app.is_member(workspace_id, 'admin') and invited_by = auth.uid());

create policy subscriptions_member_read on public.subscriptions for select to authenticated using (app.is_member(workspace_id, 'viewer'));
revoke insert, update, delete on public.subscriptions from authenticated;

create policy audit_admin_read on public.audit_logs for select to authenticated using (app.is_member(workspace_id, 'admin'));
revoke insert, update, delete on public.audit_logs from authenticated;

-- Única via de escrita de auditoria pelo cliente: ator forçado a auth.uid() e membership verificada.
create or replace function public.write_audit(p_workspace uuid, p_actor_type text, p_action text, p_resource_type text, p_resource_id text, p_metadata jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not app.is_member(p_workspace, 'viewer') then
    raise exception 'auditoria não autorizada' using errcode = '42501';
  end if;
  if p_actor_type not in ('user', 'ai') then
    raise exception 'actor_type inválido' using errcode = '22023';
  end if;
  insert into public.audit_logs (workspace_id, actor_id, actor_type, action, resource_type, resource_id, metadata)
  values (p_workspace, auth.uid(), p_actor_type, left(p_action, 120), p_resource_type, p_resource_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;
revoke all on function public.write_audit(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.write_audit(uuid, text, text, text, text, jsonb) to authenticated;

create policy flags_read on public.feature_flags for select to authenticated using (true);
revoke insert, update, delete on public.feature_flags from authenticated;

create policy support_read on public.support_cases for select to authenticated
  using (app.is_member(workspace_id, 'viewer') and (opened_by = auth.uid() or app.is_member(workspace_id, 'admin')));
create policy support_insert on public.support_cases for insert to authenticated
  with check (opened_by = auth.uid() and app.is_member(workspace_id, 'viewer'));
create policy support_update on public.support_cases for update to authenticated
  using (opened_by = auth.uid()) with check (opened_by = auth.uid());

-- Recursos de negócio com visibilidade (padrão único).
do $$
declare
  t text;
begin
  foreach t in array array[
    'contacts', 'calendar_events', 'financial_accounts', 'recurring_transactions', 'transactions',
    'budgets', 'task_lists', 'projects', 'tasks', 'reminders', 'documents'
  ] loop
    execute format(
      'create policy %1$s_read on public.%1$I for select to authenticated using (app.can_read(workspace_id, visibility, owner_id))', t);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated with check (owner_id = auth.uid() and app.is_member(workspace_id, ''member''))', t);
    execute format(
      'create policy %1$s_update on public.%1$I for update to authenticated using (app.can_write(workspace_id, visibility, owner_id)) with check (app.can_write(workspace_id, visibility, owner_id))', t);
    execute format(
      'create policy %1$s_delete on public.%1$I for delete to authenticated using (app.can_write(workspace_id, visibility, owner_id))', t);
  end loop;
end;
$$;

-- Tarefas delegadas: o responsável (assignee) também enxerga e conclui.
create policy tasks_assignee_read on public.tasks for select to authenticated
  using (assignee_id = auth.uid() and app.is_member(workspace_id, 'viewer'));
create policy tasks_assignee_update on public.tasks for update to authenticated
  using (assignee_id = auth.uid() and app.is_member(workspace_id, 'member'))
  with check (assignee_id = auth.uid() and app.is_member(workspace_id, 'member'));

-- Categorias: globais (somente leitura) + do workspace.
create policy categories_read on public.categories for select to authenticated
  using (workspace_id is null or app.is_member(workspace_id, 'viewer'));
create policy categories_write on public.categories for insert to authenticated
  with check (workspace_id is not null and app.is_member(workspace_id, 'member'));
create policy categories_update on public.categories for update to authenticated
  using (workspace_id is not null and app.is_member(workspace_id, 'member'))
  with check (workspace_id is not null and app.is_member(workspace_id, 'member'));
create policy categories_delete on public.categories for delete to authenticated
  using (workspace_id is not null and app.is_member(workspace_id, 'admin'));

-- Sincronização e integrações: do próprio usuário dentro de workspace onde é membro.
create policy sync_state_self on public.calendar_sync_state for select to authenticated
  using (user_id = auth.uid() and app.is_member(workspace_id, 'viewer'));
revoke insert, update, delete on public.calendar_sync_state from authenticated;

create policy integrations_self_read on public.integrations for select to authenticated
  using (user_id = auth.uid() and app.is_member(workspace_id, 'viewer'));
revoke insert, update, delete on public.integrations from authenticated;

create policy channel_accounts_self_read on public.channel_accounts for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.channel_accounts from authenticated;

-- Conversas e mensagens: sempre privadas ao titular (inclusive em workspaces compartilhados).
create policy conversations_owner_all on public.conversations for all to authenticated
  using (owner_id = auth.uid() and app.is_member(workspace_id, 'viewer'))
  with check (owner_id = auth.uid() and app.is_member(workspace_id, 'viewer'));
create policy messages_owner_read on public.messages for select to authenticated
  using (owner_id = auth.uid() and app.is_member(workspace_id, 'viewer'));
create policy messages_owner_insert on public.messages for insert to authenticated
  with check (
    owner_id = auth.uid()
    and app.is_member(workspace_id, 'viewer')
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.owner_id = auth.uid() and c.workspace_id = messages.workspace_id)
  );
create policy messages_owner_delete on public.messages for delete to authenticated using (owner_id = auth.uid());

create policy tool_exec_actor_read on public.ai_tool_executions for select to authenticated
  using (actor_id = auth.uid() and app.is_member(workspace_id, 'viewer'));
create policy tool_exec_actor_insert on public.ai_tool_executions for insert to authenticated
  with check (actor_id = auth.uid() and app.is_member(workspace_id, 'viewer'));
create policy tool_exec_actor_update on public.ai_tool_executions for update to authenticated
  using (actor_id = auth.uid()) with check (actor_id = auth.uid());

create policy ai_usage_admin_read on public.ai_usage for select to authenticated
  using (user_id = auth.uid() or app.is_member(workspace_id, 'admin'));
create policy ai_usage_self_insert on public.ai_usage for insert to authenticated
  with check (user_id = auth.uid() and app.is_member(workspace_id, 'viewer'));

-- Automações
create policy automation_rules_read on public.automation_rules for select to authenticated
  using (owner_id = auth.uid() and app.is_member(workspace_id, 'viewer'));
create policy automation_rules_insert on public.automation_rules for insert to authenticated
  with check (owner_id = auth.uid() and app.is_member(workspace_id, 'member'));
create policy automation_rules_update on public.automation_rules for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and app.is_member(workspace_id, 'member'));
create policy automation_rules_delete on public.automation_rules for delete to authenticated using (owner_id = auth.uid());

create policy automation_runs_read on public.automation_runs for select to authenticated
  using (exists (select 1 from public.automation_rules r where r.id = rule_id and r.owner_id = auth.uid()));
revoke insert, update, delete on public.automation_runs from authenticated;

-- Notificações (central do usuário)
create policy outbox_self_read on public.notification_outbox for select to authenticated using (user_id = auth.uid());
create policy outbox_self_update on public.notification_outbox for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, delete on public.notification_outbox from authenticated;

-- Extrações de documentos: mesmo acesso do documento.
create policy extractions_read on public.document_extractions for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and app.can_read(d.workspace_id, d.visibility, d.owner_id)));
create policy extractions_review on public.document_extractions for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke insert, delete on public.document_extractions from authenticated;
