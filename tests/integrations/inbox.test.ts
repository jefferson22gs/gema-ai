import type { PGlite } from "@electric-sql/pglite";
import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { ingestWebhook } from "@/server/messaging/ingest";
import { WhaileysProvider } from "@/server/messaging/whaileys";
import { addNote, grantSupportAccess, listInbox, setMode, supportReadConversations } from "@/server/services/inbox";
import { sendHumanReply } from "@/server/services/human-reply";
import { createTestDb, createUser } from "../db/harness";
import { pgliteDatabase } from "../support/pglite-db";
import { ScriptedModel } from "../support/fakes";

const SECRET = "inbox-secret";
const sent: string[] = [];
const engine = (async (url: string | URL, init?: RequestInit) => {
  if (String(url).endsWith("/send")) {
    sent.push(JSON.parse(String(init?.body)).text);
    return new Response(JSON.stringify({ messageId: `O${sent.length}` }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;
const provider = new WhaileysProvider({ apiUrl: "https://m.test", instance: "gema-ai", token: "t", webhookSecret: SECRET }, engine);
const PHONE = "+5511955551111";

function inbound(id: string, text: string) {
  const raw = JSON.stringify({ instanceKey: "gema-ai", key: { id, remoteJid: "5511955551111@s.whatsapp.net", fromMe: false }, message: { conversation: text } });
  const ts = String(Date.now());
  return { raw, headers: new Headers({ "x-whaileys-timestamp": ts, "x-whaileys-signature": createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex") }) };
}

let pg: PGlite;
let db: Database;
let user: { id: string; personalWorkspaceId: string };
let other: { id: string; personalWorkspaceId: string };
let convId: string;
const model = new ScriptedModel(() => ({ text: "resposta automática da IA" }));

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  user = await createUser(pg, "inbox@x.test");
  other = await createUser(pg, "outro@x.test");
  await pg.query(
    "insert into channel_accounts (workspace_id, user_id, provider, address, status, verified_at, opted_in_at) values ($1, $2, 'baileys_whaileys', $3, 'verified', now(), now())",
    [user.personalWorkspaceId, user.id, PHONE],
  );
});

beforeEach(() => {
  sent.length = 0;
});

describe("Central de Conversas (atendimento humano — teste 59)", () => {
  it("modo IA responde automaticamente", async () => {
    const m = inbound("I-1", "oi");
    await ingestWebhook({ db, provider, model, google: null }, m.raw, m.headers);
    expect(sent).toEqual(["resposta automática da IA"]);
    const [c] = await db.asUser(user.id, (q) => listInbox(q, user.personalWorkspaceId));
    convId = c.id;
    expect(c).toMatchObject({ channel: "whatsapp", mode: "ai", unanswered: false });
  });

  it("humano assume: IA não responde; mensagem fica pendente na inbox", async () => {
    const [c] = await db.asUser(user.id, (q) => listInbox(q, user.personalWorkspaceId));
    await db.asUser(user.id, (q) => setMode(q, convId, "human", c.lock_version));
    const m = inbound("I-2", "quero falar com alguém");
    const r = await ingestWebhook({ db, provider, model, google: null }, m.raw, m.headers);
    expect(sent).toEqual([]);
    expect(r.status).toBe("ignored");
    const [after] = await db.asUser(user.id, (q) => listInbox(q, user.personalWorkspaceId));
    expect(after).toMatchObject({ mode: "human", unanswered: true, last_preview: "quero falar com alguém" });
  });

  it("exclusão mútua: troca concorrente com versão desatualizada é recusada", async () => {
    const [c] = await db.asUser(user.id, (q) => listInbox(q, user.personalWorkspaceId));
    await expect(db.asUser(user.id, (q) => setMode(q, convId, "ai", c.lock_version - 1))).rejects.toThrow(/outra sessão/);
  });

  it("humano responde pelo canal; registro como atendente humano", async () => {
    const [c] = await db.asUser(user.id, (q) => listInbox(q, user.personalWorkspaceId));
    const r = await sendHumanReply(db, provider, { userId: user.id, conversationId: convId, text: "Oi! Já vou te ajudar.", expectedVersion: c.lock_version });
    expect(r.delivered).toBe(true);
    expect(sent).toEqual(["Oi! Já vou te ajudar."]);
    const last = (await pg.query<{ author_kind: string; delivery_status: string }>("select author_kind, delivery_status from messages where conversation_id = $1 order by created_at desc limit 1", [convId])).rows[0];
    expect(last).toEqual({ author_kind: "human_agent", delivery_status: "sent" });
  });

  it("copiloto: IA sugere mas não envia; sugestão não aparece como resposta enviada", async () => {
    const [c] = await db.asUser(user.id, (q) => listInbox(q, user.personalWorkspaceId));
    await db.asUser(user.id, (q) => setMode(q, convId, "copilot", c.lock_version));
    const m = inbound("I-3", "qual o horário?");
    await ingestWebhook({ db, provider, model: new ScriptedModel(() => ({ text: "Sugestão: atendemos das 9h às 18h." })), google: null }, m.raw, m.headers);
    expect(sent).toEqual([]);
    const s = (await pg.query<{ role: string; content: string }>("select role, content from messages where conversation_id = $1 order by created_at desc limit 1", [convId])).rows[0];
    expect(s).toEqual({ role: "system", content: "Sugestão: atendemos das 9h às 18h." });
  });

  it("pausado: nada é respondido; volta para IA e ela responde de novo", async () => {
    let [c] = await db.asUser(user.id, (q) => listInbox(q, user.personalWorkspaceId));
    await db.asUser(user.id, (q) => setMode(q, convId, "paused", c.lock_version));
    const m1 = inbound("I-4", "alô?");
    await ingestWebhook({ db, provider, model, google: null }, m1.raw, m1.headers);
    expect(sent).toEqual([]);
    [c] = await db.asUser(user.id, (q) => listInbox(q, user.personalWorkspaceId));
    await db.asUser(user.id, (q) => setMode(q, convId, "ai", c.lock_version));
    const m2 = inbound("I-5", "e agora?");
    await ingestWebhook({ db, provider, model, google: null }, m2.raw, m2.headers);
    expect(sent).toEqual(["resposta automática da IA"]);
  });

  it("humano não responde sem assumir a conversa", async () => {
    const [c] = await db.asUser(user.id, (q) => listInbox(q, user.personalWorkspaceId));
    await expect(sendHumanReply(db, provider, { userId: user.id, conversationId: convId, text: "x", expectedVersion: c.lock_version })).rejects.toThrow(/Assuma a conversa/);
  });

  it("notas internas e troca de modo são privadas e auditadas", async () => {
    await db.asUser(user.id, (q) => addNote(q, convId, user.personalWorkspaceId, user.id, "Cliente pediu retorno amanhã"));
    expect((await db.asUser(other.id, (q) => q.query("select id from conversation_notes"))).length).toBe(0);
    await expect(db.asUser(other.id, (q) => setMode(q, convId, "human", 0))).rejects.toThrow(/Sem permissão/);
    expect((await pg.query("select 1 from audit_logs where action = 'conversation.mode_changed'")).rows.length).toBeGreaterThanOrEqual(4);
  });
});

describe("ingestão assíncrona via fila (WA-05)", () => {
  it("webhook só enfileira (uma vez por mensagem); worker processa e responde", async () => {
    const { acceptWebhook, processInboundEvent } = await import("@/server/messaging/ingest");
    const { runJobs } = await import("@/server/jobs/queue");
    const [c] = await db.asUser(user.id, (q) => listInbox(q, user.personalWorkspaceId));
    if (c.mode !== "ai") await db.asUser(user.id, (q) => setMode(q, convId, "ai", c.lock_version));
    const m = inbound("Q-1", "olá pela fila");
    const a1 = await acceptWebhook({ db, provider }, m.raw, m.headers);
    const m2 = inbound("Q-1", "olá pela fila"); // reentrega do mesmo key.id com nova assinatura
    const a2 = await acceptWebhook({ db, provider }, m2.raw, m2.headers);
    expect(a1).toEqual({ status: "queued", queued: 1 });
    expect(a2.queued).toBe(0);
    expect(sent).toEqual([]); // nada processado no request
    const handlers = {
      "whatsapp.inbound": async (p: Record<string, unknown>) => {
        const ev = p.event as Parameters<typeof processInboundEvent>[1] & { timestamp: string };
        await processInboundEvent({ db, provider, model, google: null }, { ...ev, timestamp: new Date(ev.timestamp) });
      },
    };
    const r = await runJobs(db, handlers, new Date(Date.now() + 1000));
    expect(r).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(sent).toEqual(["resposta automática da IA"]);
  });

  it("assinatura inválida não enfileira nada", async () => {
    const { acceptWebhook } = await import("@/server/messaging/ingest");
    const m = inbound("Q-BAD", "x");
    const r = await acceptWebhook({ db, provider }, m.raw, new Headers({ "x-whaileys-timestamp": String(Date.now()), "x-whaileys-signature": "0".repeat(64) }));
    expect(r.status).toBe("rejected");
    expect((await pg.query("select 1 from system_jobs where dedupe_key like 'wa:%Q-BAD'")).rows).toHaveLength(0);
  });
});

describe("acesso de suporte às conversas (teste 12)", () => {
  it("sem autorização do titular no chamado, suporte não acessa", async () => {
    const op = await createUser(pg, "suporte@gema.test");
    await pg.query("insert into platform_admins (user_id, role) values ($1, 'support')", [op.id]);
    const [sc] = (await pg.query<{ id: string }>("insert into support_cases (workspace_id, opened_by, subject, body) values ($1, $2, 'Ajuda', 'preciso de ajuda') returning id", [user.personalWorkspaceId, user.id])).rows;
    await expect(grantSupportAccess(db, { supportCaseId: sc.id, operatorId: op.id, justification: "Investigar erro de resposta" })).rejects.toThrow(/não autorizou/);
    await expect(supportReadConversations(db, op.id, user.personalWorkspaceId)).rejects.toThrow(/Sem concessão/);

    await pg.query("update support_cases set data_access_granted_until = now() + interval '24 hours' where id = $1", [sc.id]);
    await expect(grantSupportAccess(db, { supportCaseId: sc.id, operatorId: op.id, justification: "curta" })).rejects.toThrow(/Justificativa/);
    const g = await grantSupportAccess(db, { supportCaseId: sc.id, operatorId: op.id, justification: "Investigar erro de resposta automática" });
    expect(g.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 2 * 3600_000 + 1000);
    const convs = await supportReadConversations(db, op.id, user.personalWorkspaceId);
    expect(convs.length).toBe(1);
    const actions = (await pg.query<{ action: string }>("select action from audit_logs where actor_type = 'support' order by id")).rows.map((r) => r.action);
    expect(actions).toEqual(["support.access.granted", "support.conversations.read"]);
    // Titular (admin do workspace) vê a concessão.
    expect((await db.asUser(user.id, (q) => q.query("select id from support_access_grants"))).length).toBe(1);
  });

  it("usuário comum não é operador de suporte", async () => {
    const [sc] = (await pg.query<{ id: string }>("select id from support_cases limit 1")).rows;
    await expect(grantSupportAccess(db, { supportCaseId: sc.id, operatorId: other.id, justification: "tentativa indevida de acesso" })).rejects.toThrow(/operadores/);
  });
});
