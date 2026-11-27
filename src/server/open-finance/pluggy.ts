import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BankProviderError, type BankProvider, type ConnectionStatus, type ProviderAccount, type ProviderInstitution, type ProviderItem,
  type ProviderTransaction, type TransactionsPage, type WebhookEvent,
} from "./types";

/**
 * Adaptador Pluggy (docs.pluggy.ai, contrato levantado em 27/11/2026 — ver docs/OPEN_FINANCE.md):
 * - POST /auth {clientId, clientSecret} → {apiKey} (2 h), header X-API-KEY.
 * - POST /connect_token {itemId?, options:{clientUserId, webhookUrl}} → {accessToken} (30 min).
 * - GET /items/{id}, GET /accounts?itemId=, GET /v2/transactions?accountId=&dateFrom=&dateTo= (cursor `next`).
 * - PATCH /items/{id} (sync), DELETE /items/{id} (revoga consentimento OF e apaga dados).
 * - Webhook: X-Pluggy-Signature "t=<unix>,v1=<hex>" = HMAC-SHA256(secret, "<t>.<raw body>"), janela 5 min.
 */
export interface PluggyConfig {
  clientId: string;
  clientSecret: string;
  webhookSecret: string | null;
  baseUrl?: string;
}

type FetchLike = typeof fetch;

const REPLAY_WINDOW_S = 5 * 60;

/** Converte valor decimal da API para centavos sem erro de ponto flutuante. */
export function toCentsDecimal(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Math.round(v * 100);
}

export function mapItemStatus(status: string, executionStatus: string | null, consentExpiresAt: Date | null, now = new Date()): ConnectionStatus {
  if (executionStatus === "USER_AUTHORIZATION_REVOKED") return "revoked";
  if (consentExpiresAt && consentExpiresAt.getTime() <= now.getTime()) return "consent_expired";
  switch (status) {
    case "UPDATED":
      return executionStatus === "PARTIAL_SUCCESS" ? "outdated" : "updated";
    case "UPDATING":
      return "syncing";
    case "WAITING_USER_INPUT":
      return "waiting_user";
    case "OUTDATED":
      return "outdated";
    case "LOGIN_ERROR":
      return "error";
    default:
      return "error";
  }
}

export class PluggyProvider implements BankProvider {
  readonly name = "pluggy" as const;
  private apiKey: { value: string; expiresAt: number } | null = null;
  private readonly base: string;

  constructor(private readonly cfg: PluggyConfig, private readonly fetchImpl: FetchLike = fetch, private readonly now: () => number = Date.now) {
    this.base = (cfg.baseUrl ?? "https://api.pluggy.ai").replace(/\/+$/, "");
  }

