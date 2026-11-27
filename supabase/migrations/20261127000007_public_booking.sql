-- GEMA AI — Agenda pública de agendamento (AG-02).
-- O visitante (anônimo) nunca lê tabelas: consulta horários livres e reserva por funções security definer que
-- devolvem só intervalos ocupados/livres, nunca títulos ou detalhes da agenda do dono.
-- Anti-duplicidade: advisory lock por página + checagem de sobreposição dentro da mesma transação.

create table public.booking_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  title text not null check (char_length(title) between 2 and 80),
  description text check (char_length(description) <= 500),
  duration_minutes int not null default 30 check (duration_minutes between 10 and 240),
  buffer_minutes int not null default 0 check (buffer_minutes between 0 and 120),
  min_notice_hours int not null default 4 check (min_notice_hours between 0 and 720),
  max_days_ahead int not null default 30 check (max_days_ahead between 1 and 180),
  timezone text not null default 'America/Sao_Paulo',
  -- {"1": [["09:00","12:00"],["14:00","18:00"]], ...} — 0 = domingo.
  weekly_hours jsonb not null default '{"1":[["09:00","18:00"]],"2":[["09:00","18:00"]],"3":[["09:00","18:00"]],"4":[["09:00","18:00"]],"5":[["09:00","18:00"]]}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index booking_pages_owner_idx on public.booking_pages (workspace_id, owner_id);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.booking_pages (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  guest_name text not null check (char_length(guest_name) between 2 and 120),
  guest_email text not null check (guest_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(guest_email) <= 254),
  guest_note text check (char_length(guest_note) <= 500),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  cancel_token_hash text not null unique,
  calendar_event_id uuid references public.calendar_events (id) on delete set null,
  client_key text not null check (char_length(client_key) between 8 and 128),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique (page_id, client_key)
);
create index bookings_page_range_idx on public.bookings (page_id, starts_at) where status = 'confirmed';

alter table public.booking_pages enable row level security;
alter table public.bookings enable row level security;
create policy booking_pages_owner on public.booking_pages for all to authenticated
  using (owner_id = auth.uid() and app.is_member(workspace_id, 'member'))
  with check (owner_id = auth.uid() and app.is_member(workspace_id, 'member'));
create policy bookings_owner_read on public.bookings for select to authenticated using (owner_id = auth.uid());
revoke insert, update, delete on public.bookings from authenticated;
revoke all on public.booking_pages, public.bookings from anon;
create trigger booking_pages_updated before update on public.booking_pages for each row execute function app.set_updated_at();

