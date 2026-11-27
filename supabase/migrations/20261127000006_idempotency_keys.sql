-- GEMA AI — Idempotência genérica para APIs (cabeçalho Idempotency-Key).
-- Mesma chave + mesmo corpo ⇒ devolve a resposta gravada; corpo diferente ⇒ conflito; em andamento ⇒ 409.
-- Acesso só pelo servidor (service role): o cliente nunca lê respostas guardadas de outra requisição.

create table public.idempotency_keys (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  scope text not null check (char_length(scope) between 1 and 80),
  key text not null check (char_length(key) between 8 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'processing' check (status in ('processing', 'completed')),
  response_status int check (response_status between 100 and 599),
  response_body jsonb,
  locked_until timestamptz not null default now() + interval '2 minutes',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  unique (user_id, scope, key)
);
create index idempotency_keys_expires_idx on public.idempotency_keys (expires_at);

alter table public.idempotency_keys enable row level security;
revoke all on public.idempotency_keys from authenticated, anon;
comment on table public.idempotency_keys is 'Respostas de requisições com Idempotency-Key (24 h). Só service role.';
