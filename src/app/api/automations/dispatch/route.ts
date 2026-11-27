import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { runDueAutomations } from "@/server/automations/engine";
import { sendTransactionalEmail } from "@/server/email";
import { json } from "@/server/http";
import { dispatchOutbox } from "@/server/notifications/dispatcher";
import { sendWebPush } from "@/server/notifications/push";
import { primaryWhatsApp } from "@/server/runtime";
import { dispatchDueReminders } from "@/server/services/reminders";
import { JOB_HANDLERS } from "@/server/jobs/handlers";
import { runJobs } from "@/server/jobs/queue";

/**
 * Job agendado (Vercel Cron / Supabase pg_cron via pg_net). Autenticado por CRON_SECRET.
 * Ordem: lembretes vencidos -> automações vencidas -> fila de jobs -> entrega do outbox. Tudo idempotente.
 */
async function handle(req: Request) {
  const secret = env.cronSecret();
  if (!secret) return json({ error: "CRON_SECRET não configurado." }, 503);
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!provided || !safeEqual(provided, secret)) return json({ error: "não autorizado" }, 401);

  const now = new Date();
  const reminders = await db.asService((q) => dispatchDueReminders(q, now));
  const automations = await runDueAutomations(db, now);
  const jobs = await runJobs(db, JOB_HANDLERS, now);
  const outbox = await dispatchOutbox({ db, now, sendEmail: sendTransactionalEmail, whatsapp: primaryWhatsApp(), sendPush: sendWebPush() });
  return json({ ok: true, at: now.toISOString(), reminders, automations, jobs, outbox });
}

export const GET = handle;
export const POST = handle;
