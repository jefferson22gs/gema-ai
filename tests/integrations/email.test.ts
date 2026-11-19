import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { BrevoProvider, ResendProvider } from "@/server/email/providers";
import { applyEmailWebhook, sendEmail } from "@/server/email/service";
import { createTestDb } from "../db/harness";
import { pgliteDatabase } from "../support/pglite-db";
import type { PGlite } from "@electric-sql/pglite";

let pg: PGlite;
let db: Database;

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
});

/** fetch de teste que responde conforme a URL e registra as chamadas. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body ?? "null")) });
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (!key) throw new Error(`rota inesperada ${u}`);
    return routes[key]();
  }) as typeof fetch;
  return { impl, calls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const base = { from: "GEMA AI <no-reply@exemplo.test>", appUrl: "https://app.exemplo.test" };

describe("e-mail com fallback e idempotência (critério 7)", () => {
  it("Resend recusa (4xx) e Brevo envia com a mesma chave de idempotência", async () => {
    const f = fakeFetch({
      "api.resend.com": () => json(422, { message: "invalid from" }),
      "api.brevo.com": () => json(201, { messageId: "<brevo-1@relay>" }),
    });
    const res = await sendEmail(
      { db, ...base, providers: [new ResendProvider("re_test", f.impl), new BrevoProvider("brevo_test", f.impl)] },
      { template: "welcome", to: "ana@exemplo.test", data: { name: "Ana" }, eventKey: "signup:1" },
    );
    expect(res.status).toBe("accepted");
    expect(res.provider).toBe("brevo");
    expect(res.attempts.map((a) => `${a.provider}:${a.outcome}`)).toEqual(["resend:rejected", "brevo:accepted"]);
    const resendKey = f.calls[0].headers["idempotency-key"];
    expect(resendKey).toMatch(/^email:/);
    expect((f.calls[1].body as { headers: Record<string, string> }).headers["X-Idempotency-Key"]).toBe(resendKey);

    // Mesmo evento novamente: não reenvia.
    const again = await sendEmail(
      { db, ...base, providers: [new ResendProvider("re_test", f.impl), new BrevoProvider("brevo_test", f.impl)] },
      { template: "welcome", to: "ANA@exemplo.test", data: { name: "Ana" }, eventKey: "signup:1" },
    );
    expect(again.status).toBe("duplicate");
    expect(f.calls).toHaveLength(2);
  });

  it("falha ambígua (timeout/5xx) não aciona fallback nem duplica", async () => {
    const f = fakeFetch({
      "api.resend.com": () => json(503, { message: "unavailable" }),
      "api.brevo.com": () => json(201, { messageId: "should-not-send" }),
    });
    const res = await sendEmail(
      { db, ...base, providers: [new ResendProvider("re_test", f.impl), new BrevoProvider("brevo_test", f.impl)] },
      { template: "reminder", to: "bob@exemplo.test", data: { title: "Pagar boleto" }, eventKey: "rem:1" },
    );
    expect(res.status).toBe("ambiguous");
    expect(f.calls.map((c) => new URL(c.url).host)).toEqual(["api.resend.com"]);
    const retry = await sendEmail(
      { db, ...base, providers: [new ResendProvider("re_test", f.impl), new BrevoProvider("brevo_test", f.impl)] },
      { template: "reminder", to: "bob@exemplo.test", data: { title: "Pagar boleto" }, eventKey: "rem:1" },
    );
    expect(retry.status).toBe("duplicate");
    expect(f.calls).toHaveLength(1);
  });

  it("erro de rede é ambíguo", async () => {
    const f = fakeFetch({ "api.resend.com": () => { throw new TypeError("fetch failed"); } });
    const res = await sendEmail({ db, ...base, providers: [new ResendProvider("re_test", f.impl)] }, { template: "welcome", to: "c@exemplo.test", data: {}, eventKey: "x" });
    expect(res.status).toBe("ambiguous");
  });

  it("sem provedores configurados => not_configured, nada gravado", async () => {
    const res = await sendEmail({ db, ...base, providers: [] }, { template: "welcome", to: "d@exemplo.test", data: {}, eventKey: "y" });
    expect(res.status).toBe("not_configured");
    expect((await pg.query("select 1 from email_messages where to_email = 'd@exemplo.test'")).rows).toHaveLength(0);
  });

  it("webhook de entrega atualiza status e não regride", async () => {
    const f = fakeFetch({ "api.resend.com": () => json(200, { id: "re_msg_9" }) });
    await sendEmail({ db, ...base, providers: [new ResendProvider("re_test", f.impl)] }, { template: "welcome", to: "e@exemplo.test", data: {}, eventKey: "z" });
    await applyEmailWebhook(db, "resend", "re_msg_9", "delivered");
    await applyEmailWebhook(db, "resend", "re_msg_9", "bounced");
    const { rows } = await pg.query<{ status: string }>("select status from email_messages where provider_message_id = 're_msg_9'");
    expect(rows[0].status).toBe("delivered");
  });

  it("template escapa conteúdo do usuário", async () => {
    const f = fakeFetch({ "api.resend.com": () => json(200, { id: "re_msg_10" }) });
    await sendEmail({ db, ...base, providers: [new ResendProvider("re_test", f.impl)] }, { template: "reminder", to: "f@exemplo.test", data: { title: "<script>x</script>" }, eventKey: "w" });
    expect((f.calls[0].body as { html: string }).html).not.toContain("<script>");
  });
});
