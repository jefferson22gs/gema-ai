import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PUBLIC_PAGES = ["/", "/recursos", "/como-funciona", "/demo", "/planos", "/seguranca", "/privacidade", "/termos", "/contato", "/entrar", "/cadastro"];

test.describe("site público (critério 13)", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} carrega, tem h1 e passa acessibilidade básica`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    });
  }

  test("sem rolagem horizontal no mobile", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("demonstração é sinalizada como ilustrativa", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Demonstração ilustrativa")).toBeVisible();
  });

  test("/demo: dados fictícios sinalizados, módulos navegáveis e nenhuma chamada externa", async ({ page }) => {
    const external: string[] = [];
    const api: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") external.push(r.url());
      else if (u.pathname.startsWith("/api/")) api.push(u.pathname);
    });
    await page.goto("/demo");
    await expect(page.getByText("Dados fictícios")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Saldo projetado (45 dias)" })).toBeVisible();

    await page.getByRole("tab", { name: "Cartões" }).click();
    await page.getByLabel("Valor (R$)").fill("30000");
    await expect(page.getByText("Ultrapassa o limite")).toBeVisible();
    await page.getByLabel("Valor (R$)").fill("600");
    await expect(page.getByText("Cabe no limite")).toBeVisible();

    await page.getByRole("tab", { name: "Assistente" }).click();
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: /^Enviar:/ }).click();
    await expect(page.getByText(/não são executados pela IA/)).toBeVisible();
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText(/nada é gravado/)).toBeVisible();

    await page.getByRole("tab", { name: "Metas e dívidas" }).click();
    await expect(page.getByText("Reserva de emergência")).toBeVisible();
    await page.getByRole("tab", { name: "Agenda" }).click();
    await expect(page.getByText("conflito")).toBeVisible();

    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    expect(external).toEqual([]);
    expect(api).toEqual([]);
  });

  test("agenda pública: endereço inválido mostra não encontrado; cancelamento exige token e não indexa", async ({ page }) => {
    // notFound() dentro de <Suspense> (streaming) mantém status 200 e o Next adiciona noindex — comportamento documentado.
    await page.goto("/agendar/Nome%20Invalido!");
    await expect(page.getByText(/404|não encontrad/i).first()).toBeVisible();
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    await page.goto("/agendar/cancelar");
    await expect(page.getByText("Link de cancelamento incompleto.")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("tema claro alterna e persiste", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Ativar tema claro" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

test.describe("estados não configurados", () => {
  test("login informa Supabase não configurado e desabilita envio", async ({ page }) => {
    await page.goto("/entrar");
    await expect(page.getByText("Instalação sem Supabase")).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeDisabled();
  });

  test("painel mostra instrução de configuração em vez de dados falsos", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Painel indisponível nesta instalação" })).toBeVisible();
  });

  test("health expõe status sem segredos", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.database).toBe("not_configured");
    expect(body.integrations.gemini).toBe("not_configured");
    expect(JSON.stringify(body)).not.toMatch(/key|secret|token/i);
  });

  test("webhooks sem configuração recusam processamento", async ({ request }) => {
    for (const p of ["/api/webhooks/evolution", "/api/webhooks/meta", "/api/webhooks/resend", "/api/webhooks/brevo", "/api/webhooks/whaileys", "/api/webhooks/pluggy"]) {
      const res = await request.post(p, { data: { event: "messages.upsert" } });
      expect(res.status(), p).toBe(503);
    }
  });

  test("dispatch de automações exige segredo", async ({ request }) => {
    const res = await request.post("/api/automations/dispatch");
    expect([401, 503]).toContain(res.status());
  });

  test("chat exige mesma origem e autenticação", async ({ request }) => {
    const res = await request.post("/api/ai/chat", { data: { action: "message" } });
    expect(res.status()).toBe(403);
  });
});

test.describe("PWA", () => {
  test("manifest válido, ícones e service worker acessíveis", async ({ request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/app");
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
    const sw = await request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expect(await sw.text()).not.toContain("/api/");
    expect((await request.get("/offline")).status()).toBe(200);
  });

  test("headers de segurança presentes", async ({ request }) => {
    const res = await request.get("/");
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-powered-by"]).toBeUndefined();
  });
});
