import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowRight, FlaskConical } from "lucide-react";
import { DemoApp } from "@/components/demo/demo-app";
import { Alert, Skeleton, buttonVariants } from "@/components/ui/primitives";
import { DEMO_PERSONA, buildDemoScenario } from "@/lib/demo/scenario";
import { localDateString } from "@/lib/time";

export const metadata: Metadata = {
  title: "Demonstração",
  description: "Explore o GEMA AI com dados fictícios: finanças, cartões, metas, agenda e assistente — sem criar conta.",
  alternates: { canonical: "/demo" },
};

async function Scenario() {
  await connection(); // datas relativas a hoje; nada é lido do banco nem enviado à rede
  const today = localDateString(new Date(), "America/Sao_Paulo");
  return <DemoApp scenario={buildDemoScenario(today)} />;
}

export default function Demo() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold"><FlaskConical className="size-4" aria-hidden />Demonstração</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Veja o GEMA AI funcionando</h1>
      <p className="mt-3 max-w-2xl text-muted">Navegue pelos módulos com o cenário de {DEMO_PERSONA}. Os cálculos usam o mesmo motor do produto.</p>
      <div className="mt-6">
        <Alert tone="warning" title="Dados fictícios">
          Pessoa, valores, compromissos e conversa são inventados para demonstração. Nada é gravado, nenhuma mensagem é enviada e nenhuma
          IA ou banco real é consultado nesta página.
        </Alert>
      </div>
      <div className="mt-8"><Suspense fallback={<Skeleton className="h-[28rem]" />}><Scenario /></Suspense></div>
      <div className="mt-12 flex flex-wrap items-center gap-3">
        <Link href="/cadastro" className={buttonVariants({ size: "lg" })}>Criar minha conta <ArrowRight /></Link>
        <Link href="/planos" className={buttonVariants({ variant: "secondary", size: "lg" })}>Ver planos</Link>
      </div>
    </div>
  );
}
