import type { Metadata } from "next";
import { Suspense } from "react";
import { Users } from "lucide-react";
import { InviteForm } from "@/components/app/invite-form";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { maskPii } from "@/lib/utils";
import { ROLES, ROLE_LABEL, listInvitations, myPermissions } from "@/server/services/members";
import { listMembers } from "@/server/services/workspaces";
import { actorContext, requireSession } from "@/server/session";
import { changeRoleAction, removeMemberAction, revokeInviteAction } from "./actions";

export const metadata: Metadata = { title: "Membros e permissões" };

const MODULE_LABEL: Record<string, string> = {
  finance: "Finanças", banking: "Bancos", calendar: "Agenda", tasks: "Tarefas", contacts: "Contatos", documents: "Documentos",
  automations: "Automações", crm: "CRM", fiscal: "Fiscal", reports: "Relatórios", members: "Membros", settings: "Configurações",
};
const ACTION_LABEL: Record<string, string> = { read: "ver", write: "editar", delete: "excluir", export: "exportar", manage: "gerenciar" };

async function Members() {
  const s = await requireSession();
  const { members, perms } = await db.asUser(s.userId, async (q) => ({ members: await listMembers(q, s.workspace.id), perms: await myPermissions(q, s.workspace.id) }));
  const canManage = perms.members.includes("manage");
  const invitations = canManage ? await db.asUser(s.userId, (q) => listInvitations(q, s.workspace.id)) : [];
  const now = actorContext(s).now.getTime();

  if (s.workspace.kind === "personal") {
    return (
      <Card>
        <CardBody>
          <EmptyState icon={<Users />} title="Seu workspace pessoal é só seu" description="Para convidar família ou equipe, crie um workspace de família ou empresa em Configurações e troque para ele no topo da tela." />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader title={`Membros de ${s.workspace.name}`} description="Cada pessoa vê apenas o que é compartilhado no workspace e o que o papel permite. Itens privados continuam privados." />
          <CardBody>
            <ul className="divide-y divide-border">
              {members.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <span>{m.full_name ?? "Membro"}{m.user_id === s.userId ? <Badge className="ml-2">você</Badge> : null}</span>
                  {canManage && m.role !== "owner" && m.user_id !== s.userId ? (
                    <div className="flex items-center gap-2">
                      <form action={changeRoleAction} className="flex items-center gap-1">
                        <input type="hidden" name="userId" value={m.user_id} />
                        <label className="sr-only" htmlFor={`role-${m.user_id}`}>Papel</label>
                        <select id={`role-${m.user_id}`} name="role" defaultValue={m.role} className="h-8 rounded-md border border-border bg-surface px-2 text-xs">
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                        <button className="h-8 rounded-md border border-border px-2 text-xs text-muted hover:text-fg">Salvar</button>
                      </form>
                      <form action={removeMemberAction}><input type="hidden" name="userId" value={m.user_id} /><button className="text-xs text-danger hover:underline">Remover</button></form>
                    </div>
                  ) : <Badge tone={m.role === "owner" ? "gold" : "neutral"}>{ROLE_LABEL[m.role] ?? m.role}</Badge>}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Suas permissões neste workspace" />
          <CardBody>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {Object.entries(perms).map(([mod, acts]) => (
                <div key={mod} className="flex justify-between gap-2 rounded-md bg-surface-2 px-3 py-2">
                  <dt>{MODULE_LABEL[mod]}</dt>
                  <dd className="text-right text-xs text-muted">{acts.length ? acts.map((a) => ACTION_LABEL[a]).join(", ") : "sem acesso"}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>

      <div className="space-y-6">
        {canManage ? (
          <>
            <Card>
              <CardHeader title="Convidar pessoa" description="O convite vale 7 dias e só funciona para o e-mail informado." />
              <CardBody><InviteForm roles={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} /></CardBody>
            </Card>
            <Card>
              <CardHeader title="Convites" />
              <CardBody>
                {invitations.length ? (
                  <ul className="space-y-2 text-sm">
                    {invitations.map((i) => {
                      const state = i.accepted_at ? ["Aceito", "success"] : i.revoked_at ? ["Revogado", "neutral"] : new Date(i.expires_at).getTime() < now ? ["Expirado", "neutral"] : ["Pendente", "warning"];
                      return (
                        <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>{maskPii(i.email)} · {ROLE_LABEL[i.role]}<span className="block text-[11px] text-subtle">{formatDateTime(i.created_at, s.profile.timezone)}</span></span>
                          <span className="flex items-center gap-2">
                            <Badge tone={state[1] as "success" | "neutral" | "warning"}>{state[0]}</Badge>
                            {state[0] === "Pendente" ? <form action={revokeInviteAction}><input type="hidden" name="id" value={i.id} /><button className="text-xs text-danger hover:underline">Revogar</button></form> : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="text-sm text-muted">Nenhum convite enviado.</p>}
              </CardBody>
            </Card>
          </>
        ) : <Alert tone="neutral">Apenas proprietários e administradores convidam e alteram papéis.</Alert>}
      </div>
    </div>
  );
}

export default function MembrosPage() {
  return (
    <>
      <PageHeader title="Membros e permissões" />
      <Suspense fallback={<Skeleton className="h-96" />}><Members /></Suspense>
    </>
  );
}
