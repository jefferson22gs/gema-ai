import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite, types, type Transaction } from "@electric-sql/pglite";

/**
 * Banco Postgres real (PGlite/WASM) com stubs mínimos do Supabase (auth/storage/roles)
 * para aplicar as migrations versionadas e testar RLS de verdade.
 */
const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
`;

export async function createTestDb(): Promise<PGlite> {
  // Mesmos parsers da produção (src/lib/db): int8 => number, date => "YYYY-MM-DD".
  const db = new PGlite({ parsers: { [types.INT8]: (x: string) => Number(x), [types.DATE]: (x: string) => x } });
  await db.exec(SUPABASE_STUBS);
  const dir = join(process.cwd(), "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }
  return db;
}

export async function createUser(db: PGlite, email: string): Promise<{ id: string; personalWorkspaceId: string }> {
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify({ full_name: email.split("@")[0] })],
  );
  const id = rows[0].id;
  const ws = await db.query<{ id: string }>(
    "select id from public.workspaces where created_by = $1 and kind = 'personal'",
    [id],
  );
  return { id, personalWorkspaceId: ws.rows[0].id };
}

/** Executa como usuário autenticado (role authenticated + JWT sub), sujeito à RLS. */
export async function asUser<T>(db: PGlite, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}

export async function asAnon<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    return fn(tx);
  });
}
