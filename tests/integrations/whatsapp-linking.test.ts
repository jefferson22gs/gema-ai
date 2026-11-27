import type { PGlite } from "@electric-sql/pglite";
import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { ingestWebhook } from "@/server/messaging/ingest";
import { consumeLinkCode, createLinkCode, extractLinkCode, unlinkChannel } from "@/server/messaging/verification";
import { WhaileysProvider } from "@/server/messaging/whaileys";
import { createTestDb, createUser } from "../db/harness";
import { pgliteDatabase } from "../support/pglite-db";
import { ScriptedModel } from "../support/fakes";

const SECRET = "wh-secret";
const sent: { to: string; text: string }[] = [];
const engine = (async (url: string | URL, init?: RequestInit) => {
  if (String(url).endsWith("/send")) {
    const b = JSON.parse(String(init?.body));
    sent.push({ to: b.to, text: b.text });
    return new Response(JSON.stringify({ messageId: `OUT-${sent.length}` }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}) as typeof fetch;
const provider = new WhaileysProvider({ apiUrl: "https://motor.test", instance: "gema-ai", token: "tok", webhookSecret: SECRET }, engine);

function inbound(id: string, text: string, phone = "5511912345678") {
  const raw = JSON.stringify({ instanceKey: "gema-ai", key: { id, remoteJid: `${phone}@s.whatsapp.net`, fromMe: false }, message: { conversation: text } });
  const ts = String(Date.now());
  return { raw, headers: new Headers({ "x-whaileys-timestamp": ts, "x-whaileys-signature": createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex") }) };
}

let pg: PGlite;
let db: Database;
let alice: { id: string; personalWorkspaceId: string };
let bob: { id: string; personalWorkspaceId: string };

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  alice = await createUser(pg, "alice@link.test");
  bob = await createUser(pg, "bob@link.test");
});

beforeEach(() => {
  sent.length = 0;
});

describe("vinculação inbound do WhatsApp (teste 10)", () => {
  it("formato do código é reconhecido no meio da mensagem", () => {
    expect(extractLinkCode("oi, meu código é gema 1234-5678 obrigado")).toBe("GEMA-1234-5678");
    expect(extractLinkCode("GEMA-12345678")).toBe("GEMA-1234-5678");
    expect(extractLinkCode("gastei 1234")).toBeNull();
  });

  it("código válido enviado pelo número vincula, é de uso único e fica auditado", async () => {
    const { code } = await createLinkCode(db, alice.id, alice.personalWorkspaceId, "baileys_whaileys");
    const m = inbound("L-1", `Meu código: ${code}`);
    const r = await ingestWebhook({ db, provider, model: null, google: null }, m.raw, m.headers);
    expect(r.replies[0].text).toMatch(/Número vinculado/);
    const acct = (await pg.query<{ status: string; address: string; link_method: string; show_balances: boolean }>(
      "select status, address, link_method, show_balances from channel_accounts where user_id = $1", [alice.id],
    )).rows;
    expect(acct).toEqual([{ status: "verified", address: "+5511912345678", link_method: "inbound_code", show_balances: false }]);
    expect((await pg.query("select 1 from audit_logs where action = 'whatsapp.linked'")).rows).toHaveLength(1);
    // Reuso do mesmo código por outro número: inválido.
    expect((await consumeLinkCode(db, "baileys_whaileys", "+5521999990000", code)).status).toBe("invalid");
  });

  it("código expirado é recusado", async () => {
    const { code } = await createLinkCode(db, bob.id, bob.personalWorkspaceId, "baileys_whaileys");
    await pg.query("update channel_link_codes set expires_at = now() - interval '1 minute' where user_id = $1", [bob.id]);
    expect((await consumeLinkCode(db, "baileys_whaileys", "+5531988887777", code)).status).toBe("expired");
  });

  it("número já vinculado a outra conta gera conflito (sem tomar o número)", async () => {
    const { code } = await createLinkCode(db, bob.id, bob.personalWorkspaceId, "baileys_whaileys");
    expect((await consumeLinkCode(db, "baileys_whaileys", "+5511912345678", code)).status).toBe("conflict");
    const owner = (await pg.query<{ user_id: string }>("select user_id from channel_accounts where address = '+5511912345678' and status = 'verified'")).rows;
    expect(owner).toEqual([{ user_id: alice.id }]);
  });

  it("força bruta: após 5 falhas por hora o número fica bloqueado", async () => {
    const attacker = "+5541977776666";
    for (let i = 0; i < 5; i++) await consumeLinkCode(db, "baileys_whaileys", attacker, `GEMA-0000-000${i}`);
    const { code } = await createLinkCode(db, bob.id, bob.personalWorkspaceId, "baileys_whaileys");
    expect((await consumeLinkCode(db, "baileys_whaileys", attacker, code)).status).toBe("blocked");
  });

  it("novo código cancela o anterior; troca de número revoga o vínculo antigo", async () => {
    const first = await createLinkCode(db, alice.id, alice.personalWorkspaceId, "baileys_whaileys");
    const second = await createLinkCode(db, alice.id, alice.personalWorkspaceId, "baileys_whaileys");
    expect((await consumeLinkCode(db, "baileys_whaileys", "+5511900001111", first.code)).status).toBe("invalid");
    const r = await consumeLinkCode(db, "baileys_whaileys", "+5511900001111", second.code);
    expect(r).toMatchObject({ status: "linked", replaced: true });
    const rows = (await pg.query<{ address: string; status: string }>("select address, status from channel_accounts where user_id = $1 order by created_at", [alice.id])).rows;
    expect(rows).toEqual([{ address: "+5511912345678", status: "revoked" }, { address: "+5511900001111", status: "verified" }]);
  });

  it("número antigo, após troca, não acessa mais nada", async () => {
    const m = inbound("OLD-1", "gastei 10 no café");
    const r = await ingestWebhook({ db, provider, model: new ScriptedModel(() => ({ text: "ok" })), google: null }, m.raw, m.headers);
    expect(r.status).toBe("ignored");
    expect(sent).toHaveLength(0);
  });

  it("desvinculação pelo titular é auditada e só vale para o próprio canal", async () => {
    const [ch] = (await pg.query<{ id: string }>("select id from channel_accounts where user_id = $1 and status = 'verified'", [alice.id])).rows;
    expect(await unlinkChannel(db, bob.id, ch.id)).toBe(false);
    expect(await unlinkChannel(db, alice.id, ch.id)).toBe(true);
    expect((await pg.query("select 1 from audit_logs where action = 'whatsapp.unlinked'")).rows).toHaveLength(1);
  });
});

describe("privacidade do canal", () => {
  it("saldos não aparecem no WhatsApp sem permissão do titular; aparecem após ativar", async () => {
    const { code } = await createLinkCode(db, bob.id, bob.personalWorkspaceId, "baileys_whaileys");
    expect((await consumeLinkCode(db, "baileys_whaileys", "+5551955554444", code)).status).toBe("linked");
    const model = new ScriptedModel(() => ({ functionCalls: [{ name: "bank_balances", args: {} }] }));
    const ask = inbound("BAL-1", "quanto tenho nos bancos?", "5551955554444");
    const r1 = await ingestWebhook({ db, provider, model, google: null }, ask.raw, ask.headers);
    expect(r1.replies[0].text).toMatch(/Por privacidade/);

    await db.asUser(bob.id, (q) => q.query("update channel_accounts set show_balances = true where user_id = $1 and status = 'verified'", [bob.id]));
    const ask2 = inbound("BAL-2", "quanto tenho nos bancos?", "5551955554444");
    const r2 = await ingestWebhook({ db, provider, model, google: null }, ask2.raw, ask2.headers);
    expect(r2.replies[0].text).toMatch(/Nenhum banco conectado/);
  });

  it("titular não consegue alterar status/endereço do canal pelo cliente (só preferências)", async () => {
    await expect(db.asUser(bob.id, (q) => q.query("update channel_accounts set address = '+5511999999999' where user_id = $1", [bob.id]))).rejects.toThrow(/permission denied/);
  });

  it("tabelas de códigos são inacessíveis ao cliente", async () => {
    await expect(db.asUser(bob.id, (q) => q.query("select * from channel_link_codes"))).rejects.toThrow(/permission denied/);
  });
});
