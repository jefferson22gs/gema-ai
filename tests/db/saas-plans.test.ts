import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { isEntitled, listPublicPlans, planLimit, quote, requireEntitlement, saveCoupon, savePlan } from "@/server/billing/plans";
import { createInvitation } from "@/server/services/members";
import { createRule } from "@/server/automations/engine";
import { asUser, createTestDb, createUser } from "./harness";
import { pgliteDatabase } from "../support/pglite-db";

let pg: PGlite;
let db: Database;
let u: { id: string; personalWorkspaceId: string };
let familyId: string;
let businessId: string;
const ADMIN = "00000000-0000-4000-8000-0000000000ad";

const basePlan = {
  id: "teste_plano",
  name: "Teste",
  description: "Plano criado no teste.",
  price_cents: 1990,
  price_yearly_cents: 19900,
  trial_days: 7,
  features: ["finance", "whatsapp"],
  limits: { ai_messages_month: 100, ai_tokens_month: 200000, storage_mb: 100, automations: 1, members: 1, whatsapp_messages_month: 100, bank_connections: 0 },
  is_public: true,
  active: true,
  highlight: false,
  sort_order: 50,
  workspace_kinds: ["personal"],
};

async function setSub(ws: string, patch: string, params: unknown[] = []) {
  await pg.query(`update subscriptions set ${patch} where workspace_id = $1`, [ws, ...params]);
}

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  u = await createUser(pg, "assinante@gema.test");
  familyId = await asUser(pg, u.id, async (tx) => (await tx.query<{ id: string }>("select public.create_workspace('Casa', 'family') as id")).rows[0].id);
  businessId = await asUser(pg, u.id, async (tx) => (await tx.query<{ id: string }>("select public.create_workspace('Loja', 'business') as id")).rows[0].id);
});

describe("planos editáveis (SAAS-01)", () => {
  it("catálogo vem do banco: business público, executive fora de venda", async () => {
    const plans = await db.asService((q) => listPublicPlans(q));
    const ids = plans.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["essential", "premium", "family", "business"]));
    expect(ids).not.toContain("executive");
  });

  it("savePlan valida, grava e audita com antes/depois", async () => {
    await expect(savePlan(db, ADMIN, { ...basePlan, id: "X" })).rejects.toThrow(/id/);
    await expect(savePlan(db, ADMIN, { ...basePlan, features: ["inexistente"] })).rejects.toThrow(/desconhecidos/);
    const created = await savePlan(db, ADMIN, basePlan);
    expect(created.price_cents).toBe(1990);
    const updated = await savePlan(db, ADMIN, { ...basePlan, price_cents: 2490 });
    expect(updated.price_cents).toBe(2490);
    const { rows } = await pg.query<{ action: string; metadata: { before: { price_cents: number } | null } }>(
      "select action, metadata from audit_logs where resource_type = 'plan' and resource_id = 'teste_plano' order by id",
    );
    expect(rows.map((r) => r.action)).toEqual(["admin.plan.created", "admin.plan.updated"]);
    expect(rows[1].metadata.before?.price_cents).toBe(1990);
  });

  it("usuário comum não altera planos nem lê cupons", async () => {
    // Sem política de escrita: o update não alcança nenhuma linha.
    await asUser(pg, u.id, (tx) => tx.query("update plans set price_cents = 1 where id = 'premium'")).catch(() => undefined);
    const [p] = (await pg.query<{ price_cents: number }>("select price_cents from plans where id = 'premium'")).rows;
    expect(p.price_cents).not.toBe(1);
    await expect(savePlan(db, ADMIN, { ...basePlan, limits: { members: 1 } })).rejects.toThrow(/limits/); // todos os limites explícitos
    await expect(asUser(pg, u.id, (tx) => tx.query("select * from coupons"))).rejects.toThrow(/permission denied/);
  });
});

