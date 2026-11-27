import { z } from "zod";
import type { Database, Queryable } from "@/lib/db/types";
import { DomainError } from "../context";

/**
 * Planos e entitlements do SaaS. Preços e limites vivem no banco (editáveis no Super Admin) —
 * nada de preço fixo no código. Toda checagem de acesso a recurso pago é feita no servidor.
 */
export const LIMIT_KEYS = ["ai_messages_month", "ai_tokens_month", "storage_mb", "automations", "members", "whatsapp_messages_month", "bank_connections"] as const;

export const planSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{3,40}$/, "id: minúsculas, números e _ (3–40)"),
  name: z.string().min(2).max(60),
  description: z.string().min(5).max(300),
  price_cents: z.number().int().min(0).max(100_000_00),
  price_yearly_cents: z.number().int().min(0).max(1_000_000_00).nullable(),
  trial_days: z.number().int().min(0).max(90),
  features: z.array(z.string()).max(40),
  limits: z.record(z.enum(LIMIT_KEYS), z.number().int().min(0)),
  is_public: z.boolean(),
  active: z.boolean(),
  highlight: z.boolean(),
  sort_order: z.number().int().min(0).max(1000),
  workspace_kinds: z.array(z.enum(["personal", "family", "professional", "business"])).min(1),
});
export type PlanInput = z.infer<typeof planSchema>;

export interface PlanRow extends PlanInput {
  created_at: Date;
  updated_at: Date;
}

export async function listAllPlans(q: Queryable): Promise<PlanRow[]> {
  return q.query<PlanRow>(
    `select id, name, description, price_cents, price_yearly_cents, trial_days, features, limits, is_public, active, highlight, sort_order,
       workspace_kinds, created_at, updated_at from plans order by sort_order, id`,
  );
}

export async function listPublicPlans(q: Queryable): Promise<PlanRow[]> {
  return (await listAllPlans(q)).filter((p) => p.is_public && p.active);
}

export async function listFeatures(q: Queryable) {
  return q.query<{ key: string; label: string; description: string; core: boolean }>("select key, label, description, core from plan_features order by sort_order");
}

/** Upsert de plano pelo Super Admin (service role), validado e auditado. */
export async function savePlan(db: Database, adminId: string, input: unknown): Promise<PlanRow> {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const p = parsed.data;
  return db.asService(async (q) => {
    const known = new Set((await listFeatures(q)).map((f) => f.key));
    const unknown = p.features.filter((f) => !known.has(f));
    if (unknown.length) throw new DomainError("invalid", `Recursos desconhecidos: ${unknown.join(", ")}`);
    const before = (await q.query<PlanRow>("select * from plans where id = $1", [p.id]))[0] ?? null;
    const [row] = await q.query<PlanRow>(
      `insert into plans (id, name, description, price_cents, price_yearly_cents, trial_days, features, limits, is_public, active, highlight, sort_order, workspace_kinds)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (id) do update set name = excluded.name, description = excluded.description, price_cents = excluded.price_cents,
         price_yearly_cents = excluded.price_yearly_cents, trial_days = excluded.trial_days, features = excluded.features, limits = excluded.limits,
         is_public = excluded.is_public, active = excluded.active, highlight = excluded.highlight, sort_order = excluded.sort_order,
         workspace_kinds = excluded.workspace_kinds
       returning id, name, description, price_cents, price_yearly_cents, trial_days, features, limits, is_public, active, highlight, sort_order, workspace_kinds, created_at, updated_at`,
      [p.id, p.name, p.description, p.price_cents, p.price_yearly_cents, p.trial_days, p.features, JSON.stringify(p.limits), p.is_public, p.active, p.highlight, p.sort_order, p.workspace_kinds],
    );
    await q.query(
      "insert into audit_logs (actor_id, actor_type, action, resource_type, resource_id, metadata) values ($1, 'admin', $2, 'plan', $3, $4)",
      [adminId, before ? "admin.plan.updated" : "admin.plan.created", p.id, JSON.stringify({ before: before ? { price_cents: before.price_cents, features: before.features, limits: before.limits } : null, after: { price_cents: p.price_cents, features: p.features, limits: p.limits } })],
    );
    return row;
  });
}

// ---------------------------------------------------------------- Cupons

export const couponSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_-]{3,32}$/, "código: maiúsculas, números, _ e - (3–32)"),
  description: z.string().max(200).nullable(),
  percent_off: z.number().int().min(1).max(100).nullable(),
  amount_off_cents: z.number().int().min(1).nullable(),
  duration_months: z.number().int().min(1).max(36).nullable(),
  plan_ids: z.array(z.string()).max(20),
  cycles: z.array(z.enum(["monthly", "yearly"])).min(1),
  max_redemptions: z.number().int().min(1).nullable(),
  valid_until: z.string().datetime().nullable(),
  active: z.boolean(),
}).refine((c) => (c.percent_off === null) !== (c.amount_off_cents === null), "Informe percentual OU valor fixo.");

