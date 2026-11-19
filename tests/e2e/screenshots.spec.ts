import { test } from "@playwright/test";

/**
 * Gera capturas do ambiente real de teste (sem dados fictícios) para docs/ajuda.
 * Execução: SCREENSHOTS=1 npx playwright test screenshots --project=desktop
 */
test.skip(!process.env.SCREENSHOTS, "somente sob demanda");

const pages = [
  ["home", "/"],
  ["planos", "/planos"],
  ["entrar", "/entrar"],
  ["painel-nao-configurado", "/app"],
] as const;

for (const [name, path] of pages) {
  test(`captura ${name}`, async ({ page }, info) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `docs/screenshots/${info.project.name}-${name}.png`, fullPage: false });
  });
}
