import type { PGlite } from "@electric-sql/pglite";
import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { PluggyProvider, mapItemStatus, toCentsDecimal } from "@/server/open-finance/pluggy";
import { revokeConnection, syncConnection, upsertConnection } from "@/server/open-finance/sync";
import { executeToolCalls } from "@/server/ai/executor";
import { createTestDb, createUser } from "../db/harness";
import { pgliteDatabase } from "../support/pglite-db";

/** API Pluggy simulada (somente teste) seguindo o contrato documentado em 27/11/2026. */
interface FakeState {
  item: Record<string, unknown>;
  txPages: Record<string, { results: unknown[]; next: string | null }[]>;
  calls: string[];
  failTransactionsWith?: number;
}
const state: FakeState = { item: {}, txPages: {}, calls: [] };
const NOW = Date.parse("2026-11-27T12:00:00Z");

const pluggyFetch = (async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  const path = `${init?.method ?? "GET"} ${u.pathname}`;
  state.calls.push(`${path}${u.search}`);
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s });
  if (path === "POST /auth") {
    const b = JSON.parse(String(init?.body));
    return b.clientSecret === "pluggy_sk_test" ? json(200, { apiKey: "api-key-1" }) : json(401, { code: "UNAUTHORIZED" });
  }
  if (new Headers(init?.headers).get("x-api-key") !== "api-key-1") return json(401, {});
  if (path === "POST /connect_token") return json(200, { accessToken: "connect-token-xyz", _body: JSON.parse(String(init?.body)) });
  if (path.startsWith("GET /items/")) return json(200, state.item);
  if (path === "GET /accounts") {
    return json(200, {
      page: 1, totalPages: 1, total: 2,
      results: [
        { id: "acc-bank", type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta Corrente", number: "0001/12345-6", balance: 1520.37, currencyCode: "BRL" },
        { id: "acc-card", type: "CREDIT", subtype: "CREDIT_CARD", name: "Mastercard Black", number: "5555 **** **** 4321", balance: 830.1, currencyCode: "BRL",
          creditData: { creditLimit: 10000, availableCreditLimit: 9169.9, balanceCloseDate: "2026-12-02", balanceDueDate: "2026-12-10" } },
      ],
    });
  }
  if (path === "GET /v2/transactions") {
    if (state.failTransactionsWith) return json(state.failTransactionsWith, { code: "RATE_LIMIT" });
    const accountId = u.searchParams.get("accountId") ?? "acc-bank";
    const pageIdx = Number(u.searchParams.get("after") ?? "0");
    const pages = state.txPages[accountId] ?? [{ results: [], next: null }];
    return json(200, pages[pageIdx] ?? { results: [], next: null });
  }
  if (path.startsWith("DELETE /items/")) return json(200, { count: 1 });
  return json(404, {});
}) as typeof fetch;

const provider = new PluggyProvider({ clientId: "cid", clientSecret: "pluggy_sk_test", webhookSecret: "whsec_" + "a".repeat(64) }, pluggyFetch, () => NOW);

let pg: PGlite;
let db: Database;
let alice: { id: string; personalWorkspaceId: string };
let bob: { id: string; personalWorkspaceId: string };

const baseItem = (over: Record<string, unknown> = {}) => ({
  id: "item-1", status: "UPDATED", executionStatus: "SUCCESS", consentExpiresAt: null, lastUpdatedAt: "2026-11-27T11:00:00Z",
  connector: { id: 2, name: "Pluggy Bank", imageUrl: "https://cdn.pluggy.ai/logo.png", isOpenFinance: true, isSandbox: true },
  ...over,
});

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  alice = await createUser(pg, "alice@of.test");
  bob = await createUser(pg, "bob@of.test");
});

beforeEach(() => {
  state.calls = [];
  state.item = baseItem();
  state.failTransactionsWith = undefined;
  state.txPages = {
    "acc-bank": [
      { results: [
        { id: "t1", description: "PIX recebido João", amount: 300, date: "2026-11-20T15:00:00Z", type: "CREDIT", status: "POSTED" },
        { id: "t2", description: "Mercado Bom Preço", amount: -120.5, date: "2026-11-21T02:30:00Z", type: "DEBIT", status: "PENDING" },
      ], next: "?accountId=acc-bank&after=1" },
      { results: [{ id: "t3", description: "Conta de luz", amount: -210, date: "2026-11-22T12:00:00Z", type: "DEBIT", status: "POSTED" }], next: null },
    ],
    "acc-card": [
      { results: [
        { id: "c1", description: "Notebook 2/10", amount: 450, date: "2026-11-18T12:00:00Z", type: "DEBIT", status: "POSTED", creditCardMetadata: { installmentNumber: 2, totalInstallments: 10 } },
        { id: "c2", description: "Pagamento de fatura", amount: -900, date: "2026-11-10T12:00:00Z", type: "CREDIT", status: "POSTED" },
        { id: "c3", description: "Estorno loja", amount: -50, date: "2026-11-12T12:00:00Z", type: "CREDIT", status: "POSTED" },
      ], next: null },
    ],
  };
});

