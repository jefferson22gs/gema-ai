import type { Database } from "@/lib/db/types";
import { verifyTimestampedHmac } from "../webhooks/verify";

/**
 * BillingProvider plugável. Nenhum provedor de pagamento real foi escolhido/credenciado:
 * o checkout responde "não configurado" e NENHUMA cobrança é simulada como concluída.
 * Webhooks seguem um envelope normalizado assinado (HMAC + timestamp), adaptável ao provedor eleito.
 */
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled";

export interface BillingEvent {
  id: string;
  type: "subscription.updated" | "invoice.paid" | "invoice.payment_failed" | "subscription.cancelled";
  workspaceId: string;
  planId?: string;
  status?: SubscriptionStatus;
  providerSubscriptionId?: string;
  currentPeriodEnd?: string;
}

export interface BillingProvider {
  readonly name: string;
  createCheckout(workspaceId: string, planId: string, returnUrl: string): Promise<{ url: string } | { error: string }>;
  verifyWebhook(rawBody: string, headers: Headers): { ok: true; event: BillingEvent } | { ok: false; reason: string };
}

export class UnconfiguredBillingProvider implements BillingProvider {
  readonly name = "none";
  async createCheckout() {
    return { error: "Cobrança ainda não configurada. Nenhum pagamento foi processado." };
  }
  verifyWebhook() {
    return { ok: false as const, reason: "billing não configurado" };
  }
}

/** Envelope genérico assinado: header x-gema-signature: t=<unix>,v1=<hmac>. */
export class SignedEnvelopeBillingProvider implements BillingProvider {
  constructor(readonly name: string, private readonly secret: string) {}
  async createCheckout() {
    return { error: `Checkout do provedor "${this.name}" ainda não implementado. Configure o adaptador antes de vender.` };
  }
  verifyWebhook(rawBody: string, headers: Headers) {
    const check = verifyTimestampedHmac(rawBody, headers.get("x-gema-signature"), this.secret);
    if (!check.ok) return check;
    try {
      return { ok: true as const, event: JSON.parse(rawBody) as BillingEvent };
    } catch {
      return { ok: false as const, reason: "json inválido" };
    }
  }
}

const GRACE_DAYS = 7;

/** Aplica evento de cobrança (idempotente por (provider, event id)). */
export async function applyBillingEvent(db: Database, provider: string, event: BillingEvent): Promise<"applied" | "duplicate"> {
  return db.asService(async (q) => {
    const ins = await q.query(
      `insert into billing_events (provider, provider_event_id, workspace_id, event_type, payload) values ($1, $2, $3, $4, $5)
       on conflict (provider, provider_event_id) do nothing returning id`,
      [provider, event.id, event.workspaceId, event.type, JSON.stringify(event)],
    );
    if (!ins.length) return "duplicate";
    const status: SubscriptionStatus | undefined =
      event.type === "invoice.paid" ? "active" : event.type === "invoice.payment_failed" ? "past_due" : event.type === "subscription.cancelled" ? "cancelled" : event.status;
    await q.query(
      `update subscriptions set
         status = coalesce($2, status),
         plan_id = coalesce($3, plan_id),
         provider = $4,
         provider_subscription_id = coalesce($5, provider_subscription_id),
         current_period_end = coalesce($6::timestamptz, current_period_end),
         grace_until = case when $2 = 'past_due' then now() + make_interval(days => $7) when $2 = 'active' then null else grace_until end
       where workspace_id = $1`,
      [event.workspaceId, status ?? null, event.planId ?? null, provider, event.providerSubscriptionId ?? null, event.currentPeriodEnd ?? null, GRACE_DAYS],
    );
    if (event.planId) await q.query("update workspaces set plan_id = $2 where id = $1", [event.workspaceId, event.planId]);
    await q.query("update billing_events set processed_at = now() where provider = $1 and provider_event_id = $2", [provider, event.id]);
    return "applied";
  });
}

export function billingProvider(): BillingProvider {
  const name = process.env.BILLING_PROVIDER?.trim();
  const secret = process.env.BILLING_WEBHOOK_SECRET?.trim();
  return name && secret ? new SignedEnvelopeBillingProvider(name, secret) : new UnconfiguredBillingProvider();
}
