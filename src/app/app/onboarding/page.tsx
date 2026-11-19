import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/app/action-form";
import { Card, CardBody, Field, Input, Select, Skeleton } from "@/components/ui/primitives";
import { requireSession } from "@/server/session";
import { completeOnboardingAction } from "../actions";

export const metadata: Metadata = { title: "Boas-vindas" };

async function Onboarding() {
  const s = await requireSession();
  return (
    <Card className="mx-auto max-w-xl">
      <CardBody className="space-y-6 p-6 sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Configuração inicial</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Vamos ajustar a GEMA para você</h1>
          <p className="mt-1 text-sm text-muted">Leva menos de um minuto. Tudo pode ser alterado depois em Configurações.</p>
        </div>
        <ActionForm action={completeOnboardingAction} submitLabel="Concluir e abrir o painel" resetOnSuccess={false}>
          <Field label="Como devemos chamar você?" htmlFor="fullName"><Input id="fullName" name="fullName" defaultValue={s.profile.full_name ?? ""} /></Field>
          <Field label="Fuso horário" htmlFor="timezone" hint="Usado para interpretar “amanhã às 10” e enviar lembretes no horário certo.">
            <Select id="timezone" name="timezone" defaultValue={s.profile.timezone}>
              {["America/Sao_Paulo", "America/Manaus", "America/Fortaleza", "America/Recife", "America/Cuiaba", "America/Rio_Branco", "America/Noronha", "UTC"].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </Select>
          </Field>
          <Field label="Nome do assistente" htmlFor="assistantName"><Input id="assistantName" name="assistantName" defaultValue={s.profile.assistant_name} maxLength={30} /></Field>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-muted">Como você vai usar?</legend>
            {[["personal", "Só para mim (workspace pessoal)"], ["family", "Também com a família"], ["business", "Também para meu negócio"]].map(([v, l]) => (
              <label key={v} className="flex items-center gap-2 text-sm"><input type="radio" name="workspaceKind" value={v} defaultChecked={v === "personal"} className="accent-[var(--gold)]" />{l}</label>
            ))}
          </fieldset>
          <Field label="Nome do workspace compartilhado (se aplicável)" htmlFor="workspaceName"><Input id="workspaceName" name="workspaceName" placeholder="Ex.: Família Silva" maxLength={80} /></Field>
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" name="briefing" defaultChecked className="accent-[var(--gold)]" /> Ativar briefing diário às 07:00 (painel e e-mail)</label>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-[480px] max-w-xl" />}>
      <Onboarding />
    </Suspense>
  );
}
