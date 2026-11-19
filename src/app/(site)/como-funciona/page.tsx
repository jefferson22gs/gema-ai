import type { Metadata } from "next";
import { ProsePage } from "@/components/site/prose-page";

export const metadata: Metadata = { title: "Como funciona" };

const steps = [
  ["Crie sua conta", "Cadastro com e-mail e senha ou Google. Um workspace pessoal é criado automaticamente."],
  ["Escolha como usar", "Painel web, app instalável (PWA) e, opcionalmente, WhatsApp após verificar seu número com um código."],
  ["Peça em linguagem natural", "A IA (Gemini) identifica as intenções e os dados. O sistema valida cada ação e aplica suas permissões."],
  ["Confirme o que é sensível", "Integrações externas, contatos, cancelamentos e valores altos pedem confirmação explícita."],
  ["Acompanhe com clareza", "Cada ação tem status próprio: concluída, aguardando confirmação ou falha — nunca um “ok” genérico."],
];

export default function ComoFunciona() {
  return (
    <ProsePage eyebrow="Como funciona" title="Da frase à ação, com controle em cada etapa">
      <ol className="space-y-4">
        {steps.map(([title, text], i) => (
          <li key={title} className="flex gap-4 rounded-xl border border-border bg-surface p-5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gold-soft text-sm font-semibold text-gold">{i + 1}</span>
            <div>
              <p className="font-medium text-fg">{title}</p>
              <p className="mt-1 text-sm">{text}</p>
            </div>
          </li>
        ))}
      </ol>
      <section>
        <h2>O que a GEMA não faz</h2>
        <ul>
          <li>Não realiza pagamentos ou transferências.</li>
          <li>Não envia mensagens em seu nome para terceiros sem confirmação.</li>
          <li>Não fica “ouvindo” em segundo plano: áudios são processados apenas quando você os envia.</li>
          <li>Não obedece instruções contidas em documentos ou mensagens de terceiros.</li>
        </ul>
      </section>
    </ProsePage>
  );
}
