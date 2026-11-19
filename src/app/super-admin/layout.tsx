import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand";
import { Tabs } from "@/components/app/tabs";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { requirePlatformAdmin } from "@/server/session";

const tabs = [
  ["", "Visão geral"], ["/clientes", "Clientes"], ["/planos", "Planos"], ["/integracoes", "Integrações"], ["/canais", "Canais"], ["/emails", "E-mails"],
  ["/automacoes", "Automações"], ["/monitoramento", "Monitoramento"], ["/auditoria", "Auditoria"], ["/financeiro", "Financeiro"], ["/configuracoes", "Configurações"],
].map(([p, label]) => ({ href: `/super-admin${p}`, label }));

async function Guard({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  return <>{children}</>;
}

export default function SuperAdminLayout({ children }: LayoutProps<"/super-admin">) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-bg-elevated">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3"><Logo href="/super-admin" /><Badge tone="danger">Super Admin</Badge></div>
          <Link href="/app" className="text-sm text-muted hover:text-fg">Voltar ao painel</Link>
        </div>
      </header>
      <main id="conteudo" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Tabs label="Administração" tabs={tabs} />
        <p className="mb-6 text-xs text-subtle">Somente metadados agregados. Conteúdo de clientes (mensagens, finanças, contatos, documentos) não é exibido. Todo acesso é auditado.</p>
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Guard>{children}</Guard>
        </Suspense>
      </main>
    </div>
  );
}
