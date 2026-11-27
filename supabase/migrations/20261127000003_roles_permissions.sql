-- GEMA AI — Papéis ampliados, permissões por módulo/ação e convites com token.
-- Papéis: owner, admin, manager (gestor), finance (financeiro), accountant (contador), member (colaborador),
-- family (familiar), viewer (visualizador). Cada papel tem um nível base (compatível com app.is_member)
-- e permissões por módulo×ação em role_permissions, com override por membro em workspace_members.permissions.

alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('owner', 'admin', 'manager', 'finance', 'accountant', 'member', 'family', 'viewer'));

alter table public.workspace_invitations drop constraint if exists workspace_invitations_role_check;
alter table public.workspace_invitations add constraint workspace_invitations_role_check
  check (role in ('admin', 'manager', 'finance', 'accountant', 'member', 'family', 'viewer'));

-- Tipo de workspace profissional (autônomo).
alter table public.workspaces drop constraint if exists workspaces_kind_check;
alter table public.workspaces add constraint workspaces_kind_check check (kind in ('personal', 'family', 'professional', 'business'));

create or replace function app.role_rank(p_role text)
returns int
language sql
immutable
as $$
  select case p_role
    when 'owner' then 40
    when 'admin' then 30
    when 'manager' then 25
    when 'finance' then 20
    when 'member' then 20
    when 'family' then 20
    when 'accountant' then 10
    when 'viewer' then 10
    else 0
  end
$$;

create table public.role_permissions (
  role text not null,
  module text not null check (module in ('finance', 'banking', 'calendar', 'tasks', 'contacts', 'documents', 'automations', 'crm', 'fiscal', 'reports', 'members', 'settings')),
  action text not null check (action in ('read', 'write', 'delete', 'export', 'manage')),
  primary key (role, module, action)
);
alter table public.role_permissions enable row level security;
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
revoke insert, update, delete on public.role_permissions from authenticated;

-- Matriz padrão (editável por migration; overrides por membro via workspace_members.permissions).
insert into public.role_permissions (role, module, action)
select r, m, a from (values
  -- owner/admin: tudo
  ('owner'), ('admin')
) roles(r)
cross join (values ('finance'), ('banking'), ('calendar'), ('tasks'), ('contacts'), ('documents'), ('automations'), ('crm'), ('fiscal'), ('reports'), ('members'), ('settings')) mods(m)
cross join (values ('read'), ('write'), ('delete'), ('export'), ('manage')) acts(a)
where not (r = 'admin' and m = 'settings' and a = 'manage')
on conflict do nothing;

insert into public.role_permissions (role, module, action) values
  -- gestor: operação completa exceto membros/configurações
  ('manager', 'finance', 'read'), ('manager', 'finance', 'write'), ('manager', 'finance', 'export'),
  ('manager', 'calendar', 'read'), ('manager', 'calendar', 'write'), ('manager', 'calendar', 'delete'),
  ('manager', 'tasks', 'read'), ('manager', 'tasks', 'write'), ('manager', 'tasks', 'delete'),
  ('manager', 'contacts', 'read'), ('manager', 'contacts', 'write'),
  ('manager', 'documents', 'read'), ('manager', 'documents', 'write'),
  ('manager', 'crm', 'read'), ('manager', 'crm', 'write'), ('manager', 'crm', 'delete'),
  ('manager', 'automations', 'read'), ('manager', 'automations', 'write'),
  ('manager', 'reports', 'read'), ('manager', 'reports', 'export'), ('manager', 'members', 'read'),
  -- financeiro: finanças, cobranças, fiscal e relatórios
  ('finance', 'finance', 'read'), ('finance', 'finance', 'write'), ('finance', 'finance', 'delete'), ('finance', 'finance', 'export'),
  ('finance', 'banking', 'read'), ('finance', 'crm', 'read'), ('finance', 'fiscal', 'read'), ('finance', 'fiscal', 'write'),
  ('finance', 'documents', 'read'), ('finance', 'documents', 'write'), ('finance', 'reports', 'read'), ('finance', 'reports', 'export'),
  -- contador: leitura financeira/fiscal e exportação
  ('accountant', 'finance', 'read'), ('accountant', 'finance', 'export'), ('accountant', 'fiscal', 'read'), ('accountant', 'fiscal', 'export'),
  ('accountant', 'documents', 'read'), ('accountant', 'reports', 'read'), ('accountant', 'reports', 'export'),
  -- colaborador: tarefas, agenda, contatos e documentos; finanças só leitura do compartilhado
  ('member', 'tasks', 'read'), ('member', 'tasks', 'write'), ('member', 'calendar', 'read'), ('member', 'calendar', 'write'),
  ('member', 'contacts', 'read'), ('member', 'contacts', 'write'), ('member', 'documents', 'read'), ('member', 'documents', 'write'),
  ('member', 'finance', 'read'), ('member', 'finance', 'write'), ('member', 'crm', 'read'), ('member', 'automations', 'read'), ('member', 'automations', 'write'),
  -- familiar: rotina doméstica e despesas compartilhadas
  ('family', 'finance', 'read'), ('family', 'finance', 'write'), ('family', 'calendar', 'read'), ('family', 'calendar', 'write'),
  ('family', 'tasks', 'read'), ('family', 'tasks', 'write'), ('family', 'contacts', 'read'), ('family', 'documents', 'read'),
  ('family', 'automations', 'read'), ('family', 'automations', 'write'),
  -- visualizador: somente leitura
  ('viewer', 'finance', 'read'), ('viewer', 'calendar', 'read'), ('viewer', 'tasks', 'read'), ('viewer', 'contacts', 'read'),
  ('viewer', 'documents', 'read'), ('viewer', 'reports', 'read')
