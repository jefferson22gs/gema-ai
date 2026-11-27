import { DomainError, type ServiceDeps } from "../context";
import { categorize, learnedPattern, type CategoryRule, type ParsedStatement } from "../finance/statement-import";

export interface ImportPreviewRow {
  date: string;
  description: string;
  amountCents: number;
  kind: "expense" | "income";
  externalId: string;
  duplicate: boolean;
  categoryId: string | null;
  categoryName: string | null;
}

export interface ImportPreview {
  source: string;
  format: ParsedStatement["format"];
  rows: ImportPreviewRow[];
  newCount: number;
  duplicateCount: number;
  skipped: ParsedStatement["skipped"];
}

/** Regras do usuário (próprias e do workspace visíveis), com o tipo da categoria para não cruzar despesa/receita. */
export async function loadRules({ q, ctx }: ServiceDeps): Promise<(CategoryRule & { name: string })[]> {
  const rows = await q.query<{ pattern: string; category_id: string; kind: "expense" | "income"; name: string }>(
    `select r.pattern, r.category_id, c.kind, c.name from categorization_rules r join categories c on c.id = r.category_id
     where r.workspace_id = $1 and r.enabled`,
    [ctx.workspaceId],
  );
  return rows.map((r) => ({ pattern: r.pattern, categoryId: r.category_id, kind: r.kind, name: r.name }));
}

/** Prévia sem gravar: marca o que já existe (mesma origem + id externo) e sugere categoria pelas regras. */
export async function previewImport(deps: ServiceDeps, parsed: ParsedStatement): Promise<ImportPreview> {
  const ids = parsed.rows.map((r) => r.externalId);
  const existing = new Set(
    (await deps.q.query<{ external_id: string }>(
      "select external_id from transactions where workspace_id = $1 and external_source = $2 and external_id = any($3::text[])",
      [deps.ctx.workspaceId, parsed.source, ids],
    )).map((r) => r.external_id),
  );
  const rules = await loadRules(deps);
  const names = new Map(rules.map((r) => [r.categoryId, r.name]));
  const rows = parsed.rows.map((r) => {
    const categoryId = categorize(r.description, r.kind, rules);
    return { ...r, duplicate: existing.has(r.externalId), categoryId, categoryName: categoryId ? names.get(categoryId) ?? null : null };
  });
  const duplicateCount = rows.filter((r) => r.duplicate).length;
  return { source: parsed.source, format: parsed.format, rows, newCount: rows.length - duplicateCount, duplicateCount, skipped: parsed.skipped };
}

/**
 * Grava a importação. Idempotente: o índice único (workspace, external_source, external_id) faz reenvios e períodos
 * sobrepostos virarem "já existia". Sem categoria pela regra, cai em "Outros" do tipo.
 */
export async function commitImport(deps: ServiceDeps, parsed: ParsedStatement, opts: { accountId?: string | null } = {}) {
  const { q, ctx } = deps;
  if (opts.accountId) {
    const [acc] = await q.query("select 1 from financial_accounts where id = $1 and workspace_id = $2", [opts.accountId, ctx.workspaceId]);
    if (!acc) throw new DomainError("not_found", "Conta não encontrada.");
  }
  const preview = await previewImport(deps, parsed);
  const fallback = Object.fromEntries(
    (await q.query<{ id: string; kind: string }>("select id, kind from categories where workspace_id is null and slug in ('outros-despesa', 'outros-receita')"))
      .map((r) => [r.kind, r.id]),
  );
  let inserted = 0;
  for (const r of preview.rows) {
    if (r.duplicate) continue;
    const rows = await q.query(
      `insert into transactions (workspace_id, owner_id, kind, description, amount_cents, category_id, account_id, occurred_on, status,
         source, external_source, external_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'paid', 'import', $9, $10)
       on conflict (workspace_id, external_source, external_id) where external_id is not null do nothing
       returning id`,
      [ctx.workspaceId, ctx.userId, r.kind, r.description, r.amountCents, r.categoryId ?? fallback[r.kind] ?? null, opts.accountId ?? null, r.date, parsed.source, r.externalId],
    );
    inserted += rows.length;
  }
  await q.query("select public.write_audit($1, 'user', 'finance.statement.imported', 'transaction', null, $2)", [
    ctx.workspaceId, JSON.stringify({ format: parsed.format, inserted, duplicates: preview.rows.length - inserted, skipped: parsed.skipped.length }),
  ]);
  return { inserted, duplicates: preview.rows.length - inserted, skipped: parsed.skipped.length };
}

/**
 * Corrige a categoria de um lançamento e, opcionalmente, aprende uma regra para o mesmo estabelecimento
 * (FIN-10). A regra vale para próximas importações e lançamentos sem categoria.
 */
export async function recategorize(deps: ServiceDeps, transactionId: string, categoryId: string, learn: boolean) {
  const { q, ctx } = deps;
  const [tx] = await q.query<{ description: string; kind: string }>(
    "select description, kind from transactions where id = $1 and workspace_id = $2 and deleted_at is null", [transactionId, ctx.workspaceId],
  );
  if (!tx) throw new DomainError("not_found", "Lançamento não encontrado.");
  const [cat] = await q.query<{ kind: string }>(
    "select kind from categories where id = $1 and (workspace_id is null or workspace_id = $2)", [categoryId, ctx.workspaceId],
  );
  if (!cat || cat.kind !== tx.kind) throw new DomainError("invalid", "Categoria incompatível com o tipo do lançamento.");
  const updated = await q.query("update transactions set category_id = $3 where id = $1 and workspace_id = $2 returning id", [transactionId, ctx.workspaceId, categoryId]);
  if (!updated.length) throw new DomainError("forbidden", "Sem permissão para alterar este lançamento.");
  let pattern: string | null = null;
  if (learn && (pattern = learnedPattern(tx.description))) {
    await q.query(
      `insert into categorization_rules (workspace_id, owner_id, pattern, category_id, origin) values ($1, $2, $3, $4, 'learned')
       on conflict (workspace_id, owner_id, pattern) do update set category_id = excluded.category_id, enabled = true, hits = categorization_rules.hits + 1`,
      [ctx.workspaceId, ctx.userId, pattern, categoryId],
    );
  }
  return { learnedPattern: pattern };
}

export async function listRules({ q, ctx }: ServiceDeps) {
  return q.query<{ id: string; pattern: string; category_name: string; origin: string; enabled: boolean; hits: number }>(
    `select r.id, r.pattern, c.name as category_name, r.origin, r.enabled, r.hits from categorization_rules r
     join categories c on c.id = r.category_id where r.workspace_id = $1 order by r.updated_at desc limit 200`,
    [ctx.workspaceId],
  );
}

export async function deleteRule({ q, ctx }: ServiceDeps, id: string) {
  const rows = await q.query("delete from categorization_rules where id = $1 and workspace_id = $2 returning id", [id, ctx.workspaceId]);
  return rows.length > 0;
}
