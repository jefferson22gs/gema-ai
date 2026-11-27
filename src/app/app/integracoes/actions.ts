"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { DomainError } from "@/server/context";
import { rateLimit } from "@/server/http";
import { revokeGoogle } from "@/server/integrations/google/oauth";
import { syncGoogleCalendar } from "@/server/integrations/google/sync";
import { confirmPhoneVerification, createLinkCode, startPhoneVerification, unlinkChannel } from "@/server/messaging/verification";
import { googleConfig, primaryWhatsApp } from "@/server/runtime";
import { requireSession } from "@/server/session";
import type { ActionState } from "../actions";

export async function startWhatsAppVerification(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const provider = primaryWhatsApp();
  if (!provider) return { error: "Canal WhatsApp não configurado nesta instalação." };
  if (!(await rateLimit(`wa-verify:${s.userId}`, 3, 3600))) return { error: "Limite de envios de código atingido. Tente mais tarde." };
  try {
    const r = await startPhoneVerification({ db, provider }, s.userId, s.workspace.id, String(form.get("phone") ?? ""));
    return r.sent ? { ok: true, message: "Código enviado pelo WhatsApp. Digite-o abaixo." } : { error: `Não foi possível enviar o código: ${r.error}` };
  } catch (e) {
    return { error: e instanceof DomainError ? e.message : "Falha ao iniciar verificação." };
  }
}

export async function confirmWhatsAppVerification(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const provider = primaryWhatsApp();
  if (!provider) return { error: "Canal WhatsApp não configurado." };
  const code = z.string().regex(/^\d{6}$/).safeParse(String(form.get("code") ?? "").trim());
  if (!code.success) return { error: "Informe o código de 6 dígitos." };
  const ok = await confirmPhoneVerification(db, provider.name, s.userId, code.data);
  if (!ok) return { error: "Código inválido ou expirado." };
  refresh();
  return { ok: true, message: "Número verificado. Você já pode falar com a GEMA pelo WhatsApp." };
}

export async function revokeWhatsApp(form: FormData) {
  const s = await requireSession();
  const id = z.string().uuid().parse(form.get("id"));
  await unlinkChannel(db, s.userId, id);
  refresh();
}

/** Gera código de vinculação inbound (mostrado uma única vez ao usuário autenticado). */
export async function createWhatsAppLinkCode(): Promise<{ code?: string; expiresAt?: string; number?: string | null; error?: string }> {
  const s = await requireSession();
  const provider = primaryWhatsApp();
  if (!provider) return { error: "Canal WhatsApp não configurado nesta instalação." };
  if (!(await rateLimit(`wa-link:${s.userId}`, 5, 3600))) return { error: "Limite de códigos atingido. Tente em 1 hora." };
  const r = await createLinkCode(db, s.userId, s.workspace.id, provider.name);
  return { code: r.code, expiresAt: r.expiresAt.toISOString(), number: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.trim() || null };
}

export async function updateWhatsAppPrivacy(form: FormData) {
  const s = await requireSession();
  const id = z.string().uuid().parse(form.get("id"));
  await db.asUser(s.userId, (q) =>
    q.query(
      "update channel_accounts set show_balances = $3, show_transactions = $4, show_documents = $5 where id = $1 and user_id = $2",
      [id, s.userId, form.get("show_balances") === "on", form.get("show_transactions") === "on", form.get("show_documents") === "on"],
    ),
  );
  refresh();
}

export async function disconnectGoogle(form: FormData) {
  const s = await requireSession();
  const cfg = googleConfig();
  const product = z.enum(["calendar", "contacts"]).parse(form.get("product"));
  if (cfg) await revokeGoogle(db, cfg, s.userId, s.workspace.id, product);
  refresh();
}

export async function syncGoogleNow(): Promise<void> {
  const s = await requireSession();
  const cfg = googleConfig();
  if (!cfg) return;
  if (!(await rateLimit(`gsync:${s.userId}`, 6, 600))) return;
  await syncGoogleCalendar(db, cfg, s.userId, s.workspace.id);
  refresh();
}
