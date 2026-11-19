import type { PGlite } from "@electric-sql/pglite";
import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { ingestWebhook } from "@/server/messaging/ingest";
import { extractWhaileysText, verifyWhaileysSignature, WhaileysProvider } from "@/server/messaging/whaileys";
import { createTestDb, createUser } from "../db/harness";
import { pgliteDatabase } from "../support/pglite-db";
import { ScriptedModel } from "../support/fakes";

const SECRET = "segredo-whaileys-teste";
const INSTANCE = "gema-ai";
const PHONE = "+5511912345678";
const NOW = 1_795_000_000_000;

let pg: PGlite;
let db: Database;
let user: { id: string; personalWorkspaceId: string };

/** Motor Whaileys simulado (somente teste): registra envios e responde como a API real. */
const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
let sessionOpen = true;
const engine = (async (url: string | URL, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  calls.push({ url: String(url), method: init?.method ?? "GET", body });
  if (new Headers(init?.headers).get("x-api-key") !== "tok") return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  if (String(url).endsWith("/send")) {
    return sessionOpen
      ? new Response(JSON.stringify({ messageId: `OUT-${calls.length}` }), { status: 200 })
      : new Response(JSON.stringify({ error: "session not open" }), { status: 409 });
  }
  if (String(url).endsWith("/known-phones")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
  return new Response(JSON.stringify({ state: sessionOpen ? "open" : "disconnected" }), { status: 200 });
}) as typeof fetch;

const provider = new WhaileysProvider({ apiUrl: "https://motor.test/", instance: INSTANCE, token: "tok", webhookSecret: SECRET }, engine, () => NOW);

function payload(id: string, message: Record<string, unknown>, opts: { fromMe?: boolean; remoteJid?: string; senderPn?: string; instanceKey?: string; media?: unknown } = {}) {
  return JSON.stringify({
    instanceKey: opts.instanceKey ?? INSTANCE,
    me: "5511900000000@s.whatsapp.net",
    key: { id, remoteJid: opts.remoteJid ?? "5511912345678@s.whatsapp.net", fromMe: opts.fromMe ?? false, senderPn: opts.senderPn },
    message,
    pushName: "Teste",
    media: opts.media,
  });
}

function signed(raw: string, ts = NOW, secret = SECRET) {
  return new Headers({
    "x-whaileys-timestamp": String(ts),
    "x-whaileys-signature": createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex"),
  });
}

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  user = await createUser(pg, "whaileys@example.test");
  await pg.query(
    "insert into channel_accounts (workspace_id, user_id, provider, address, status, verified_at, opted_in_at) values ($1, $2, 'baileys_whaileys', $3, 'verified', now(), now())",
    [user.personalWorkspaceId, user.id, PHONE],
  );
});

beforeEach(() => {
  calls.length = 0;
  sessionOpen = true;
});

describe("assinatura do webhook Whaileys", () => {
  const raw = payload("A1", { conversation: "oi" });
  it("assinatura válida passa", () => {
    const h = signed(raw);
    expect(verifyWhaileysSignature(raw, h.get("x-whaileys-timestamp"), h.get("x-whaileys-signature"), SECRET, NOW)).toBe(true);
  });
  it("corpo adulterado, segredo errado e timestamp de 6 min são rejeitados", () => {
    const h = signed(raw);
    expect(verifyWhaileysSignature(raw.replace("oi", "tchau"), h.get("x-whaileys-timestamp"), h.get("x-whaileys-signature"), SECRET, NOW)).toBe(false);
    const wrong = signed(raw, NOW, "outro");
    expect(verifyWhaileysSignature(raw, wrong.get("x-whaileys-timestamp"), wrong.get("x-whaileys-signature"), SECRET, NOW)).toBe(false);
    const old = signed(raw, NOW - 6 * 60_000);
    expect(verifyWhaileysSignature(raw, old.get("x-whaileys-timestamp"), old.get("x-whaileys-signature"), SECRET, NOW)).toBe(false);
    expect(verifyWhaileysSignature(raw, null, null, SECRET, NOW)).toBe(false);
  });
});

