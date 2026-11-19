import { Tabs } from "@/components/app/tabs";

const tabs = [
  { href: "/app/financas", label: "Visão geral" },
  { href: "/app/financas/transacoes", label: "Lançamentos" },
  { href: "/app/financas/orcamentos", label: "Orçamentos" },
];

export default function FinancasLayout({ children }: LayoutProps<"/app/financas">) {
  return (
    <div>
      <Tabs label="Finanças" tabs={tabs} />
      {children}
    </div>
  );
}