  private async auth(): Promise<string> {
    if (this.apiKey && this.apiKey.expiresAt > this.now() + 60_000) return this.apiKey.value;
    const res = await this.fetchImpl(`${this.base}/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: this.cfg.clientId, clientSecret: this.cfg.clientSecret }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { apiKey?: string; code?: string; message?: string };
    if (!res.ok || !json.apiKey) {
      throw new BankProviderError(json.code === "CLIENT_SECRET_EXPIRED" ? "Segredo da Pluggy expirado: gere um novo no Dashboard." : `Falha na autenticação Pluggy (HTTP ${res.status}).`, res.status);
    }
    // API Key vale 2 h; renovamos com folga.
    this.apiKey = { value: json.apiKey, expiresAt: this.now() + 110 * 60_000 };
    return json.apiKey;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const key = await this.auth();
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { "X-API-KEY": key, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401) this.apiKey = null;
    const json = (await res.json().catch(() => ({}))) as T & { message?: string; code?: string };
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new BankProviderError(`Pluggy ${method} ${path.split("?")[0]}: HTTP ${res.status}${json.code ? ` ${json.code}` : ""}`, res.status, retryable);
    }
    return json;
  }

  async createConnectToken(input: { clientUserId: string; itemId?: string; webhookUrl?: string }) {
    // clientUserId e webhookUrl precisam ir dentro de `options` (na raiz são descartados em silêncio).
    const r = await this.call<{ accessToken: string }>("POST", "/connect_token", {
      ...(input.itemId ? { itemId: input.itemId } : {}),
      options: { clientUserId: input.clientUserId, ...(input.webhookUrl ? { webhookUrl: input.webhookUrl } : {}), avoidDuplicates: true },
    });
    return { token: r.accessToken, expiresInSeconds: 30 * 60 };
  }

  async listInstitutions(input: { openFinanceOnly?: boolean; sandbox?: boolean; name?: string }): Promise<ProviderInstitution[]> {
    const params = new URLSearchParams({ countries: "BR" });
    if (input.openFinanceOnly) params.set("isOpenFinance", "true");
    if (input.sandbox) params.set("sandbox", "true");
    if (input.name) params.set("name", input.name);
    const r = await this.call<{ results: { id: number; name: string; imageUrl?: string; isOpenFinance?: boolean; isSandbox?: boolean }[] }>("GET", `/connectors?${params}`);
    return r.results.map((c) => ({ id: String(c.id), name: c.name, imageUrl: c.imageUrl ?? null, isOpenFinance: Boolean(c.isOpenFinance), isSandbox: Boolean(c.isSandbox) }));
  }

  async getItem(itemId: string): Promise<ProviderItem> {
    const r = await this.call<{
      id: string; status: string; executionStatus?: string; statusDetail?: unknown; consentExpiresAt?: string | null; lastUpdatedAt?: string | null;
      connector: { id: number; name: string; imageUrl?: string; isOpenFinance?: boolean; isSandbox?: boolean };
    }>("GET", `/items/${encodeURIComponent(itemId)}`);
    const consent = r.consentExpiresAt ? new Date(r.consentExpiresAt) : null;
    return {
      id: r.id,
      status: mapItemStatus(r.status, r.executionStatus ?? null, consent, new Date(this.now())),
      providerStatus: r.status,
      providerExecutionStatus: r.executionStatus ?? null,
      statusDetail: r.statusDetail ? JSON.stringify(r.statusDetail).slice(0, 500) : null,
      consentExpiresAt: consent,
      lastUpdatedAt: r.lastUpdatedAt ? new Date(r.lastUpdatedAt) : null,
      institution: {
        id: String(r.connector.id), name: r.connector.name, imageUrl: r.connector.imageUrl ?? null,
        isOpenFinance: Boolean(r.connector.isOpenFinance), isSandbox: Boolean(r.connector.isSandbox),
      },
    };
  }

  async listAccounts(itemId: string): Promise<ProviderAccount[]> {
    const out: ProviderAccount[] = [];
    for (let page = 1; page <= 20; page++) {
      const r = await this.call<{
        totalPages: number;
        results: {
          id: string; type: "BANK" | "CREDIT"; subtype?: string; name: string; marketingName?: string; number?: string; balance?: number; currencyCode?: string;
          creditData?: { creditLimit?: number; availableCreditLimit?: number; balanceCloseDate?: string; balanceDueDate?: string };
        }[];
      }>("GET", `/accounts?itemId=${encodeURIComponent(itemId)}&page=${page}&pageSize=500`);
      for (const a of r.results) {
        const kind = a.type === "CREDIT" ? "credit" : "bank";
        out.push({
          id: a.id,
          kind,
          subtype: a.subtype ?? null,
          name: a.marketingName || a.name,
          numberMasked: a.number ? `•••• ${a.number.replace(/\D/g, "").slice(-4)}` : null,
          currency: a.currencyCode ?? "BRL",
          // Em contas de crédito, `balance` é a fatura em aberto (não é saldo disponível).
          balanceCents: toCentsDecimal(a.balance),
          creditLimitCents: toCentsDecimal(a.creditData?.creditLimit),
          creditAvailableCents: toCentsDecimal(a.creditData?.availableCreditLimit),
          closingDate: a.creditData?.balanceCloseDate?.slice(0, 10) ?? null,
          dueDate: a.creditData?.balanceDueDate?.slice(0, 10) ?? null,
        });
      }
      if (page >= (r.totalPages ?? 1)) break;
    }
    return out;
  }

  async listTransactions(accountId: string, opts: { from?: string; to?: string; cursor?: string | null }): Promise<TransactionsPage> {
    // /v2/transactions (cursor). `next` é query string pronta para concatenar ao path.
    const path = opts.cursor
      ? `/v2/transactions${opts.cursor.startsWith("?") ? opts.cursor : `?${opts.cursor}`}`
      : `/v2/transactions?${new URLSearchParams({ accountId, ...(opts.from ? { dateFrom: opts.from } : {}), ...(opts.to ? { dateTo: opts.to } : {}) })}`;
    const r = await this.call<{
      next: string | null;
      results: {
        id: string; description: string; amount: number; date: string; type: "DEBIT" | "CREDIT"; status?: "POSTED" | "PENDING"; category?: string | null;
        merchant?: { name?: string } | null; creditCardMetadata?: { installmentNumber?: number; totalInstallments?: number } | null;
      }[];
    }>("GET", path);
    return {
      next: r.next ?? null,
      transactions: r.results.map((t): ProviderTransaction => ({
        id: t.id,
        description: t.description,
        amountCents: Math.abs(Math.round(t.amount * 100)),
        // `type` define a direção (o sinal de `amount` varia entre contas BANK e CREDIT).
        direction: t.type === "DEBIT" ? "out" : "in",
        // `date` vem em UTC; a data local brasileira é obtida convertendo para GMT-3.
        date: new Date(new Date(t.date).getTime() - 3 * 3600_000).toISOString().slice(0, 10),
        status: t.status === "PENDING" ? "pending" : "posted",
        category: t.category ?? null,
        merchant: t.merchant?.name ?? null,
        installment:
          t.creditCardMetadata?.installmentNumber && t.creditCardMetadata.totalInstallments
            ? { number: t.creditCardMetadata.installmentNumber, total: t.creditCardMetadata.totalInstallments }
            : null,
      })),
    };
  }

  async refreshItem(itemId: string) {
    await this.call("PATCH", `/items/${encodeURIComponent(itemId)}`, {});
  }

  async deleteItem(itemId: string) {
    try {
      await this.call("DELETE", `/items/${encodeURIComponent(itemId)}`);
    } catch (e) {
      // Item já inexistente no provedor: consideramos revogado.
      if (!(e instanceof BankProviderError && e.status === 404)) throw e;
    }
  }

  verifyWebhook(rawBody: string, headers: Headers): { ok: true; event: WebhookEvent } | { ok: false; reason: string } {
    const secret = this.cfg.webhookSecret;
    if (!secret) return { ok: false, reason: "segredo de webhook não configurado" };
    const header = headers.get("x-pluggy-signature");
    if (!header) return { ok: false, reason: "assinatura ausente" };
    const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
    const t = Number(parts.t);
    if (!parts.v1 || !/^[0-9a-f]{64}$/.test(parts.v1) || !Number.isFinite(t)) return { ok: false, reason: "assinatura malformada" };
    if (Math.abs(this.now() / 1000 - t) > REPLAY_WINDOW_S) return { ok: false, reason: "timestamp fora da janela (replay)" };
    const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest();
    if (!timingSafeEqual(expected, Buffer.from(parts.v1, "hex"))) return { ok: false, reason: "assinatura inválida" };
    try {
      const p = JSON.parse(rawBody) as { eventId?: string; event?: string; itemId?: string; accountId?: string; transactionIds?: string[] };
      if (!p.eventId || !p.event) return { ok: false, reason: "evento sem eventId" };
      return { ok: true, event: { eventId: p.eventId, event: p.event, itemId: p.itemId ?? null, accountId: p.accountId ?? null, transactionIds: p.transactionIds ?? [] } };
    } catch {
      return { ok: false, reason: "json inválido" };
    }
  }
}
