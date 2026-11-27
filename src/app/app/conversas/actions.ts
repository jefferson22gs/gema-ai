"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { DomainError } from "@/server/context";
import { primaryWhatsApp } from "@/server/runtime";
import { sendHumanReply } from "@/server/services/human-reply";
import { addNote, setMode } from "@/server/services/inbox";
import { requireSession } from "@/server/session";
import type { ActionState } from "../actions";

export async function setModeAction(form: FormData) {
  const s = await requireSession();
  const id = z.string().uuid().parse(form.get("id"));
  const mode = z.enum(["ai", "human", "copilot", "paused"]).parse(form.get("mode"));
  const version = z.coerce.number().int().parse(form.get("version"));
  await db.asUser(s.userId, (q) => setMode(q, id, mode, version)).catch(() => undefined);
  refresh();
}

export async function humanReplyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const parsed = z.object({ id: z.string().uuid(), text: z.string().min(1).max(4000), version: z.coerce.number().int() }).safeParse({
    id: form.get("id"), text: form.get("text"), version: form.get("version"),
  });
  if (!parsed.success) return { error: "Mensagem inválida." };
  try {
    const r = await sendHumanReply(db, primaryWhatsApp(), { userId: s.userId, conversationId: parsed.data.id, text: parsed.data.text, expectedVersion: parsed.data.version });
    refresh();
    return r.delivered ? { ok: true, message: "Enviada." } : { error: `Registrada, mas não entregue: ${r.error ?? "falha no canal"}` };
  } catch (e) {
    return { error: e instanceof DomainError ? e.message : "Não foi possível enviar." };
  }
}

export async function addNoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const id = z.string().uuid().safeParse(form.get("id"));
  const body = String(form.get("body") ?? "");
  if (!id.success || !body.trim()) return { error: "Nota vazia." };
  await db.asUser(s.userId, (q) => addNote(q, id.data, s.workspace.id, s.userId, body));
  refresh();
  return { ok: true, message: "Nota salva." };
}
