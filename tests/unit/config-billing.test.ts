import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hmacSha256Hex } from "@/lib/crypto";
import { integrationConfig, isConfigured } from "@/lib/env";
import { applyBillingEvent, billingProvider, SignedEnvelopeBillingProvider } from "@/server/billing/provider";
import { getDefaultModel } from "@/server/ai/model";
import { sniffMime, validateUpload } from "@/server/services/documents";
import { createTestDb, createUser } from "../db/harness";
import { pgliteDatabase } from "../support/pglite-db";

afterEach(() => vi.unstubAllEnvs());

describe("integrações sem credenciais (feature flags por ambiente)", () => {
  it("todas aparecem como não configuradas e não derrubam o app", () => {
    for (const k of ["GEMINI_API_KEY", "RESEND_API_KEY", "BREVO_API_KEY", "EVOLUTION_API_URL", "GOOGLE_CLIENT_ID", "BILLING_PROVIDER", "WHAILEYS_TOKEN"]) vi.stubEnv(k, "");
    const cfg = integrationConfig();
    expect(cfg.every((i) => i.key === "supabase" || !i.configured)).toBe(true);
    expect(cfg.find((i) => i.key === "baileys_whaileys")?.missing).toContain("WHAILEYS_TOKEN");
    expect(getDefaultModel()).toBeNull();
    expect(billingProvider().name).toBe("none");
  });

  it("Google exige as quatro variáveis, incluindo a chave de criptografia", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "x");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "y");
    vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "https://a/cb");
    vi.stubEnv("OAUTH_ENCRYPTION_KEY", "");
    expect(isConfigured("google")).toBe(false);
    expect(integrationConfig().find((i) => i.key === "google")?.missing).toEqual(["OAUTH_ENCRYPTION_KEY"]);
  });

  it("checkout sem provedor não simula cobrança", async () => {
    vi.stubEnv("BILLING_PROVIDER", "");
    const r = await billingProvider().createCheckout("w", "premium", "/");
    expect(r).toEqual({ error: expect.stringContaining("Nenhum pagamento foi processado") });
  });
});

describe("billing por webhook assinado", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  });

  it("aplica pagamento uma única vez e entra em carência em falha", async () => {
    const db = pgliteDatabase(pg);
    const u = await createUser(pg, "bill@example.test");
    const now = Math.floor(Date.now() / 1000);
    const provider = new SignedEnvelopeBillingProvider("demo-gateway", "s3cret");
    const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", workspaceId: u.personalWorkspaceId, planId: "premium" });
    const bad = provider.verifyWebhook(body, new Headers({ "x-gema-signature": `t=${now},v1=00` }));
    expect(bad.ok).toBe(false);
    const ok = provider.verifyWebhook(body, new Headers({ "x-gema-signature": `t=${now},v1=${hmacSha256Hex("s3cret", `${now}.${body}`)}` }));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(await applyBillingEvent(db, provider.name, ok.event)).toBe("applied");
    expect(await applyBillingEvent(db, provider.name, ok.event)).toBe("duplicate");
    const sub = await pg.query<{ status: string; plan_id: string }>("select status, plan_id from subscriptions where workspace_id = $1", [u.personalWorkspaceId]);
    expect(sub.rows[0]).toEqual({ status: "active", plan_id: "premium" });

    await applyBillingEvent(db, provider.name, { id: "evt_2", type: "invoice.payment_failed", workspaceId: u.personalWorkspaceId });
    const late = await pg.query<{ status: string; grace_until: Date | null }>("select status, grace_until from subscriptions where workspace_id = $1", [u.personalWorkspaceId]);
    expect(late.rows[0].status).toBe("past_due");
    expect(late.rows[0].grace_until).not.toBeNull();
  });
});

describe("validação de upload", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  it("aceita PDF real e rejeita MIME falsificado", () => {
    expect(sniffMime(pdf)).toBe("application/pdf");
    expect(validateUpload("Recibo ção.pdf", "application/pdf", pdf).safeName).toBe("Recibo-cao.pdf");
    expect(() => validateUpload("x.png", "image/png", pdf)).toThrow(/não corresponde/);
    expect(() => validateUpload("x.exe", "application/x-msdownload", pdf)).toThrow(/não permitido/);
  });
});
