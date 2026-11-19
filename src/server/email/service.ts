import type { Database } from "@/lib/db/types";
import { sha256Hex } from "@/lib/crypto";
import type { EmailProvider, SendResult } from "./providers";
import { renderTemplate, type TemplateId } from "./templates";

export interface SendEmailRequest {
  workspaceId?: string | null;
  template: TemplateId;
  to: string;
  data: Record<string, string>;
  /** Evento de negócio que originou o envio (ex.: "briefing:2026-11-19"). */
  eventKey: string;
}

export type EmailDispatchStatus = "accepted" | "failed" | "ambiguous" | "duplicate" | "not_configured";

export interface EmailDispatchResult {
  status: EmailDispatchStatus;
  provider?: string;
  providerMessageId?: string;
  attempts: { provider: string; outcome: SendResult["outcome"]; error?: string }[];
}

export interface EmailServiceDeps {
  db: Database;
  /** Ordem de prioridade (primário primeiro). Apenas provedores configurados. */
  providers: EmailProvider[];
  from: string | null;
  appUrl: string;
}

/** Chave de idempotência: template + destinatário + evento. */
export function emailIdempotencyKey(template: string, to: string, eventKey: string): string {
  return `email:${sha256Hex(`${template}|${to.trim().toLowerCase()}|${eventKey}`)}`;
}

/**
 * Envia e-mail com idempotência e fallback seguro:
 *  - Reserva a chave em email_messages (unique). Já existente => não reenvia.
 *  - Tenta o primário; somente recusa COMPROVADA ("rejected") permite tentar o secundário.
 *  - Resultado ambíguo (timeout/5xx) encerra sem fallback e marca "ambiguous" para reconciliação via webhook.
 */
export async function sendEmail(deps: EmailServiceDeps, req: SendEmailRequest): Promise<EmailDispatchResult> {
  if (!deps.providers.length || !deps.from) return { status: "not_configured", attempts: [] };
  const key = emailIdempotencyKey(req.template, req.to, req.eventKey);
  const rendered = renderTemplate(req.template, req.data, deps.appUrl);

  const reserved = await deps.db.asService((q) =>
    q.query<{ id: string }>(
      `insert into email_messages (workspace_id, idempotency_key, template, to_email, subject)
       values ($1, $2, $3, $4, $5) on conflict (idempotency_key) do nothing returning id`,
      [req.workspaceId ?? null, key, req.template, req.to, rendered.subject],
    ),
  );
  if (!reserved.length) {
    const [existing] = await deps.db.asService((q) =>
      q.query<{ status: string; provider: string | null; provider_message_id: string | null }>(
        "select status, provider, provider_message_id from email_messages where idempotency_key = $1",
        [key],
      ),
    );
    return { status: "duplicate", provider: existing?.provider ?? undefined, providerMessageId: existing?.provider_message_id ?? undefined, attempts: [] };
  }
  const id = reserved[0].id;
  const attempts: EmailDispatchResult["attempts"] = [];

  for (const provider of deps.providers) {
    const result = await provider.send({
      from: deps.from, to: req.to, subject: rendered.subject, html: rendered.html, text: rendered.text,
      idempotencyKey: key, tags: { template: req.template },
    });
    attempts.push({ provider: provider.name, outcome: result.outcome, error: "error" in result ? result.error : undefined });

    if (result.outcome === "accepted") {
      await persist(deps, id, "accepted", provider.name, result.providerMessageId, attempts);
      return { status: "accepted", provider: provider.name, providerMessageId: result.providerMessageId, attempts };
    }
    if (result.outcome === "ambiguous") {
      await persist(deps, id, "ambiguous", provider.name, null, attempts);
      return { status: "ambiguous", provider: provider.name, attempts };
    }
    // rejected => tenta o próximo provedor
  }
  await persist(deps, id, "failed", null, null, attempts);
  return { status: "failed", attempts };
}

async function persist(deps: EmailServiceDeps, id: string, status: string, provider: string | null, providerMessageId: string | null, attempts: unknown) {
  await deps.db.asService((q) =>
    q.query("update email_messages set status = $2, provider = $3, provider_message_id = $4, attempts = $5 where id = $1", [
      id, status, provider, providerMessageId, JSON.stringify(attempts),
    ]),
  );
}

/** Atualiza status por webhook (entregue/bounce/falha). Nunca regride "delivered". */
export async function applyEmailWebhook(db: Database, provider: string, providerMessageId: string, status: "delivered" | "bounced" | "failed") {
  await db.asService((q) =>
    q.query(
      `update email_messages set status = $3
       where provider = $1 and provider_message_id = $2 and status <> 'delivered'`,
      [provider, providerMessageId, status],
    ),
  );
}