export async function saveCoupon(db: Database, adminId: string, input: unknown) {
  const parsed = couponSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid", parsed.error.issues.map((i) => i.message).join("; "));
  const c = parsed.data;
  await db.asService(async (q) => {
    await q.query(
      `insert into coupons (code, description, percent_off, amount_off_cents, duration_months, plan_ids, cycles, max_redemptions, valid_until, active)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (code) do update set description = excluded.description, percent_off = excluded.percent_off, amount_off_cents = excluded.amount_off_cents,
         duration_months = excluded.duration_months, plan_ids = excluded.plan_ids, cycles = excluded.cycles, max_redemptions = excluded.max_redemptions,
         valid_until = excluded.valid_until, active = excluded.active`,
      [c.code, c.description, c.percent_off, c.amount_off_cents, c.duration_months, c.plan_ids, c.cycles, c.max_redemptions, c.valid_until, c.active],
    );
    await q.query("insert into audit_logs (actor_id, actor_type, action, resource_type, resource_id) values ($1, 'admin', 'admin.coupon.saved', 'coupon', $2)", [adminId, c.code]);
  });
}

export async function listCoupons(q: Queryable) {
  return q.query<{ code: string; description: string | null; percent_off: number | null; amount_off_cents: number | null; duration_months: number | null; plan_ids: string[]; cycles: string[]; max_redemptions: number | null; redeemed_count: number; valid_until: Date | null; active: boolean }>(
    "select code, description, percent_off, amount_off_cents, duration_months, plan_ids, cycles, max_redemptions, redeemed_count, valid_until, active from coupons order by created_at desc limit 100",
  );
}

export interface PriceQuote {
  planId: string;
  cycle: "monthly" | "yearly";
  baseCents: number;
  discountCents: number;
  totalCents: number;
  coupon: string | null;
  couponError: string | null;
  /** Meses em que o desconto vale (null = indeterminado/único ciclo). */
  discountMonths: number | null;
}

/** Cotação determinística (sem cobrança): preço do plano no ciclo, aplicando cupom válido. */
export async function quote(q: Queryable, planId: string, cycle: "monthly" | "yearly", couponCode?: string | null, now = new Date()): Promise<PriceQuote> {
  const [plan] = await q.query<{ price_cents: number; price_yearly_cents: number | null; active: boolean }>(
    "select price_cents, price_yearly_cents, active from plans where id = $1", [planId],
  );
  if (!plan || !plan.active) throw new DomainError("not_found", "Plano indisponível.");
  if (cycle === "yearly" && plan.price_yearly_cents === null) throw new DomainError("invalid", "Plano sem opção anual.");
  const base = cycle === "yearly" ? plan.price_yearly_cents! : plan.price_cents;
  let discount = 0;
  let couponError: string | null = null;
  let applied: string | null = null;
  let months: number | null = null;
  if (couponCode) {
    const code = couponCode.trim().toUpperCase();
    const [c] = await q.query<{ code: string; percent_off: number | null; amount_off_cents: number | null; duration_months: number | null; plan_ids: string[]; cycles: string[]; max_redemptions: number | null; redeemed_count: number; valid_until: Date | null; active: boolean }>(
      "select code, percent_off, amount_off_cents, duration_months, plan_ids, cycles, max_redemptions, redeemed_count, valid_until, active from coupons where code = $1",
      [code],
    );
    if (!c || !c.active) couponError = "Cupom inválido.";
    else if (c.valid_until && new Date(c.valid_until) < now) couponError = "Cupom expirado.";
    else if (c.max_redemptions !== null && c.redeemed_count >= c.max_redemptions) couponError = "Cupom esgotado.";
    else if (c.plan_ids.length && !c.plan_ids.includes(planId)) couponError = "Cupom não vale para este plano.";
    else if (!c.cycles.includes(cycle)) couponError = cycle === "yearly" ? "Cupom não vale para o plano anual." : "Cupom não vale para o plano mensal.";
    else {
      discount = c.percent_off !== null ? Math.round((base * c.percent_off) / 100) : Math.min(base, c.amount_off_cents ?? 0);
      applied = c.code;
      months = c.duration_months;
    }
  }
  return { planId, cycle, baseCents: base, discountCents: discount, totalCents: base - discount, coupon: applied, couponError, discountMonths: months };
}

// ---------------------------------------------------------------- Entitlements e limites

export async function isEntitled(q: Queryable, workspaceId: string, feature: string): Promise<boolean> {
  const [r] = await q.query<{ ok: boolean }>("select app.entitled($1, $2) as ok", [workspaceId, feature]);
  return r.ok;
}

/** Lança erro de domínio "limit" quando o recurso não está no plano (mensagem pronta para UI/IA). */
export async function requireEntitlement(q: Queryable, workspaceId: string, feature: string, label: string): Promise<void> {
  if (!(await isEntitled(q, workspaceId, feature))) {
    throw new DomainError("limit", `${label} não está incluído no plano atual deste workspace (ou a assinatura não está ativa). Veja Assinatura.`);
  }
}

export async function planLimit(q: Queryable, workspaceId: string, key: (typeof LIMIT_KEYS)[number]): Promise<number | null> {
  const [r] = await q.query<{ v: number | null }>("select app.plan_limit($1, $2) as v", [workspaceId, key]);
  return r?.v ?? null;
}

/** Checa limite de quantidade (ex.: membros, conexões bancárias, automações). */
export async function requireUnderLimit(q: Queryable, workspaceId: string, key: (typeof LIMIT_KEYS)[number], current: number, label: string): Promise<void> {
  const limit = await planLimit(q, workspaceId, key);
  if (limit !== null && current >= limit) throw new DomainError("limit", `Limite do plano atingido: ${label} (${limit}).`);
}