on conflict do nothing;

-- Permissão efetiva: override do membro (permissions->module->action = true/false) prevalece sobre a matriz do papel.
create or replace function app.can(p_workspace uuid, p_module text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case
              when m.permissions -> p_module ? p_action then (m.permissions -> p_module ->> p_action)::boolean
              else exists (select 1 from public.role_permissions rp where rp.role = m.role and rp.module = p_module and rp.action = p_action)
            end
     from public.workspace_members m
     join public.workspaces w on w.id = m.workspace_id and w.deleted_at is null
     where m.workspace_id = p_workspace and m.user_id = auth.uid()),
    false)
$$;
grant execute on function app.can(uuid, text, text) to authenticated;

-- Políticas RESTRITIVAS adicionais por módulo (somam-se às permissivas existentes: o titular continua
-- precisando de can_read/can_write, e agora também da permissão do módulo).
do $$
declare
  r record;
begin
  for r in select * from (values
    ('transactions', 'finance'), ('budgets', 'finance'), ('financial_accounts', 'finance'), ('recurring_transactions', 'finance'),
    ('credit_cards', 'finance'), ('credit_card_bills', 'finance'), ('goals', 'finance'), ('debts', 'finance'),
    ('recurring_candidates', 'finance'), ('categorization_rules', 'finance'), ('assets', 'finance'), ('net_worth_snapshots', 'finance'),
    ('bank_connections', 'banking'), ('bank_accounts', 'banking'),
    ('calendar_events', 'calendar'), ('tasks', 'tasks'), ('projects', 'tasks'), ('task_lists', 'tasks'), ('reminders', 'tasks'),
    ('contacts', 'contacts'), ('documents', 'documents')
  ) as t(tbl, module) loop
    execute format('create policy %1$s_mod_read on public.%1$I as restrictive for select to authenticated using (owner_id = auth.uid() or app.can(workspace_id, %2$L, ''read''))', r.tbl, r.module);
    execute format('create policy %1$s_mod_write on public.%1$I as restrictive for insert to authenticated with check (app.can(workspace_id, %2$L, ''write''))', r.tbl, r.module);
    execute format('create policy %1$s_mod_update on public.%1$I as restrictive for update to authenticated using (owner_id = auth.uid() or app.can(workspace_id, %2$L, ''write''))', r.tbl, r.module);
    execute format('create policy %1$s_mod_delete on public.%1$I as restrictive for delete to authenticated using (owner_id = auth.uid() or app.can(workspace_id, %2$L, ''delete''))', r.tbl, r.module);
  end loop;
end;
$$;

-- Banco: contas bancárias de terceiros nunca são lidas só por permissão de módulo; o padrão continua privado.
-- (A política restritiva acima exige can 'banking.read' além de app.can_read com visibilidade.)

-- Gestão de membros passa a exigir members.manage (owner/admin por padrão).
drop policy if exists members_admin_insert on public.workspace_members;
drop policy if exists members_admin_update on public.workspace_members;
drop policy if exists members_admin_delete on public.workspace_members;
create policy members_manage_insert on public.workspace_members for insert to authenticated
  with check (app.can(workspace_id, 'members', 'manage') and role <> 'owner');
create policy members_manage_update on public.workspace_members for update to authenticated
  using (app.can(workspace_id, 'members', 'manage') and role <> 'owner' and user_id <> auth.uid())
  with check (app.can(workspace_id, 'members', 'manage') and role <> 'owner');
create policy members_manage_delete on public.workspace_members for delete to authenticated
  using ((app.can(workspace_id, 'members', 'manage') and role <> 'owner') or (user_id = auth.uid() and role <> 'owner'));

-- Convites: token (hash) de uso único com expiração; aceite por função transacional.
alter table public.workspace_invitations
  add column if not exists permissions jsonb not null default '{}'::jsonb,
  add column if not exists revoked_at timestamptz,
  add column if not exists accepted_by uuid references auth.users (id) on delete set null;

drop policy if exists invitations_admin_all on public.workspace_invitations;
create policy invitations_manage on public.workspace_invitations for all to authenticated
  using (app.can(workspace_id, 'members', 'manage'))
  with check (app.can(workspace_id, 'members', 'manage') and invited_by = auth.uid());

create or replace function public.accept_invitation(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv record;
  v_uid uuid := auth.uid();
  v_email text;
  v_kind text;
begin
  if v_uid is null then raise exception 'não autenticado' using errcode = '28000'; end if;
  select * into v_inv from public.workspace_invitations where token_hash = p_token_hash for update;
  if v_inv is null or v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    raise exception 'convite inválido ou já utilizado' using errcode = 'P0001';
  end if;
  if v_inv.expires_at <= now() then raise exception 'convite expirado' using errcode = 'P0001'; end if;
  select email into v_email from auth.users where id = v_uid;
  if lower(coalesce(v_email, '')) <> lower(v_inv.email) then
    raise exception 'convite emitido para outro e-mail' using errcode = '42501';
  end if;
  select kind into v_kind from public.workspaces where id = v_inv.workspace_id and deleted_at is null;
  if v_kind is null or v_kind = 'personal' then raise exception 'workspace inválido' using errcode = 'P0001'; end if;
  insert into public.workspace_members (workspace_id, user_id, role, permissions)
  values (v_inv.workspace_id, v_uid, v_inv.role, v_inv.permissions)
  on conflict (workspace_id, user_id) do nothing;
  update public.workspace_invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  insert into public.audit_logs (workspace_id, actor_id, actor_type, action, resource_type, resource_id)
  values (v_inv.workspace_id, v_uid, 'user', 'workspace.invitation.accepted', 'workspace_invitation', v_inv.id::text);
  return v_inv.workspace_id;
end;
$$;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
