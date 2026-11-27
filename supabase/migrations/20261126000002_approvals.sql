-- GEMA AI — Central de Aprovações: risco 1–4, aprovação vinculada ao hash exato dos argumentos,
-- expiração, rejeição e decisão auditada.

alter table public.ai_tool_executions
  add column if not exists risk_level smallint not null default 1 check (risk_level between 1 and 4),
  add column if not exists agent text,
  add column if not exists args_hash text,
  add column if not exists approval_summary text,
  add column if not exists expires_at timestamptz,
  add column if not exists decided_at timestamptz,
  add column if not exists decision text check (decision in ('approved', 'rejected', 'expired'));

alter table public.ai_tool_executions drop constraint if exists ai_tool_executions_status_check;
alter table public.ai_tool_executions add constraint ai_tool_executions_status_check
  check (status in ('proposed', 'awaiting_confirmation', 'running', 'succeeded', 'failed', 'cancelled', 'rejected', 'expired', 'blocked'));

-- Risco 4 (pagamentos, transferências, investimentos, crédito) nunca pode ser executado pela IA.
alter table public.ai_tool_executions add constraint ai_tool_executions_risk4_never_runs
  check (risk_level < 4 or status in ('blocked', 'cancelled', 'rejected', 'failed'));

-- Argumentos de uma ação aguardando aprovação são imutáveis: qualquer mudança exige nova aprovação.
create or replace function app.guard_approval_args()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'awaiting_confirmation' and new.arguments is distinct from old.arguments then
    raise exception 'argumentos de ação aguardando aprovação não podem ser alterados' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger ai_tool_executions_guard_args before update on public.ai_tool_executions
  for each row execute function app.guard_approval_args();

create index if not exists ai_tool_executions_approvals_idx
  on public.ai_tool_executions (workspace_id, actor_id, created_at desc) where status = 'awaiting_confirmation';
