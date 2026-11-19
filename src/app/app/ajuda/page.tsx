import type { Metadata } from "next";
import { ActionForm } from "@/components/app/action-form";
import { Card, CardBody, CardHeader, Field, Input, PageHeader, Textarea } from "@/components/ui/primitives";
import { openSupportCaseAction } from "../actions";

export const metadata: Metadata = { title: "Ajuda" };

const guides = [
  ["Primeiros passos", ["Conclua o onboarding com seu fuso horário.", "Registre um lançamento em Finanças e uma tarefa em Tarefas.", "Experimente o Assistente: “como está meu dia?”."]],
  ["Comandos úteis", ["“gastei 85 no almoço e 40 no combustível” — registra duas despesas.", "“marca reunião com Ana amanhã às 10” — cria compromisso e alerta conflitos.", "“grave o contato João +55 11 91234-5678” — pede confirmação antes de salvar.", "“lembrar de pagar o aluguel todo mês dia 5 às 9h” — lembrete recorrente."]],
  ["WhatsApp", ["Em Integrações, informe seu número e confirme o código recebido.", "Responda 1 para confirmar ou 2 para cancelar ações pendentes.", "Mensagens de números não verificados são ignoradas por segurança."]],
  ["Família e empresa", ["Crie um workspace em Configurações.", "Itens são privados por padrão; marque “Compartilhar com o workspace” quando quiser.", "Seu workspace pessoal nunca é visível a outros membros."]],
  ["Atalhos", ["No Assistente, Enter envia e Shift+Enter quebra linha.", "Use o microfone para enviar comandos por áudio (processados apenas quando você envia)."]],
] as const;

export default function AjudaPage() {
  return (
    <>
      <PageHeader title="Central de ajuda" description="Guias rápidos e suporte." />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          {guides.map(([title, items]) => (
            <Card key={title}>
              <CardHeader title={title} />
              <CardBody>
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">{items.map((i) => <li key={i}>{i}</li>)}</ul>
              </CardBody>
            </Card>
          ))}
        </div>
        <Card className="h-fit">
          <CardHeader title="Abrir chamado" description="A equipe não acessa seus dados sem autorização explícita." />
          <CardBody>
            <ActionForm action={openSupportCaseAction} submitLabel="Enviar chamado">
              <Field label="Assunto" htmlFor="subject"><Input id="subject" name="subject" required minLength={3} maxLength={160} /></Field>
              <Field label="Descrição" htmlFor="body"><Textarea id="body" name="body" rows={5} required maxLength={5000} /></Field>
              <label className="flex items-start gap-2 text-xs text-muted">
                <input type="checkbox" name="grantAccess" className="mt-0.5 accent-[var(--gold)]" />
                Autorizo o suporte a consultar os dados deste workspace por 72 horas para resolver o chamado (acesso auditado).
              </label>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
