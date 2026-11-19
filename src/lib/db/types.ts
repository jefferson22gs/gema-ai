/**
 * Contrato mínimo de acesso a dados. Implementado por postgres.js (produção, Supabase)
 * e por PGlite (testes). Toda operação de cliente roda em `asUser` (role authenticated +
 * claims JWT => RLS ativa). `asService` (role service_role) é restrito a webhooks, jobs e admin.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Database {
  asUser<T>(userId: string, fn: (q: Queryable) => Promise<T>): Promise<T>;
  asService<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("Banco de dados não configurado (DATABASE_URL ausente).");
    this.name = "DatabaseNotConfiguredError";
  }
}
