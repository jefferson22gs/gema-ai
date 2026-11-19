import "server-only";
import { db } from "@/lib/db";
import { maskPii } from "@/lib/utils";

/**
 * Consultas administrativas (service role) com MINIMIZAÇÃO: apenas metadados agregados.
 * Nunca retornam conteúdo de mensagens, transações, contatos ou documentos de clientes.
 * Toda visualização administrativa é auditada.
 */
export async function auditAdminView(adminId: string, page: string) {
  await db.asService((q) =>
    q.query("insert into audit_logs (actor_id, actor_type, action, resource_type, resource_id) values ($1, 'admin', 'admin.view', 'page', $2)", [adminId, page]),
  );
}

export async function overviewMetrics() {
  const [row] = await db.asService((q) =>
    q.query<{
      users: number; workspaces: number; active_subs: number; trialing: number; past_due: number; mrr_cents: number;
      ai_cost_month: number; ai_calls_month: number; emails_month: number; failed_jobs: number; webhook_rejects_24h: number; outbox_dead: number;
    }>(`
      select
        (select count(*) from profiles)::bigint as users,
        (select count(*) from workspaces where deleted_at is null)::bigint as workspaces,
        (select count(*) from subscriptions where status = 'active')::bigint as active_subs,
        (select count(*) from subscriptions where status = 'trialing')::bigint as trialing,
        (select count(*) from subscriptions where status = 'past_due')::bigint as past_due,
        (select coalesce(sum(p.price_cents), 0) from subscriptions s join plans p on p.id = s.plan_id where s.status = 'active')::bigint as mrr_cents,
        (select coalesce(sum(estimated_cost_usd), 0) from ai_usage where created_at >= date_trunc('month', now()))::float8 as ai_cost_month,
        (select count(*) from ai_usage where created_at >= date_trunc('month', now()))::bigint as ai_calls_month,
        (select count(*) from email_messages where created_at >= date_trunc('month', now()))::bigint as emails_month,
        (select count(*) from automation_runs where status in ('failed', 'dead'))::bigint as failed_jobs,
        (select count(*) from provider_webhook_events where not signature_valid and received_at > now() - interval '24 hours')::bigint as webhook_rejects_24h,
        (select count(*) from notification_outbox where status = 'dead')::bigint as outbox_dead
    `),
  );
  return row;
}

export async function listClients() {
  const rows = await db.asService((q) =>
    q.query<{ id: string; name: string; kind: string; plan_id: string; status: string | null; members: number; created_at: Date; owner_email: string | null; ai_calls: number; storage_bytes: number }>(`
      select w.id, w.name, w.kind, w.plan_id, s.status, w.created_at,
        (select count(*) from workspace_members m where m.workspace_id = w.id)::bigint as members,
        (select p.email from profiles p where p.id = w.created_by) as owner_email,
        (select count(*) from ai_usage u where u.workspace_id = w.id and u.created_at >= date_trunc('month', now()))::bigint as ai_calls,
        (select coalesce(sum(size_bytes), 0) from documents d where d.workspace_id = w.id and d.deleted_at is null)::bigint as storage_bytes
      from workspaces w left join subscriptions s on s.workspace_id = w.id
      where w.deleted_at is null order by w.created_at desc limit 200`),
  );
  return rows.map((r) => ({ ...r, owner_email: maskPii(r.owner_email) }));
}

export async function recentAudit(limit = 100) {
  return db.asService((q) =>
    q.query<{ id: number; workspace_id: string | null; actor_type: string; action: string; resource_type: string | null; created_at: Date }>(
      "select id, workspace_id, actor_type, action, resource_type, created_at from audit_logs order by created_at desc limit $1",
      [limit],
    ),
  );
}

export async function webhookHealth() {
  return db.asService((q) =>
    q.query<{ provider: string; total: number; rejected: number; failed: number; last_at: Date | null }>(`
      select provider, count(*)::bigint as total,
        count(*) filter (where not signature_valid)::bigint as rejected,
        count(*) filter (where status = 'failed')::bigint as failed,
        max(received_at) as last_at
      from provider_webhook_events where received_at > now() - interval '7 days'
      group by provider order by provider`),
  );
}

export async function emailStats() {
  return db.asService((q) =>
    q.query<{ provider: string | null; status: string; n: number }>(
      "select provider, status, count(*)::bigint as n from email_messages where created_at > now() - interval '30 days' group by provider, status order by provider, status",
    ),
  );
}

export async function automationStats() {
  return db.asService((q) =>
    q.query<{ template: string; status: string; n: number }>(`
      select r.template, ru.status, count(*)::bigint as n
      from automation_runs ru join automation_rules r on r.id = ru.rule_id
      where ru.created_at > now() - interval '30 days' group by r.template, ru.status order by r.template`),
  );
}

export async function channelStats() {
  return db.asService((q) =>
    q.query<{ provider: string; status: string; n: number }>("select provider, status, count(*)::bigint as n from channel_accounts group by provider, status order by provider"),
  );
}

export async function billingEvents() {
  return db.asService((q) =>
    q.query<{ provider: string; event_type: string; processed_at: Date | null; created_at: Date; error: string | null }>(
      "select provider, event_type, processed_at, created_at, error from billing_events order by created_at desc limit 50",
    ),
  );
}

export async function featureFlags() {
  return db.asService((q) => q.query<{ key: string; description: string; enabled: boolean }>("select key, description, enabled from feature_flags order by key"));
}

export async function supportCases() {
  return db.asService((q) =>
    q.query<{ id: string; workspace_id: string; subject: string; status: string; data_access_granted_until: Date | null; created_at: Date }>(
      "select id, workspace_id, subject, status, data_access_granted_until, created_at from support_cases order by created_at desc limit 100",
    ),
  );
}
