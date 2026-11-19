-- GEMA AI — Fundação: schema privado de helpers, triggers utilitários.
-- Todas as datas/horas são persistidas em UTC (timestamptz); o timezone do usuário
-- fica em profiles.timezone e é usado apenas para apresentação e cálculo.

create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Hierarquia de papéis por workspace: owner > admin > member > viewer.
create or replace function app.role_rank(p_role text)
returns int
language sql
immutable
as $$
  select case p_role
    when 'owner' then 40
    when 'admin' then 30
    when 'member' then 20
    when 'viewer' then 10
    else 0
  end
$$;

grant execute on function app.role_rank(text) to anon, authenticated;