describe("extração de texto e cliques", () => {
  it.each([
    [{ conversation: "oi" }, "oi", false],
    [{ extendedTextMessage: { text: "olá" } }, "olá", false],
    [{ buttonsResponseMessage: { selectedButtonId: "confirmar" } }, "confirmar", true],
    [{ templateButtonReplyMessage: { selectedId: "cancelar" } }, "cancelar", true],
    [{ listResponseMessage: { singleSelectReply: { selectedRowId: "row-2" } } }, "row-2", true],
    [{ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"id":"nf-1"}' } } }, "nf-1", true],
  ])("%j => %s", (message, text, interactive) => {
    expect(extractWhaileysText(message)).toEqual({ text, interactive });
  });
});

describe("ingestão Whaileys", () => {
  it("assinatura inválida => rejected, registrado sem payload, nada processado", async () => {
    const raw = payload("BAD", { conversation: "gastei 10" });
    const res = await ingestWebhook({ db, provider, model: null, google: null }, raw, signed(raw, NOW, "errado"));
    expect(res.status).toBe("rejected");
    const { rows } = await pg.query<{ payload: unknown }>("select payload from provider_webhook_events where provider = 'baileys_whaileys' and not signature_valid");
    expect(rows).toEqual([{ payload: null }]);
  });

  it("mesma key.id duas vezes processa uma vez (reentrega do motor)", async () => {
    const model = new ScriptedModel(() => ({ functionCalls: [{ name: "create_expense", args: { items: [{ description: "Almoço", amount: 85 }, { description: "Combustível", amount: 40 }] } }] }));
    const raw = payload("DUP-1", { conversation: "gastei 85 no almoço e 40 no combustível" });
    const first = await ingestWebhook({ db, provider, model, google: null }, raw, signed(raw));
    const second = await ingestWebhook({ db, provider, model, google: null }, raw, signed(raw));
    expect(first.status).toBe("processed");
    expect(second.status).toBe("duplicate");
    expect((await pg.query("select 1 from transactions where source = 'whatsapp'")).rows).toHaveLength(2);
    expect(calls.filter((c) => c.url.endsWith("/send"))).toHaveLength(1);
    expect(calls[0].url).toBe("https://motor.test/sessions/gema-ai/send");
    expect(calls[0].body.to).toBe("5511912345678");
  });

  it("fromMe é ignorado (anti-loop)", async () => {
    const raw = payload("ME-1", { conversation: "1" }, { fromMe: true });
    const res = await ingestWebhook({ db, provider, model: null, google: null }, raw, signed(raw));
    expect(res.status).toBe("ignored");
    expect(calls).toHaveLength(0);
  });

  it("outra instância é ignorada", async () => {
    const raw = payload("OTHER-1", { conversation: "oi" }, { instanceKey: "portaria-prime" });
    expect((await ingestWebhook({ db, provider, model: null, google: null }, raw, signed(raw))).status).toBe("ignored");
  });

  it("remetente só-LID usa senderPn; sem senderPn não processa", async () => {
    const withPn = payload("LID-1", { conversation: "oi" }, { remoteJid: "123456789@lid", senderPn: "5511912345678@s.whatsapp.net" });
    const ok = await provider.receive(withPn, signed(withPn));
    expect(ok.events[0].from).toBe(PHONE);
    const noPn = payload("LID-2", { conversation: "oi" }, { remoteJid: "123456789@lid" });
    const none = await provider.receive(noPn, signed(noPn));
    expect(none.events).toEqual([]);
  });

  it("ação sensível envia botões ✅ Confirmar/Cancelar com opções numeradas; clique no botão executa", async () => {
    const model = new ScriptedModel(() => ({ functionCalls: [{ name: "create_contact", args: { name: "Ana", phone: "+55 21 97777-2222" } }] }));
    const askRaw = payload("CT-1", { conversation: "grave a Ana" });
    await ingestWebhook({ db, provider, model, google: null }, askRaw, signed(askRaw));
    const sent = calls.find((c) => c.url.endsWith("/send"))!.body as { text: string; buttons: { id: string; title: string }[] };
    expect(sent.buttons).toEqual([{ id: "confirmar", title: "✅ Confirmar" }, { id: "cancelar", title: "Cancelar" }]);
    expect(sent.text).toMatch(/1\. ✅ Confirmar\n2\. Cancelar$/);

    const clickRaw = payload("CT-2", { buttonsResponseMessage: { selectedButtonId: "confirmar" } });
    const done = await ingestWebhook({ db, provider, model, google: null }, clickRaw, signed(clickRaw));
    expect(done.replies[0].text).toContain("Contato salvo: Ana");
  });

  it("'2' digitado cancela a ação pendente", async () => {
    const model = new ScriptedModel(() => ({ functionCalls: [{ name: "create_contact", args: { name: "Bruno", phone: "+55 31 96666-3333" } }] }));
    const askRaw = payload("CT-3", { conversation: "grave o Bruno" });
    await ingestWebhook({ db, provider, model, google: null }, askRaw, signed(askRaw));
    const noRaw = payload("CT-4", { conversation: "2" });
    const res = await ingestWebhook({ db, provider, model, google: null }, noRaw, signed(noRaw));
    expect(res.replies[0].text).toContain("cancelei");
    expect((await pg.query("select 1 from contacts where name = 'Bruno'")).rows).toHaveLength(0);
  });

  it("áudio chega inline no webhook e vai ao modelo sem download extra", async () => {
    const model = new ScriptedModel(() => ({ text: "ok" }));
    const raw = payload("AUD-1", { audioMessage: { mimetype: "audio/ogg; codecs=opus" } }, { media: { mimetype: "audio/ogg; codecs=opus", data: Buffer.from("x").toString("base64") } });
    await ingestWebhook({ db, provider, model, google: null }, raw, signed(raw));
    expect(model.calls[0].media).toEqual({ mimeType: "audio/ogg", base64: Buffer.from("x").toString("base64") });
  });

  it("envio com sessão desconectada (409) não derruba o processamento", async () => {
    sessionOpen = false;
    const model = new ScriptedModel(() => ({ text: "resposta" }));
    const raw = payload("OFF-1", { conversation: "oi" });
    const res = await ingestWebhook({ db, provider, model, google: null }, raw, signed(raw));
    expect(res.status).toBe("processed");
    expect(res.replies[0].delivered).toBe(false);
  });
});

describe("provider Whaileys", () => {
  it("health reflete o estado da sessão", async () => {
    expect((await provider.health()).status).toBe("connected");
    sessionOpen = false;
    expect(await provider.health()).toEqual({ status: "disconnected", detail: "disconnected" });
  });

  it("não envia mídia e registra números conhecidos (até 50)", async () => {
    expect((await provider.sendMediaIfSupported()).unsupported).toBe(true);
    await provider.registerKnownPhones(["+5511912345678", "abc"]);
    expect(calls.at(-1)).toMatchObject({ url: "https://motor.test/sessions/gema-ai/known-phones", body: { phones: ["5511912345678"] } });
  });
});