describe("cupons e cotação", () => {
  beforeAll(async () => {
    await saveCoupon(db, ADMIN, { code: "BEMVINDO20", description: null, percent_off: 20, amount_off_cents: null, duration_months: 3, plan_ids: [], cycles: ["monthly"], max_redemptions: null, valid_until: null, active: true });
    await saveCoupon(db, ADMIN, { code: "VENCIDO", description: null, percent_off: 10, amount_off_cents: null, duration_months: null, plan_ids: [], cycles: ["monthly", "yearly"], max_redemptions: null, valid_until: "2020-01-01T00:00:00.000Z", active: true });
    await saveCoupon(db, ADMIN, { code: "ESGOTADO", description: null, percent_off: null, amount_off_cents: 500, duration_months: null, plan_ids: [], cycles: ["monthly"], max_redemptions: 1, valid_until: null, active: true });
    await pg.query("update coupons set redeemed_count = 1 where code = 'ESGOTADO'");
    await saveCoupon(db, ADMIN, { code: "SOFAMILIA", description: null, percent_off: null, amount_off_cents: 999999, duration_months: null, plan_ids: ["family"], cycles: ["monthly"], max_redemptions: null, valid_until: null, active: true });
  });

  it("cupom exige percentual OU valor fixo", async () => {
    await expect(saveCoupon(db, ADMIN, { code: "AMBOS", description: null, percent_off: 10, amount_off_cents: 100, duration_months: null, plan_ids: [], cycles: ["monthly"], max_redemptions: null, valid_until: null, active: true })).rejects.toThrow(/OU/);
  });

  it("aplica percentual e rejeita expirado, esgotado, plano e ciclo errados", async () => {
    const [premium] = (await pg.query<{ price_cents: number }>("select price_cents from plans where id = 'premium'")).rows;
    const ok = await db.asService((q) => quote(q, "premium", "monthly", "bemvindo20"));
    expect(ok).toMatchObject({ coupon: "BEMVINDO20", couponError: null, discountMonths: 3 });
    expect(ok.discountCents).toBe(Math.round(premium.price_cents * 0.2));
    expect(ok.totalCents).toBe(premium.price_cents - ok.discountCents);
    expect((await db.asService((q) => quote(q, "premium", "monthly", "VENCIDO"))).couponError).toMatch(/expirado/);
    expect((await db.asService((q) => quote(q, "premium", "monthly", "ESGOTADO"))).couponError).toMatch(/esgotado/);
    expect((await db.asService((q) => quote(q, "premium", "monthly", "SOFAMILIA"))).couponError).toMatch(/plano/);
    expect((await db.asService((q) => quote(q, "premium", "monthly", "NAOEXISTE"))).couponError).toMatch(/inválido/);
    const errado = await db.asService((q) => quote(q, "teste_plano", "yearly", "BEMVINDO20"));
    expect(errado).toMatchObject({ couponError: expect.stringMatching(/anual/), discountCents: 0, totalCents: 19900 });
  });

  it("valor fixo nunca deixa o total negativo; plano inativo não cota", async () => {
    const q1 = await db.asService((q) => quote(q, "family", "monthly", "SOFAMILIA"));
    expect(q1.totalCents).toBe(0);
    await expect(db.asService((q) => quote(q, "executive", "monthly"))).rejects.toThrow(/indisponível/);
  });
});

