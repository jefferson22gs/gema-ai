/**
 * BankProvider — contrato independente de fornecedor para Open Finance (somente leitura).
 * Implementações: PluggyProvider (src/server/open-finance/pluggy.ts); Belvo (futuro, ver docs/OPEN_FINANCE.md).
 * Valores monetários sempre em centavos; sinais normalizados (despesa = saída).
 */
export type ConnectionStatus = "connecting" | "syncing" | "updated" | "outdated" | "error" | "consent_expired" | "revoked" | "waiting_user" | "unavailable";

export interface ProviderInstitution {
  id: string;
  name: string;
  imageUrl: string | null;
  isOpenFinance: boolean;
  isSandbox: boolean;
}

export interface ProviderItem {
  id: string;
  status: ConnectionStatus;
  providerStatus: string;
  providerExecutionStatus: string | null;
  statusDetail: string | null;
  consentExpiresAt: Date | null;
  lastUpdatedAt: Date | null;
  institution: ProviderInstitution;
}

export interface ProviderAccount {
  id: string;
  kind: "bank" | "credit";
  subtype: string | null;
  name: string;
  numberMasked: string | null;
  currency: string;
  balanceCents: number | null;
  creditLimitCents: number | null;
  creditAvailableCents: number | null;
  /** Ciclo do cartão quando informado pelo provedor. */
  closingDate: string | null;
  dueDate: string | null;
}

export interface ProviderTransaction {
  id: string;
  description: string;
  /** Valor absoluto em centavos. */
  amountCents: number;
  direction: "out" | "in";
  date: string;
  status: "posted" | "pending";
  category: string | null;
  merchant: string | null;
  installment: { number: number; total: number } | null;
}

export interface TransactionsPage {
  transactions: ProviderTransaction[];
  /** Cursor para a próxima página (null = fim). */
  next: string | null;
}

export interface WebhookEvent {
  eventId: string;
  event: string;
  itemId: string | null;
  accountId: string | null;
  transactionIds: string[];
}

export interface BankProvider {
  readonly name: "pluggy" | "belvo";
  /** Token curto para abrir o widget oficial de conexão (o GEMA nunca vê a senha bancária). */
  createConnectToken(input: { clientUserId: string; itemId?: string; webhookUrl?: string }): Promise<{ token: string; expiresInSeconds: number }>;
  listInstitutions(input: { openFinanceOnly?: boolean; sandbox?: boolean; name?: string }): Promise<ProviderInstitution[]>;
  getItem(itemId: string): Promise<ProviderItem>;
  listAccounts(itemId: string): Promise<ProviderAccount[]>;
  listTransactions(accountId: string, opts: { from?: string; to?: string; cursor?: string | null }): Promise<TransactionsPage>;
  /** Dispara atualização no provedor (limitado; preferir sync diário automático). */
  refreshItem(itemId: string): Promise<void>;
  /** Exclui o item no provedor (revoga consentimento e apaga dados lá). */
  deleteItem(itemId: string): Promise<void>;
  verifyWebhook(rawBody: string, headers: Headers): { ok: true; event: WebhookEvent } | { ok: false; reason: string };
}

export class BankProviderError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
    this.name = "BankProviderError";
  }
}
