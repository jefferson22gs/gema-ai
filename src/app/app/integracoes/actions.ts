"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { DomainError } from "@/server/context";
import { rateLimit } from "@/server/http";
import { revokeGoogle } from "@/server/integrations/google/oauth";
import { syncGoogleCalendar } from "@/server/integrations/google/sync";
import { confirmPhoneVerification, startPhoneVerification } from "@/server/messaging/verification";
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
  await db.asService((q) => q.query("update channel_accounts set status = 'revoked' where id = $1 and user_id = $2", [id, s.userId]));
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