describe("entitlements e limites (aplicados no servidor)", () => {
  it("create_workspace usa o plano do tipo e o workspace acompanha a assinatura", async () => {
    const { rows } = await pg.query<{ id: string; plan_id: string; sub: string }>(
      "select w.id, w.plan_id, s.plan_id as sub from workspaces w join subscriptions s on s.workspace_id = w.id where w.id = any($1)",
      [[familyId, businessId, u.personalWorkspaceId]],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[familyId]).toMatchObject({ plan_id: "family", sub: "family" });
    expect(byId[businessId]).toMatchObject({ plan_id: "business", sub: "business" });
    expect(byId[u.personalWorkspaceId]).toMatchObject({ plan_id: "premium", sub: "premium" });
    await setSub(u.personalWorkspaceId, "plan_id = 'essential'");
    const [ws] = (await pg.query<{ plan_id: string }>("select plan_id from workspaces where id = $1", [u.personalWorkspaceId])).rows;
    expect(ws.plan_id).toBe("essential");
    await setSub(u.personalWorkspaceId, "plan_id = 'premium'");
  });

  it("recurso pago depende do plano e do estado da assinatura; core sempre liberado", async () => {
    const ws = u.personalWorkspaceId;
    const check = (f: string) => db.asUser(u.id, (q) => isEntitled(q, ws, f));
    expect(await check("open_finance")).toBe(true); // trial do Premium
    expect(await check("family")).toBe(false); // fora do plano
    await setSub(ws, "trial_ends_at = now() - interval '1 day'");
    expect(await check("open_finance")).toBe(false); // trial vencido
    expect(await check("finance")).toBe(true); // core: dados continuam acessíveis
    await setSub(ws, "status = 'past_due', grace_until = now() + interval '3 days'");
    expect(await check("open_finance")).toBe(true); // carência
    await setSub(ws, "grace_until = now() - interval '1 minute'");
    expect(await check("open_finance")).toBe(false);
    await expect(db.asUser(u.id, (q) => requireEntitlement(q, ws, "open_finance", "Open Finance"))).rejects.toThrow(/não está incluído/);
    await setSub(ws, "status = 'active', grace_until = null");
    expect(await check("open_finance")).toBe(true);
  });

  it("limite efetivo soma add-ons", async () => {
    const ws = u.personalWorkspaceId;
    expect(await db.asUser(u.id, (q) => planLimit(q, ws, "bank_connections"))).toBe(5);
    await pg.query("insert into plan_addons (id, name, description, price_cents, limits_delta) values ('mais_bancos', '+3 bancos', 'Conexões extras.', 990, '{\"bank_connections\": 3}')");
    await pg.query("insert into subscription_addons (subscription_id, addon_id, quantity) select id, 'mais_bancos', 2 from subscriptions where workspace_id = $1", [ws]);
    expect(await db.asUser(u.id, (q) => planLimit(q, ws, "bank_connections"))).toBe(11);
    // Add-on de uma assinatura é visível ao membro, mas não editável.
    await expect(asUser(pg, u.id, (tx) => tx.query("delete from subscription_addons"))).rejects.toThrow(/permission denied/);
  });

  it("automação respeita o limite do plano", async () => {
    const ws = businessId;
    await pg.query("update plans set limits = limits || '{\"automations\": 1}'::jsonb where id = 'business'");
    const base = { workspaceId: ws, ownerId: u.id, channels: ["dashboard"], timezone: "America/Sao_Paulo", now: new Date() };
    await db.asUser(u.id, (q) => createRule(q, { ...base, template: "daily_briefing" }));
    await expect(db.asUser(u.id, (q) => createRule(q, { ...base, template: "weekly_summary" }))).rejects.toThrow(/Limite do plano.*automações/);
  });

  it("convite respeita entitlement de equipe e limite de membros", async () => {
    await expect(db.asUser(u.id, (q) => createInvitation(q, { workspaceId: familyId, invitedBy: u.id, email: "a@casa.test", role: "family" }))).resolves.toBeTruthy();
    await pg.query("update plans set limits = limits || '{\"members\": 2}'::jsonb where id = 'family'");
    // Reenviar ao mesmo e-mail não conta duas vezes (o convite antigo é substituído).
    await expect(db.asUser(u.id, (q) => createInvitation(q, { workspaceId: familyId, invitedBy: u.id, email: "a@casa.test", role: "family" }))).resolves.toBeTruthy();
    await expect(db.asUser(u.id, (q) => createInvitation(q, { workspaceId: familyId, invitedBy: u.id, email: "b@casa.test", role: "family" }))).rejects.toThrow(/Limite do plano/);
    await setSub(familyId, "status = 'cancelled'");
    await expect(db.asUser(u.id, (q) => createInvitation(q, { workspaceId: familyId, invitedBy: u.id, email: "c@casa.test", role: "family" }))).rejects.toThrow(/não está incluído/);
  });
});
