import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Briefcase, CalendarClock, CheckCircle2, FileText, Landmark, MessageSquareText, ShieldCheck, Sparkles, Users, Wallet } from "lucide-react";
import { Badge, buttonVariants } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "GEMA AI — Assessor Executivo Inteligente 24h",
  alternates: { canonical: "/" },
};

const useCases = [
  { icon: Wallet, title: "Finanças pessoais", text: "Gastos por mensagem, orçamento, cartões com faturas e parcelas, metas, dívidas e fluxo de caixa projetado." },
  { icon: Landmark, title: "Open Finance", text: "Conecte bancos pelo fluxo oficial, só para leitura. O GEMA nunca pede sua senha bancária nem movimenta dinheiro." },
  { icon: CalendarClock, title: "Agenda executiva", text: "Compromissos com detecção de conflitos, fuso horário correto e integração com Google Agenda." },
  { icon: CheckCircle2, title: "Tarefas e projetos", text: "Prioridades, prazos e lembretes recorrentes que respeitam seu horário local." },
  { icon: Users, title: "Família", text: "Workspace familiar com papéis e convites. O que é pessoal continua pessoal." },
  { icon: Briefcase, title: "Empresa", text: "Workspace empresarial com permissões por módulo para equipe, financeiro e contador." },
  { icon: FileText, title: "Documentos", text: "Comprovantes em armazenamento privado, com extração revisada por você antes de lançar." },
  { icon: MessageSquareText, title: "Painel e WhatsApp", text: "Converse pelo painel ou pelo WhatsApp, depois de vincular seu número com um código de uso único." },
];

const agents = [
  ["Financeiro", "lançamentos, cartões, simulações"],
  ["Agenda", "compromissos e conflitos"],
  ["Tarefas", "prioridades e prazos"],
  ["Planejamento", "metas, dívidas, fluxo de caixa"],
  ["Documentos", "comprovantes e extração"],
  ["Automações", "rotinas e alertas"],
] as const;

export default function Home() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-96 max-w-3xl rounded-full bg-gold/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pt-24">
          <div className="rise">
            <Badge tone="gold">Assessor executivo de IA · PT-BR</Badge>
            <h1 className="text-balance mt-5 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
              Sua rotina organizada com a discrição de um <span className="text-gold">assessor executivo</span>.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Diga o que precisa — “gastei 85 no almoço”, “marca reunião amanhã às 10” — e a GEMA registra, confere conflitos e pede confirmação
              antes de qualquer ação sensível.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/cadastro" className={buttonVariants({ size: "lg" })}>
                Começar teste grátis <ArrowRight />
              </Link>
              <Link href="/demo" className={buttonVariants({ variant: "secondary", size: "lg" })}>Ver demonstração</Link>
            </div>
            <p className="mt-4 text-xs text-subtle">Sem cartão no teste. Cobrança só será ativada após configuração do provedor de pagamento.</p>
          </div>

          <figure aria-label="Demonstração ilustrativa de conversa" className="rise rounded-2xl border border-border bg-surface p-5 shadow-card [animation-delay:120ms]">
            <figcaption className="mb-4 flex items-center justify-between text-xs text-subtle">
              <span>Demonstração ilustrativa</span>
              <Badge>exemplo</Badge>
            </figcaption>
            <div className="space-y-3 text-sm">
              <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-gold-soft px-4 py-2.5 text-fg">Gema, gastei 85 no almoço e 40 no combustível</p>
              <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-border bg-bg-elevated px-4 py-3">
                <p className="text-fg">✓ 2 despesas registradas, total R$ 125,00</p>
                <p className="mt-1 text-xs text-muted">Almoço R$ 85,00 (Alimentação) · Combustível R$ 40,00 (Combustível)</p>
              </div>
              <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-gold-soft px-4 py-2.5 text-fg">Marca reunião com o fornecedor amanhã às 10</p>
              <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-border bg-bg-elevated px-4 py-3">
                <p className="text-fg">⏸ Conflito com “Dentista” às 10:30. Confirma criar mesmo assim?</p>
                <div className="mt-2 flex gap-2 text-xs">
                  <span className="rounded-md bg-gold px-2 py-1 font-medium text-on-gold">Confirmar</span>
                  <span className="rounded-md border border-border px-2 py-1 text-muted">Cancelar</span>
                </div>
              </div>
            </div>
          </figure>
        </div>
      </section>

      <section className="border-y border-border bg-bg-elevated" aria-labelledby="casos">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 id="casos" className="text-2xl font-semibold tracking-tight sm:text-3xl">Um assessor para cada parte da rotina</h2>
          <p className="mt-2 max-w-2xl text-muted">Para pessoas, famílias e profissionais — com ferramentas e permissões por workspace.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {useCases.map(({ icon: Icon, title, text }) => (
              <article key={title} className="rounded-xl border border-border bg-surface p-5">
                <Icon className="size-5 text-gold" aria-hidden />
                <h3 className="mt-4 font-medium">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-20 sm:px-6" aria-labelledby="agentes">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <Sparkles className="size-6 text-gold" aria-hidden />
            <h2 id="agentes" className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">Agentes especializados, uma conversa só</h2>
            <p className="mt-3 text-muted">
              Você fala com a GEMA; ela encaminha o pedido ao agente certo, que só tem acesso às ferramentas da própria área. Contas oficiais
              (saldos, parcelas, projeções) são feitas por um motor financeiro determinístico, não pela IA.
            </p>
            <Link href="/demo" className={buttonVariants({ variant: "link", className: "mt-4" })}>Experimentar na demonstração <ArrowRight /></Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {agents.map(([name, scope]) => (
              <li key={name} className="rounded-lg border border-border bg-surface px-4 py-3">
                <p className="text-sm font-medium">Agente {name}</p>
                <p className="text-xs text-muted">{scope}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6" aria-labelledby="principios">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <ShieldCheck className="size-6 text-gold" aria-hidden />
            <h2 id="principios" className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">Ações com confirmação. Dados com isolamento.</h2>
            <p className="mt-3 text-muted">
              A IA interpreta o pedido; quem executa é o sistema, com validação, permissões por workspace e trilha de auditoria. Nada de transferências,
              mensagens a terceiros ou exclusões críticas sem o seu “sim”.
            </p>
            <Link href="/seguranca" className={buttonVariants({ variant: "link", className: "mt-4" })}>Ver práticas de segurança <ArrowRight /></Link>
          </div>
          <ul className="space-y-3 text-sm">
            {[
              "Isolamento por workspace com Row Level Security no banco",
              "Tokens de integrações criptografados e revogáveis",
              "Mensagens de WhatsApp aceitas só de números verificados; saldos ocultos no canal por padrão",
              "Open Finance somente leitura, com consentimento revogável a qualquer momento",
              "Transferências e pagamentos nunca executados pela IA",
              "Exportação e exclusão de dados conforme a LGPD",
              "Limites de uso e custo para evitar surpresas",
            ].map((t) => (
              <li key={t} className="flex gap-3 rounded-lg border border-border bg-surface px-4 py-3">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                <span className="text-muted">{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <div className="rounded-2xl border border-gold/30 bg-gradient-to-br from-gold-soft to-transparent px-6 py-12 text-center sm:px-12">
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">Comece pelo essencial. Evolua no seu ritmo.</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">Crie sua conta, escolha o workspace e conecte apenas as integrações que fizerem sentido.</p>
          <Link href="/cadastro" className={buttonVariants({ size: "lg", className: "mt-7" })}>Criar conta</Link>
        </div>
      </section>
    </>
  );
}
