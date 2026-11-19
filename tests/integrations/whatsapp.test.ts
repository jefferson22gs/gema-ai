import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { hmacSha256Base64, hmacSha256Hex } from "@/lib/crypto";
import { EvolutionProvider } from "@/server/messaging/evolution";
import { MetaCloudProvider } from "@/server/messaging/meta";
import { ingestWebhook } from "@/server/messaging/ingest";
import { confirmPhoneVerification, startPhoneVerification } from "@/server/messaging/verification";
import { verifySvixSignature, verifyTimestampedHmac } from "@/server/webhooks/verify";
import { createTestDb, createUser } from "../db/harness";
import { pgliteDatabase } from "../support/pglite-db";
import { ScriptedModel } from "../support/fakes";

let pg: PGlite;
let db: Database;
let user: { id: string; personalWorkspaceId: string };
const SECRET = "evo-secret-test";
const PHONE = "+5511912345678";

const sent: { url: string; body: Record<string, unknown> }[] = [];
const evoFetch = (async (url: string | URL, init?: RequestInit) => {
  sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
  return new Response(JSON.stringify({ key: { id: `OUT-${sent.length}` } }), { status: 201 });
}) as typeof fetch;

const evolution = new EvolutionProvider({ baseUrl: "https://wa.exemplo.test", instanceToken: "k", instance: "gema", webhookSecret: SECRET }, evoFetch);

function evoPayload(id: string, text: string, opts: { fromMe?: boolean; jid?: string } = {}) {
  return JSON.stringify({
    event: "messages.upsert",
    instance: "gema",
    data: { key: { id, remoteJid: opts.jid ?? "5511912345678@s.whatsapp.net", fromMe: opts.fromMe ?? false }, message: { conversation: text }, messageTimestamp: 1795000000 },
  });
}
const headers = (secret = SECRET) => new Headers({ "x-evo-secret": secret });

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  user = await createUser(pg, "wa@example.test");
});

beforeEach(() => {
  sent.length = 0;
});

describe("verificação de posse do número", () => {
  it("só vincula após código correto; tentativas erradas contam", async () => {
    await startPhoneVerification({ db, provider: evolution }, user.id, user.personalWorkspaceId, "(11) 91234-5678");
    const msg = String(sent[0].body.text);
    const code = /(\d{6})/.exec(msg)![1];
    expect(await confirmPhoneVerification(db, "evolution", user.id, "000000" === code ? "111111" : "000000")).toBe(false);
    expect(await confirmPhoneVerification(db, "evolution", user.id, code)).toBe(true);
    const { rows } = await pg.query<{ status: string; address: string }>("select status, address from channel_accounts where user_id = $1", [user.id]);
    expect(rows).toEqual([{ status: "verified", address: PHONE }]);
  });
});

