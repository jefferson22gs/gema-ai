import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
// Em CI usa o Chromium do Playwright; localmente pode usar o Chrome instalado (PW_CHANNEL=chrome).
const channel = process.env.PW_CHANNEL;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", ...(channel ? { channel } : {}) },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...(channel ? { channel } : {}) } },
    { name: "mobile", use: { ...devices["Pixel 7"], ...(channel ? { channel } : {}) } },
  ],
  webServer: {
    // Servidor de produção sem credenciais: valida estados "Não configurado" sem dados falsos.
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
