import type { Database, Queryable } from "@/lib/db/types";
import { localParts } from "@/lib/time";
import type { EmailDispatchResult, SendEmailRequest } from "../email/service";
import type { MessagingProvider } from "../messaging/types";

/**
 * Entrega do outbox de notificações. A PREPARAÇÃO (criar linha no outbox com dedupe_key)
 * é separada do ENVIO e da DECISÃO DE CANAL (aqui):
 *  - canal só é usado se habilitado nas preferências e com consentimento/identidade verificada;
 *  - quiet hours adiam canais intrusivos (whatsapp/push), nunca o painel;
 *  - falha em um canal => fallback para e-mail/push se consentido, sem duplicar o alerta;
 *  - retries com backoff exponencial e dead-letter após MAX_ATTEMPTS.
 */
export const MAX_ATTEMPTS = 5;

export interface DispatcherDeps {
  db: Database;
  now: Date;
  sendEmail: ((req: SendEmailRequest) => Promise<EmailDispatchResult>) | null;
  whatsapp: MessagingProvider | null;
  sendPush: ((sub: { endpoint: string; p256dh: string; auth: string }, payload: string) => Promise<{ ok: boolean; gone?: boolean }>) | null;
}

interface OutboxRow {
  id: string;
  workspace_id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  channels: string[];
  dedupe_key: string;
  attempts: number;
  email: string | null;
  timezone: string;
  prefs_channels: Record<string, boolean>;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

export function inQuietHours(now: Date, tz: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const p = localParts(now, tz);
  const minutes = p.hour * 60 + p.minute;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const s = toMin(start);
  const e = toMin(end);
  return s <= e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

export function backoffSeconds(attempt: number): number {
  return Math.min(60 * 2 ** attempt, 6 * 3600);
}

type ChannelResult = "sent" | "failed" | "skipped" | "deferred";

export async function dispatchOutbox(deps: DispatcherDeps, limit = 50): Promise<{ processed: number; sent: number; failed: number; dead: number }> {
  const rows = await deps.db.asService((q) =>
    q.query<OutboxRow>(
      `update notification_outbox o set status = 'processing', attempts = o.attempts + 1
       from (
         select n.id from notification_outbox n
         where n.status in ('pending', 'failed') and n.next_attempt_at <= $1
         order by n.next_attempt_at limit $2 for update skip locked
       ) due
       where o.id = due.id
       returning o.id, o.workspace_id, o.user_id, o.kind, o.title, o.body, o.channels, o.dedupe_key, o.attempts,
         (select p.email from profiles p where p.id = o.user_id) as email,
         (select p.timezone from profiles p where p.id = o.user_id) as timezone,
         (select up.channels from user_preferences up where up.user_id = o.user_id) as prefs_channels,
         (select up.quiet_hours_start::text from user_preferences up where up.user_id = o.user_id) as quiet_hours_start,
         (select up.quiet_hours_end::text from user_preferences up where up.user_id = o.user_id) as quiet_hours_end`,
      [deps.now, limit],
    ),
  );

  let sent = 0;
  let failed = 0;
  let dead = 0;
  for (const row of rows) {
    const outcome = await deliver(deps, row);
    if (outcome === "sent") sent++;
    else if (outcome === "dead") dead++;
    else failed++;
  }
  return { processed: rows.length, sent, failed, dead };
}

async function alreadyDelivered(q: Queryable, outboxId: string, channel: string): Promise<boolean> {
  const r = await q.query("select 1 from notification_deliveries where outbox_id = $1 and channel = $2 and status in ('accepted', 'delivered', 'ambiguous')", [outboxId, channel]);
  return r.length > 0;
}

async function recordDelivery(db: Database, outboxId: string, channel: string, status: string, provider?: string, providerMessageId?: string, error?: string) {
  await db.asService((q) =>
    q.query(
      "insert into notification_deliveries (outbox_id, channel, provider, provider_message_id, status, error) values ($1, $2, $3, $4, $5, $6)",
      [outboxId, channel, provider ?? null, providerMessageId ?? null, status, error?.slice(0, 500) ?? null],
    ),
  );
}

async function deliver(deps: DispatcherDeps, row: OutboxRow): Promise<"sent" | "failed" | "dead"> {
  const prefs = row.prefs_channels ?? {};
  const quiet = inQuietHours(deps.now, row.timezone ?? "America/Sao_Paulo", row.quiet_hours_start, row.quiet_hours_end);
  const results: Record<string, ChannelResult> = {};

  const tryChannel = async (channel: string): Promise<ChannelResult> => {
    if (await deps.db.asService((q) => alreadyDelivered(q, row.id, channel))) return "sent";
    if (channel === "dashboard") {
      await recordDelivery(deps.db, row.id, "dashboard", "delivered");
      return "sent";
    }
    if (prefs[channel] === false) return "skipped";
    if (channel === "email") {
      if (!deps.sendEmail || !row.email) return "skipped";
      const r = await deps.sendEmail({
        workspaceId: row.workspace_id, template: row.kind === "briefing" ? "briefing" : "reminder", to: row.email,
        data: { title: row.title, body: row.body, date: row.title }, eventKey: row.dedupe_key,
      });
      if (r.status === "accepted" || r.status === "duplicate") {
        await recordDelivery(deps.db, row.id, "email", "accepted", r.provider, r.providerMessageId);
        return "sent";
      }
      if (r.status === "ambiguous") {
        // Pode ter sido entregue: não tenta de novo nem faz fallback duplicado.
        await recordDelivery(deps.db, row.id, "email", "ambiguous", r.provider);
        return "sent";
      }
      if (r.status === "not_configured") return "skipped";
      await recordDelivery(deps.db, row.id, "email", "failed", r.provider, undefined, r.attempts.map((a) => a.error).join("; "));
      return "failed";
    }
    if (quiet) return "deferred";
    if (channel === "whatsapp") {
      if (!deps.whatsapp) return "skipped";
      const [acct] = await deps.db.asService((q) =>
        q.query<{ address: string }>(
          "select address from channel_accounts where user_id = $1 and provider = $2 and status = 'verified' and opted_in_at is not null",
          [row.user_id, deps.whatsapp!.name],
        ),
      );
      if (!acct) return "skipped";
      const r = await deps.whatsapp.sendText(acct.address, `*${row.title}*\n${row.body}`);
      await recordDelivery(deps.db, row.id, "whatsapp", r.ok ? "accepted" : "failed", deps.whatsapp.name, r.providerMessageId, r.error);
      return r.ok ? "sent" : "failed";
    }
    if (channel === "push") {
      if (!deps.sendPush) return "skipped";
      const subs = await deps.db.asService((q) =>
        q.query<{ id: string; endpoint: string; p256dh: string; auth: string }>("select id, endpoint, p256dh, auth from push_subscriptions where user_id = $1", [row.user_id]),
      );
      if (!subs.length) return "skipped";
      let any = false;
      for (const s of subs) {
        const r = await deps.sendPush(s, JSON.stringify({ title: row.title, body: row.body, url: "/app/notificacoes" }));
        if (r.ok) any = true;
        if (r.gone) await deps.db.asService((q) => q.query("delete from push_subscriptions where id = $1", [s.id]));
      }
      await recordDelivery(deps.db, row.id, "push", any ? "accepted" : "failed", "webpush");
      return any ? "sent" : "failed";
    }
    return "skipped";
  };

  for (const channel of row.channels) results[channel] = await tryChannel(channel);

  // Fallback: se um canal externo solicitado falhou e nenhum canal externo entregou, tenta e-mail e push (se consentidos).
  const external = row.channels.filter((c) => c !== "dashboard");
  const externalSent = external.some((c) => results[c] === "sent");
  if (external.some((c) => results[c] === "failed") && !externalSent) {
    for (const fb of ["email", "push"]) {
      if (row.channels.includes(fb)) continue;
      const r = await tryChannel(fb);
      results[fb] = r;
      if (r === "sent") break;
    }
  }

  const values = Object.values(results);
  const anyFailed = values.includes("failed") && !Object.entries(results).some(([c, r]) => c !== "dashboard" && r === "sent");
  const deferred = values.includes("deferred");

  if (deferred || anyFailed) {
    const isDead = anyFailed && !deferred && row.attempts >= MAX_ATTEMPTS;
    const nextAt = deferred && row.quiet_hours_end
      ? new Date(deps.now.getTime() + 30 * 60_000)
      : new Date(deps.now.getTime() + backoffSeconds(row.attempts) * 1000);
    await deps.db.asService((q) =>
      q.query("update notification_outbox set status = $2, next_attempt_at = $3 where id = $1", [row.id, isDead ? "dead" : deferred ? "pending" : "failed", nextAt]),
    );
    if (isDead) return "dead";
    return deferred && !anyFailed ? "sent" : "failed";
  }
  const status = values.every((v) => v === "sent") ? "sent" : values.includes("sent") ? "partial" : "suppressed";
  await deps.db.asService((q) => q.query("update notification_outbox set status = $2 where id = $1", [row.id, status]));
  return "sent";
}
