import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/primitives";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Planos" };

// Espelha supabase/migrations/*_storage_and_reference_data.sql (fonte da verdade no banco).
const plans = [
  { id: "essential", name: "Essential", price: 2990, text: "Agenda, finanças, tarefas e relatórios básicos.", items: ["300 mensagens de IA/mês", "200 MB de documentos", "3 automações"] },
  { id: "premium", name: "Premium", price: 5990, featured: true, text: "Briefing diário, áudio, memória consentida, documentos, automações e integrações.", items: ["1.500 mensagens de IA/mês", "2 GB de documentos", "20 automações", "WhatsApp e Google"] },
  { id: "executive", name: "Executive", price: 11990, text: "Multiagenda, relatórios executivos, projetos e integrações de negócios.", items: ["5.000 mensagens de IA/mês", "10 GB de documentos", "100 automações", "Até 10 membros"] },
  { id: "family", name: "Family / Teams", price: 8990, text: "Membros, convites, compartilhamento seletivo e funções por workspace.", items: ["4.000 mensagens de IA/mês", "8 GB de documentos", "Até 6 membros"] },
];

const faq = [
  ["Preciso de cartão para testar?", "Não. O teste de 14 dias não exige cartão. A cobrança só é ativada quando o provedor de pagamento estiver configurado."],
  ["O WhatsApp está incluso?", "Nos planos Premium em diante, mediante canal configurado pelo operador e verificação do seu número."],
  ["Posso exportar ou excluir meus dados?", "Sim, a qualquer momento em Configurações, conforme a LGPD."],
  ["A GEMA é consultora financeira?", "Não. É uma ferramenta de organização; não substitui profissionais regulamentados."],
];

export default function Planos() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Planos</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Escolha o nível de assessoria</h1>
      <p className="mt-3 max-w-2xl text-muted">Valores mensais em reais, sujeitos a confirmação comercial antes do lançamento.</p>
      <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => (
          <section key={p.id} className={cn("flex flex-col rounded-2xl border bg-surface p-6", p.featured ? "border-gold/60 shadow-card" : "border-border")}>
            <h2 className="font-semibold">{p.name}</h2>
            <p className="mt-1 min-h-12 text-sm text-muted">{p.text}</p>
            <p className="mt-5 text-3xl font-semibold tracking-tight">
              {formatCents(p.price)}<span className="text-sm font-normal text-muted">/mês</span>
            </p>
            <ul className="mt-5 flex-1 space-y-2 text-sm text-muted">
              {p.items.map((i) => (
                <li key={i} className="flex gap-2"><Check className="mt-0.5 size-4 text-success" aria-hidden />{i}</li>
              ))}
            </ul>
            <Link href={`/cadastro?plano=${p.id}`} className={buttonVariants({ variant: p.featured ? "primary" : "secondary", className: "mt-6" })}>
              Testar {p.name}
            </Link>
          </section>
        ))}
      </div>
      <section className="mt-20 max-w-3xl" aria-labelledby="faq">
        <h2 id="faq" className="text-2xl font-semibold tracking-tight">Perguntas frequentes</h2>
        <div className="mt-6 divide-y divide-border rounded-xl border border-border bg-surface">
          {faq.map(([q, a]) => (
            <details key={q} className="group px-5 py-4">
              <summary className="cursor-pointer list-none font-medium marker:hidden">{q}</summary>
              <p className="mt-2 text-sm text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
