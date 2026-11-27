"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { DomainError } from "@/server/context";
import { sendTransactionalEmail } from "@/server/email";
import { rateLimit } from "@/server/http";
import { ROLES, ROLE_LABEL, createInvitation, removeMember, revokeInvitation, updateMemberRole } from "@/server/services/members";
import { requireSession } from "@/server/session";

export interface InviteState {
  error?: string;
  link?: string;
  emailStatus?: string;
}

export async function inviteAction(_: InviteState, form: FormData): Promise<InviteState> {
  const s = await requireSession();
  const parsed = z.object({ email: z.email(), role: z.enum(ROLES) }).safeParse({ email: form.get("email"), role: form.get("role") });
  if (!parsed.success) return { error: "Informe um e-mail válido e o papel." };
  if (!(await rateLimit(`invite:${s.userId}`, 20, 3600))) return { error: "Limite de convites por hora atingido." };
  try {
    const inv = await db.asUser(s.userId, (q) => createInvitation(q, { workspaceId: s.workspace.id, invitedBy: s.userId, email: parsed.data.email, role: parsed.data.role }));
    const link = `${env.appUrl()}/convite/${inv.token}`;
    const mail = await sendTransactionalEmail({
      workspaceId: s.workspace.id,
      template: "workspace_invite",
      to: parsed.data.email,
      data: { workspace: s.workspace.name, role: ROLE_LABEL[parsed.data.role], link, inviter: s.profile.full_name ?? "Um membro" },
      eventKey: `invite:${inv.id}`,
    });
    refresh();
    return {
      link,
      emailStatus: mail.status === "accepted" || mail.status === "duplicate" ? "Convite enviado por e-mail." : mail.status === "not_configured" ? "E-mail não configurado: compartilhe o link abaixo." : "Não foi possível confirmar o envio do e-mail: compartilhe o link abaixo.",
    };
  } catch (e) {
    return { error: e instanceof DomainError ? e.message : "Sem permissão para convidar neste workspace." };
  }
}

export async function changeRoleAction(form: FormData) {
  const s = await requireSession();
  const userId = z.string().uuid().parse(form.get("userId"));
  const role = z.enum(ROLES).parse(form.get("role"));
  await db.asUser(s.userId, (q) => updateMemberRole(q, s.workspace.id, userId, role)).catch(() => undefined);
  refresh();
}

export async function removeMemberAction(form: FormData) {
  const s = await requireSession();
  const userId = z.string().uuid().parse(form.get("userId"));
  await db.asUser(s.userId, (q) => removeMember(q, s.workspace.id, userId)).catch(() => undefined);
  refresh();
}

export async function revokeInviteAction(form: FormData) {
  const s = await requireSession();
  const id = z.string().uuid().parse(form.get("id"));
  await db.asUser(s.userId, (q) => revokeInvitation(q, s.workspace.id, id));
  refresh();
}
