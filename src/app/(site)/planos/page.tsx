import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Check } from "lucide-react";
import { Alert, Skeleton, buttonVariants } from "@/components/ui/primitives";
import { db, isDatabaseConfigured } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { listFeatures, listPublicPlans, type PlanRow } from "@/server/billing/plans";

export const metadata: Metadata = { title: "Planos" };

const faq = [
  ["Preciso de cartão para testar?", "Não. O período de teste não exige cartão. A cobrança só é ativada quando o provedor de pagamento estiver configurado."],
  ["O que acontece quando o teste termina?", "Seus dados continuam seus: finanças manuais, agenda, tarefas e documentos seguem acessíveis. Recursos do plano (WhatsApp, Open Finance, automações) ficam pausados até a assinatura."],
  ["O WhatsApp está incluso?", "Nos planos que listam o WhatsApp, mediante canal configurado pelo operador e verificação do seu número."],
  ["Posso exportar ou excluir meus dados?", "Sim, a qualquer momento em Configurações, conforme a LGPD."],
  ["A GEMA é consultora financeira?", "Não. É uma ferramenta de organização; não substitui profissionais regulamentados."],
];

function highlights(p: PlanRow, labels: Map<string, string>): string[] {
  const n = (v: number | undefined) => (v ?? 0).toLocaleString("pt-BR");
  const out = [`${n(p.limits.ai_messages_month)} mensagens de IA/mês`];
  const mb = p.limits.storage_mb ?? 0;
  out.push(mb >= 1024 ? `${Math.round(mb / 1024)} GB de documentos` : `${mb} MB de documentos`);
  if (p.limits.automations) out.push(`${n(p.limits.automations)} automações`);
  if ((p.limits.members ?? 1) > 1) out.push(`Até ${n(p.limits.members)} membros`);
  if (p.limits.bank_connections) out.push(`${n(p.limits.bank_connections)} conexões bancárias (Open Finance)`);
  for (const key of ["whatsapp", "advanced_agents", "integrations", "family", "business", "billing_charges", "fiscal"]) {
    if (p.features.includes(key) && labels.has(key)) out.push(labels.get(key)!);
  }
  return out;
}

async function PlanCards() {
  await connection(); // preço e limites vêm do banco a cada requisição (editáveis no Super Admin)
  if (!isDatabaseConfigured()) {
    return <Alert tone="warning" title="Planos indisponíveis">O catálogo de planos ainda não foi configurado neste ambiente.</Alert>;
  }
  const { plans, features } = await db.asService(async (q) => ({ plans: await listPublicPlans(q), features: await listFeatures(q) }));
  const labels = new Map(features.map((f) => [f.key, f.label]));
  if (!plans.length) return <Alert tone="warning" title="Nenhum plano disponível">Volte em breve.</Alert>;
  return (
    <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {plans.map((p) => (
        <section key={p.id} className={cn("flex flex-col rounded-2xl border bg-surface p-6", p.highlight ? "border-gold/60 shadow-card" : "border-border")}>
          <h2 className="font-semibold">{p.name}</h2>
          <p className="mt-1 min-h-12 text-sm text-muted">{p.description}</p>
          <p className="mt-5 text-3xl font-semibold tracking-tight">
            {formatCents(p.price_cents)}<span className="text-sm font-normal text-muted">/mês</span>
          </p>
          {p.price_yearly_cents !== null ? <p className="mt-1 text-xs text-subtle">ou {formatCents(p.price_yearly_cents)}/ano</p> : null}
          <ul className="mt-5 flex-1 space-y-2 text-sm text-muted">
            {highlights(p, labels).map((i) => (
              <li key={i} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{i}</li>
            ))}
          </ul>
          <Link href={`/cadastro?plano=${p.id}`} className={buttonVariants({ variant: p.highlight ? "primary" : "secondary", className: "mt-6" })}>
            {p.trial_days > 0 ? `Testar ${p.trial_days} dias` : `Assinar ${p.name}`}
          </Link>
        </section>
      ))}
    </div>
  );
}

export default function Planos() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Planos</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Escolha o nível de assessoria</h1>
      <p className="mt-3 max-w-2xl text-muted">Valores mensais em reais, sujeitos a confirmação comercial antes do lançamento.</p>
      <Suspense fallback={<Skeleton className="mt-10 h-96" />}><PlanCards /></Suspense>
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