describe("webhook Evolution (critérios 3 e 8)", () => {
  const model = new ScriptedModel(() => ({
    functionCalls: [{ name: "create_expense", args: { items: [{ description: "Almoço", amount: 85 }, { description: "Combustível", amount: 40 }] } }],
  }));

  it("assinatura inválida é rejeitada e registrada sem payload", async () => {
    const res = await ingestWebhook({ db, provider: evolution, model, google: null }, evoPayload("BAD-1", "gastei 10"), headers("errado"));
    expect(res.status).toBe("rejected");
    const { rows } = await pg.query<{ signature_valid: boolean; status: string; payload: unknown }>(
      "select signature_valid, status, payload from provider_webhook_events where provider = 'evolution' and not signature_valid",
    );
    expect(rows).toEqual([{ signature_valid: false, status: "rejected", payload: null }]);
    expect((await pg.query("select 1 from transactions")).rows).toHaveLength(0);
  });

  it("mensagem válida gera duas despesas; reentrega do webhook não duplica nem responde de novo", async () => {
    const body = evoPayload("WA-100", "gastei 85 em almoço e 40 combustível");
    const first = await ingestWebhook({ db, provider: evolution, model, google: null }, body, headers());
    const second = await ingestWebhook({ db, provider: evolution, model, google: null }, body, headers());
    expect(first.status).toBe("processed");
    expect(first.replies[0].to).toBe(PHONE);
    expect(second.status).toBe("duplicate");
    expect((await pg.query("select 1 from transactions")).rows).toHaveLength(2);
    expect(sent).toHaveLength(1);
  });

  it("mensagem do próprio bot (fromMe) é ignorada (anti-loop)", async () => {
    const res = await ingestWebhook({ db, provider: evolution, model, google: null }, evoPayload("WA-ME", "gastei 1", { fromMe: true }), headers());
    expect(res.status).toBe("ignored");
    expect(sent).toHaveLength(0);
  });

  it("número não verificado não é processado nem respondido", async () => {
    const res = await ingestWebhook({ db, provider: evolution, model, google: null }, evoPayload("WA-X", "gastei 1", { jid: "5521999990000@s.whatsapp.net" }), headers());
    expect(res.status).toBe("ignored");
    expect(sent).toHaveLength(0);
  });

  it("confirmação por texto executa ação pendente", async () => {
    const contactModel = new ScriptedModel(() => ({ functionCalls: [{ name: "create_contact", args: { name: "Carlos", phone: "+55 21 98888-1111" } }] }));
    const ask = await ingestWebhook({ db, provider: evolution, model: contactModel, google: null }, evoPayload("WA-200", "grave o contato Carlos"), headers());
    expect(ask.replies[0].text).toContain("Confirma?");
    // Evolution sem botões nativos: opções numeradas no texto efetivamente enviado.
    expect(String(sent.at(-1)!.body.text)).toMatch(/1\) ✅ Confirmar\n2\) Cancelar/);
    const yes = await ingestWebhook({ db, provider: evolution, model: contactModel, google: null }, evoPayload("WA-201", "1"), headers());
    expect(yes.replies[0].text).toContain("Contato salvo: Carlos");
  });
});

describe("Meta Cloud API", () => {
  const meta = new MetaCloudProvider({ phoneNumberId: "PNID", accessToken: "t", appSecret: "app-secret" }, evoFetch);
  const body = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "PNID" }, messages: [{ id: "wamid.1", from: "5511912345678", type: "text", text: { body: "oi" } }] } }] }] });

  it("valida X-Hub-Signature-256 e normaliza evento", async () => {
    const ok = await meta.receive(body, new Headers({ "x-hub-signature-256": `sha256=${hmacSha256Hex("app-secret", body)}` }));
    expect(ok.verified).toBe(true);
    expect(ok.events[0]).toMatchObject({ provider: "meta_cloud", providerMessageId: "wamid.1", from: PHONE, text: "oi" });
    const bad = await meta.receive(body, new Headers({ "x-hub-signature-256": "sha256=deadbeef" }));
    expect(bad.verified).toBe(false);
  });
});

describe("assinaturas de webhooks de e-mail e billing", () => {
  it("Svix (Resend): válida, inválida e replay fora da janela", () => {
    const secret = `whsec_${Buffer.from("segredo-svix").toString("base64")}`;
    const now = 1_795_000_000;
    const sig = hmacSha256Base64(Buffer.from("segredo-svix"), `msg_1.${now}.{"a":1}`);
    expect(verifySvixSignature('{"a":1}', { id: "msg_1", timestamp: String(now), signature: `v1,${sig}` }, secret, now).ok).toBe(true);
    expect(verifySvixSignature('{"a":2}', { id: "msg_1", timestamp: String(now), signature: `v1,${sig}` }, secret, now).ok).toBe(false);
    expect(verifySvixSignature('{"a":1}', { id: "msg_1", timestamp: String(now), signature: `v1,${sig}` }, secret, now + 3600).ok).toBe(false);
  });

  it("billing HMAC com timestamp", () => {
    const now = 1_795_000_000;
    const header = `t=${now},v1=${hmacSha256Hex("bill", `${now}.{}`)}`;
    expect(verifyTimestampedHmac("{}", header, "bill", now).ok).toBe(true);
    expect(verifyTimestampedHmac("{}", header, "outro", now).ok).toBe(false);
  });
});
