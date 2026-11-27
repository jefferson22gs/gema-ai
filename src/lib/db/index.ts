import "server-only";
import postgres from "postgres";
import { DatabaseNotConfiguredError, type Database, type Queryable } from "./types";

export type { Database, Queryable } from "./types";
export { DatabaseNotConfiguredError } from "./types";

type Sql = ReturnType<typeof postgres>;

let pool: Sql | null = null;

function getPool(): Sql | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (!pool) {
    pool = postgres(url, {
      // Supabase pooler (transaction mode) não suporta prepared statements.
      prepare: false,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: 10,
      types: {
        // int8 (centavos, contagens) como number; datas como string YYYY-MM-DD.
        bigint: { from: [20], parse: (raw: string) => Number(raw), serialize: (v: number) => String(v), to: 20 },
        date: { from: [1082], parse: (raw: string) => raw, serialize: (v: string) => v, to: 1082 },
      },
    });
  }
  return pool;
}

function wrap(sql: Sql): Queryable {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await sql.unsafe(text, params as never[]);
      return rows as unknown as T[];
    },
  };
}

export const db: Database = {
  async asUser(userId, fn) {
    const sql = getPool();
    if (!sql) throw new DatabaseNotConfiguredError();
    return (await sql.begin(async (tx) => {
      await tx.unsafe("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
      await tx.unsafe("set local role authenticated");
      return fn(wrap(tx as unknown as Sql));
    })) as Awaited<ReturnType<typeof fn>>;
  },
  async asService(fn) {
    const sql = getPool();
    if (!sql) throw new DatabaseNotConfiguredError();
    return (await sql.begin(async (tx) => {
      await tx.unsafe("set local role service_role");
      return fn(wrap(tx as unknown as Sql));
    })) as Awaited<ReturnType<typeof fn>>;
  },
  async asAnon(fn) {
    const sql = getPool();
    if (!sql) throw new DatabaseNotConfiguredError();
    return (await sql.begin(async (tx) => {
      await tx.unsafe("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)");
      await tx.unsafe("set local role anon");
      return fn(wrap(tx as unknown as Sql));
    })) as Awaited<ReturnType<typeof fn>>;
  },
};

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