describe("contrato Pluggy", () => {
  it("autentica, cria connect token com clientUserId dentro de options", async () => {
    const r = await provider.createConnectToken({ clientUserId: alice.id, webhookUrl: "https://app.test/api/webhooks/pluggy" });
    expect(r).toEqual({ token: "connect-token-xyz", expiresInSeconds: 1800 });
    expect(state.calls[0]).toBe("POST /auth");
  });

  it("segredo errado falha com mensagem clara", async () => {
    const bad = new PluggyProvider({ clientId: "c", clientSecret: "errado", webhookSecret: null }, pluggyFetch);
    await expect(bad.getItem("x")).rejects.toThrow(/autenticação Pluggy/);
  });

  it("mapeia status do item, incluindo consentimento expirado e revogado (testes 27–28)", () => {
    expect(mapItemStatus("UPDATED", "SUCCESS", null)).toBe("updated");
    expect(mapItemStatus("UPDATED", "PARTIAL_SUCCESS", null)).toBe("outdated");
    expect(mapItemStatus("UPDATING", null, null)).toBe("syncing");
    expect(mapItemStatus("LOGIN_ERROR", "USER_AUTHORIZATION_REVOKED", null)).toBe("revoked");
    expect(mapItemStatus("UPDATED", "SUCCESS", new Date("2026-01-01"), new Date("2026-11-27"))).toBe("consent_expired");
    expect(toCentsDecimal(1520.37)).toBe(152037);
    expect(toCentsDecimal(0.1 + 0.2)).toBe(30);
  });

  it("webhook: assinatura válida, inválida, replay e ausente", () => {
    const secret = "whsec_" + "a".repeat(64);
    const body = JSON.stringify({ event: "transactions/created", eventId: "ev-1", itemId: "item-1", accountId: "acc-bank", transactionIds: ["t9"] });
    const t = Math.floor(NOW / 1000);
    const sig = (ts: number, b = body) => `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${b}`).digest("hex")}`;
    const ok = provider.verifyWebhook(body, new Headers({ "x-pluggy-signature": sig(t) }));
    expect(ok).toEqual({ ok: true, event: { eventId: "ev-1", event: "transactions/created", itemId: "item-1", accountId: "acc-bank", transactionIds: ["t9"] } });
    expect(provider.verifyWebhook(body.replace("ev-1", "ev-2"), new Headers({ "x-pluggy-signature": sig(t) })).ok).toBe(false);
    expect(provider.verifyWebhook(body, new Headers({ "x-pluggy-signature": sig(t - 600) })).ok).toBe(false);
    expect(provider.verifyWebhook(body, new Headers()).ok).toBe(false);
  });
});

describe("sincronização (testes 25, 26, 29, 34)", () => {
  let connId: string;

  it("sync inicial: contas, saldos com data, transações normalizadas, cartão vinculado", async () => {
    const conn = await upsertConnection(db, { workspaceId: alice.personalWorkspaceId, ownerId: alice.id, provider: "pluggy", item: await provider.getItem("item-1") });
    connId = conn.id;
    const r = await syncConnection(db, provider, connId, "initial", new Date(NOW));
    expect(r).toEqual({ status: "succeeded", accounts: 2, created: 6, updated: 0 });

    const accs = (await pg.query<{ kind: string; balance_cents: number; number_masked: string }>("select kind, balance_cents, number_masked from bank_accounts order by kind")).rows;
    expect(accs).toEqual([
      { kind: "bank", balance_cents: 152037, number_masked: "•••• 3456" },
      { kind: "credit", balance_cents: 83010, number_masked: "•••• 4321" },
    ]);
    const txs = (await pg.query<{ external_id: string; kind: string; amount_cents: number; status: string; occurred_on: string; installment_number: number | null }>(
      "select external_id, kind, amount_cents, status, occurred_on, installment_number from transactions order by external_id",
    )).rows;
    expect(txs).toEqual([
      { external_id: "c1", kind: "expense", amount_cents: 45000, status: "paid", occurred_on: "2026-11-18", installment_number: 2 },
      { external_id: "c2", kind: "card_payment", amount_cents: 90000, status: "paid", occurred_on: "2026-11-10", installment_number: null },
      { external_id: "c3", kind: "refund", amount_cents: 5000, status: "paid", occurred_on: "2026-11-12", installment_number: null },
      { external_id: "t1", kind: "income", amount_cents: 30000, status: "paid", occurred_on: "2026-11-20", installment_number: null },
      // 02:30 UTC = 23:30 do dia anterior em Brasília.
      { external_id: "t2", kind: "expense", amount_cents: 12050, status: "pending", occurred_on: "2026-11-20", installment_number: null },
      { external_id: "t3", kind: "expense", amount_cents: 21000, status: "paid", occurred_on: "2026-11-22", installment_number: null },
    ]);
    const card = (await pg.query<{ source: string; closing_day: number; due_day: number; last4: string }>("select source, closing_day, due_day, last4 from credit_cards")).rows;
    expect(card).toEqual([{ source: "open_finance", closing_day: 2, due_day: 10, last4: "4321" }]);
    expect(state.calls.filter((c) => c.startsWith("GET /v2/transactions"))).toHaveLength(3); // paginação por cursor
  });

  it("reimportação não duplica e pendente vira postado (teste 34)", async () => {
    state.txPages["acc-bank"][0].results[1] = { id: "t2", description: "Mercado Bom Preço", amount: -120.5, date: "2026-11-21T02:30:00Z", type: "DEBIT", status: "POSTED" };
    const r = await syncConnection(db, provider, connId, "webhook", new Date(NOW));
    expect(r).toMatchObject({ status: "succeeded", created: 0, updated: 6 });
    expect((await pg.query("select 1 from transactions")).rows).toHaveLength(6);
    expect((await pg.query<{ status: string }>("select status from transactions where external_id = 't2'")).rows[0].status).toBe("paid");
  });

  it("ferramenta de IA informa saldo consolidado com a data do banco (não finge tempo real)", async () => {
    const [o] = await executeToolCalls(
      { db, ctx: { userId: alice.id, workspaceId: alice.personalWorkspaceId, timezone: "America/Sao_Paulo", now: new Date(NOW), channel: "dashboard" }, google: null },
      [{ name: "bank_balances", args: {} }],
      "bal-1",
    );
    expect(o.status).toBe("succeeded");
    expect(o.message).toMatch(/Saldo consolidado R\$\s?1\.520,37/);
    expect(o.message).toMatch(/em 27\/11\/2026/);
    expect(o.message).toMatch(/não é|informados pelos bancos/);
  });

  it("isolamento: Bob não vê conexões, contas, saldos ou transações de Alice", async () => {
    const r = await db.asUser(bob.id, async (q) => ({
      c: await q.query("select id from bank_connections"),
      a: await q.query("select id from bank_accounts"),
      s: await q.query("select id from balance_snapshots"),
      t: await q.query("select id from transactions"),
    }));
    expect([r.c.length, r.a.length, r.s.length, r.t.length]).toEqual([0, 0, 0, 0]);
  });

  it("item de outro titular não é reatribuído", async () => {
    await expect(upsertConnection(db, { workspaceId: bob.personalWorkspaceId, ownerId: bob.id, provider: "pluggy", item: await provider.getItem("item-1") })).rejects.toThrow(/outro usuário/);
  });

  it("cliente não pode alterar status da conexão (apenas visibilidade)", async () => {
    await expect(db.asUser(alice.id, (q) => q.query("update bank_connections set status = 'updated' where id = $1", [connId]))).rejects.toThrow(/permission denied/);
    await db.asUser(alice.id, (q) => q.query("update bank_connections set visibility = 'private' where id = $1", [connId]));
  });

  it("consentimento expirado: sync é pulado e status reflete (teste 27)", async () => {
    state.item = baseItem({ consentExpiresAt: "2026-11-01T00:00:00Z" });
    const r = await syncConnection(db, provider, connId, "scheduled", new Date(NOW));
    expect(r).toMatchObject({ status: "skipped", error: "consentimento expirado" });
    expect((await pg.query<{ status: string }>("select status from bank_connections where id = $1", [connId])).rows[0].status).toBe("consent_expired");
  });

  it("rate limit (429) é repassado para a fila tentar de novo", async () => {
    state.item = baseItem();
    state.failTransactionsWith = 429;
    await expect(syncConnection(db, provider, connId, "scheduled", new Date(NOW))).rejects.toThrow(/429/);
  });

  it("revogação pelo titular exclui no provedor e bloqueia novos syncs (teste 28)", async () => {
    expect(await revokeConnection(db, provider, bob.id, connId)).toBe(false);
    expect(await revokeConnection(db, provider, alice.id, connId)).toBe(true);
    expect(state.calls).toContain("DELETE /items/item-1");
    const r = await syncConnection(db, provider, connId, "manual", new Date(NOW));
    expect(r).toMatchObject({ status: "skipped", error: "conexão revogada" });
    expect((await pg.query("select 1 from audit_logs where action = 'bank.connection.revoked'")).rows).toHaveLength(1);
    const logs = (await pg.query<{ status: string }>("select status from bank_sync_logs order by id")).rows.map((l) => l.status);
    expect(logs).toEqual(["succeeded", "succeeded", "skipped", "skipped"]);
  });
});
