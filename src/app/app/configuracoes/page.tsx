import type { Metadata } from "next";
import { Suspense } from "react";
import { Download } from "lucide-react";
import { ActionForm } from "@/components/app/action-form";
import { Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Skeleton, buttonVariants } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { listMembers } from "@/server/services/workspaces";
import { requireSession } from "@/server/session";
import { createWorkspaceAction, updateProfileAction } from "../actions";
import { deleteAccountAction } from "./account-actions";

export const metadata: Metadata = { title: "Configurações" };

const TIMEZONES = ["America/Sao_Paulo", "America/Manaus", "America/Belem", "America/Fortaleza", "America/Recife", "America/Cuiaba", "America/Porto_Velho", "America/Rio_Branco", "America/Noronha", "America/New_York", "Europe/Lisbon", "UTC"];

async function Settings() {
  const s = await requireSession();
  const { prefs, members } = await db.asUser(s.userId, async (q) => ({
    prefs: (await q.query<{ quiet_hours_start: string | null; quiet_hours_end: string | null; channels: Record<string, boolean>; memory_enabled: boolean }>(
      "select quiet_hours_start::text, quiet_hours_end::text, channels, memory_enabled from user_preferences where user_id = $1",
      [s.userId],
    ))[0],
    members: await listMembers(q, s.workspace.id),
  }));
  const p = s.profile;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Perfil e assistente" />
        <CardBody>
          <ActionForm action={updateProfileAction} submitLabel="Salvar" resetOnSuccess={false}>
            <Field label="Nome" htmlFor="fullName"><Input id="fullName" name="fullName" defaultValue={p.full_name ?? ""} /></Field>
            <Field label="E-mail" htmlFor="email"><Input id="email" value={s.email ?? ""} disabled readOnly /></Field>
            <Field label="Fuso horário" htmlFor="timezone">
              <Select id="timezone" name="timezone" defaultValue={p.timezone}>
                {[...new Set([p.timezone, ...TIMEZONES])].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome do assistente" htmlFor="assistantName"><Input id="assistantName" name="assistantName" defaultValue={p.assistant_name} maxLength={30} /></Field>
              <Field label="Estilo de resposta" htmlFor="assistantStyle">
                <Select id="assistantStyle" name="assistantStyle" defaultValue={p.assistant_style}>
                  <option value="objetivo">Objetivo</option><option value="detalhado">Detalhado</option><option value="formal">Formal</option><option value="amigavel">Amigável</option>
                </Select>
              </Field>
            </div>
            <fieldset className="space-y-1.5 text-sm text-muted">
              <legend className="mb-1 text-xs font-medium">Canais de notificação</legend>
              <label className="flex items-center gap-2"><input type="checkbox" name="ch_email" defaultChecked={prefs?.channels?.email ?? true} className="accent-[var(--gold)]" /> E-mail</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="ch_whatsapp" defaultChecked={prefs?.channels?.whatsapp ?? false} className="accent-[var(--gold)]" /> WhatsApp</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="ch_push" defaultChecked={prefs?.channels?.push ?? false} className="accent-[var(--gold)]" /> Push</label>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Silêncio a partir de" htmlFor="quietStart"><Input id="quietStart" name="quietStart" type="time" defaultValue={prefs?.quiet_hours_start?.slice(0, 5) ?? ""} /></Field>
              <Field label="Até" htmlFor="quietEnd"><Input id="quietEnd" name="quietEnd" type="time" defaultValue={prefs?.quiet_hours_end?.slice(0, 5) ?? ""} /></Field>
            </div>
            <label className="flex items-start gap-2 text-sm text-muted">
              <input type="checkbox" name="memory" defaultChecked={prefs?.memory_enabled ?? false} className="mt-1 accent-[var(--gold)]" />
              Permitir que o assistente use o histórico recente da conversa como contexto (memória consentida).
            </label>
          </ActionForm>
        </CardBody>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader title={`Workspace: ${s.workspace.name}`} description={`Seu papel: ${s.workspace.role}. Membros: ${members.length}.`} />
          <CardBody className="space-y-4">
            <ul className="space-y-1 text-sm">{members.map((m) => <li key={m.user_id} className="flex justify-between"><span>{m.full_name ?? "Membro"}</span><span className="text-muted">{m.role}</span></li>)}</ul>
            <ActionForm action={createWorkspaceAction} submitLabel="Criar workspace">
              <p className="text-xs text-muted">Crie um workspace de família ou empresa. Dados pessoais continuam no workspace pessoal.</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nome" htmlFor="ws-name"><Input id="ws-name" name="name" required maxLength={80} /></Field>
                <Field label="Tipo" htmlFor="ws-kind"><Select id="ws-kind" name="kind"><option value="family">Família</option><option value="business">Empresa</option></Select></Field>
              </div>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Privacidade e dados (LGPD)" />
          <CardBody className="space-y-4">
            <a href="/api/account/export" className={buttonVariants({ variant: "secondary" })}><Download /> Exportar meus dados (JSON)</a>
            <div className="rounded-lg border border-danger/30 p-4">
              <p className="text-sm font-medium text-danger">Excluir conta</p>
              <p className="mt-1 text-xs text-muted">Ação irreversível: apaga seus dados, documentos e workspaces dos quais você é o único proprietário.</p>
              <div className="mt-3">
                <ActionForm action={deleteAccountAction} submitLabel="Excluir definitivamente">
                  <Field label="Digite EXCLUIR para confirmar" htmlFor="confirm"><Input id="confirm" name="confirm" autoComplete="off" required /></Field>
                </ActionForm>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default function ConfiguracoesPage() {
  return (
    <>
      <PageHeader title="Configurações" />
      <Suspense fallback={<Skeleton className="h-96" />}><Settings /></Suspense>
    </>
  );
}
