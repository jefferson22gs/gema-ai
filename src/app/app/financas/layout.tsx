import { Tabs } from "@/components/app/tabs";

const tabs = [
  { href: "/app/financas", label: "Visão geral" },
  { href: "/app/financas/bancos", label: "Bancos" },
  { href: "/app/financas/transacoes", label: "Lançamentos" },
  { href: "/app/financas/importar", label: "Importar" },
  { href: "/app/financas/cartoes", label: "Cartões" },
  { href: "/app/financas/fluxo", label: "Fluxo de caixa" },
  { href: "/app/financas/orcamentos", label: "Orçamentos" },
  { href: "/app/financas/planejamento", label: "Metas e dívidas" },
];

export default function FinancasLayout({ children }: LayoutProps<"/app/financas">) {
  return (
    <div>
      <Tabs label="Finanças" tabs={tabs} />
      {children}
    </div>
  );
}
