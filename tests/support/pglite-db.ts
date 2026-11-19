import type { PGlite, Transaction } from "@electric-sql/pglite";
import type { Database, Queryable } from "@/lib/db/types";

function wrap(tx: Transaction): Queryable {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const res = await tx.query<T>(text, params);
      return res.rows;
    },
  };
}

/** Adaptador Database sobre PGlite: mesma semântica de RLS/roles da produção. */
export function pgliteDatabase(pg: PGlite): Database {
  return {
    asUser(userId, fn) {
      return pg.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
        await tx.exec("set local role authenticated");
        return fn(wrap(tx));
      });
    },
    asService(fn) {
      return pg.transaction(async (tx) => {
        await tx.exec("set local role service_role");
        return fn(wrap(tx));
      });
    },
  };
}