-- Intervalos ocupados do dono (eventos da agenda em qualquer workspace dele + reservas confirmadas), sem detalhes.
create or replace function app.booking_busy(p_owner uuid, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select e.starts_at, e.ends_at from public.calendar_events e
  where e.owner_id = p_owner and e.status <> 'cancelled' and e.starts_at < p_to and e.ends_at > p_from
  union all
  select b.starts_at, b.ends_at from public.bookings b
  where b.owner_id = p_owner and b.status = 'confirmed' and b.starts_at < p_to and b.ends_at > p_from
$$;
revoke all on function app.booking_busy(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Dados públicos da página (sem ids internos do dono).
create or replace function public.booking_page_public(p_slug text)
returns table (title text, description text, duration_minutes int, buffer_minutes int, min_notice_hours int, max_days_ahead int, timezone text, weekly_hours jsonb, host_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.title, p.description, p.duration_minutes, p.buffer_minutes, p.min_notice_hours, p.max_days_ahead, p.timezone, p.weekly_hours,
         split_part(coalesce(pr.full_name, ''), ' ', 1)
  from public.booking_pages p left join public.profiles pr on pr.id = p.owner_id
  where p.slug = lower(p_slug) and p.active
$$;
grant execute on function public.booking_page_public(text) to anon, authenticated;

-- Intervalos ocupados para a página pública (apenas início/fim; janela máxima de 62 dias).
create or replace function public.booking_busy_public(p_slug text, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if p_to <= p_from or p_to - p_from > interval '62 days' then raise exception 'intervalo inválido' using errcode = '22023'; end if;
  select owner_id into v_owner from public.booking_pages where slug = lower(p_slug) and active;
  if v_owner is null then return; end if;
  return query select b.starts_at, b.ends_at from app.booking_busy(v_owner, p_from, p_to) b order by 1;
end;
$$;
grant execute on function public.booking_busy_public(text, timestamptz, timestamptz) to anon, authenticated;

-- Reserva atômica. A validação de grade semanal/antecedência é feita no servidor antes; aqui o banco garante
-- página ativa, duração exata, janela e ausência de sobreposição (com intervalo de folga) sob lock.
create or replace function public.book_slot(
  p_slug text, p_starts_at timestamptz, p_guest_name text, p_guest_email text, p_guest_note text, p_cancel_token_hash text, p_client_key text
)
returns table (booking_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page public.booking_pages%rowtype;
  v_end timestamptz;
  v_existing uuid;
  v_id uuid;
  v_event uuid;
begin
  select * into v_page from public.booking_pages where slug = lower(p_slug) and active;
  if v_page.id is null then raise exception 'página indisponível' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('booking:' || v_page.owner_id::text, 0));
  -- Reenvio do mesmo formulário (mesma chave do cliente) devolve a reserva existente.
  select id into v_existing from public.bookings where page_id = v_page.id and client_key = p_client_key;
  if v_existing is not null then return query select v_existing, false; return; end if;
  v_end := p_starts_at + make_interval(mins => v_page.duration_minutes);
  if p_starts_at < now() + make_interval(hours => v_page.min_notice_hours)
     or p_starts_at > now() + make_interval(days => v_page.max_days_ahead) then
    raise exception 'horário fora da janela de agendamento' using errcode = '22023';
  end if;
  if exists (
    select 1 from app.booking_busy(v_page.owner_id,
      p_starts_at - make_interval(mins => v_page.buffer_minutes), v_end + make_interval(mins => v_page.buffer_minutes))
  ) then
    raise exception 'horário indisponível' using errcode = '23P01';
  end if;
  insert into public.calendar_events (workspace_id, owner_id, title, description, starts_at, ends_at, timezone, attendees, source)
  values (v_page.workspace_id, v_page.owner_id, left('Agendamento: ' || p_guest_name, 200),
          nullif(concat_ws(E'\n', 'Reservado pela página "' || v_page.title || '".', 'E-mail: ' || lower(p_guest_email), nullif(p_guest_note, '')), ''),
          p_starts_at, v_end, v_page.timezone, jsonb_build_array(jsonb_build_object('email', lower(p_guest_email), 'name', p_guest_name)), 'local')
  returning id into v_event;
  insert into public.bookings (page_id, workspace_id, owner_id, starts_at, ends_at, guest_name, guest_email, guest_note, cancel_token_hash, calendar_event_id, client_key)
  values (v_page.id, v_page.workspace_id, v_page.owner_id, p_starts_at, v_end, p_guest_name, lower(p_guest_email), nullif(p_guest_note, ''), p_cancel_token_hash, v_event, p_client_key)
  returning id into v_id;
  insert into public.notification_outbox (workspace_id, user_id, kind, title, body, channels, dedupe_key, data)
  values (v_page.workspace_id, v_page.owner_id, 'booking.created', 'Novo agendamento',
          p_guest_name || ' reservou "' || v_page.title || '" em ' || to_char(p_starts_at at time zone v_page.timezone, 'DD/MM/YYYY "às" HH24:MI') || '.',
          '{dashboard,email}', 'booking:' || v_id::text, jsonb_build_object('bookingId', v_id, 'eventId', v_event));
  insert into public.audit_logs (workspace_id, actor_type, action, resource_type, resource_id)
  values (v_page.workspace_id, 'webhook', 'booking.created', 'booking', v_id::text);
  return query select v_id, true;
end;
$$;
grant execute on function public.book_slot(text, timestamptz, text, text, text, text, text) to anon, authenticated;

-- Cancelamento pelo convidado (token do e-mail/tela de confirmação) ou pelo dono.
create or replace function public.cancel_booking(p_cancel_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.bookings%rowtype;
  v_tz text;
begin
  update public.bookings set status = 'cancelled', cancelled_at = now()
  where cancel_token_hash = p_cancel_token_hash and status = 'confirmed' and starts_at > now()
  returning * into v;
  if v.id is null then return false; end if;
  select timezone into v_tz from public.booking_pages where id = v.page_id;
  update public.calendar_events set status = 'cancelled' where id = v.calendar_event_id;
  insert into public.notification_outbox (workspace_id, user_id, kind, title, body, channels, dedupe_key, data)
  values (v.workspace_id, v.owner_id, 'booking.cancelled', 'Agendamento cancelado',
          v.guest_name || ' cancelou o horário de ' || to_char(v.starts_at at time zone coalesce(v_tz, 'America/Sao_Paulo'), 'DD/MM/YYYY "às" HH24:MI') || '.',
          '{dashboard}', 'booking-cancel:' || v.id::text, jsonb_build_object('bookingId', v.id));
  insert into public.audit_logs (workspace_id, actor_type, action, resource_type, resource_id)
  values (v.workspace_id, 'webhook', 'booking.cancelled', 'booking', v.id::text);
  return true;
end;
$$;
grant execute on function public.cancel_booking(text) to anon, authenticated;
