import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { APP_NAV, APP_NAV_SECONDARY } from "@/components/app/nav-items";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Mais" };

/** Menu completo para a navegação mobile (atalho "Mais" da barra inferior). */
export default function MaisPage() {
  const items = [...APP_NAV.filter((i) => !["/app", "/app/financas", "/app/assistente", "/app/agenda"].includes(i.href)), ...APP_NAV_SECONDARY];
  return (
    <>
      <PageHeader title="Mais" />
      <nav aria-label="Todos os módulos">
        <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {items.map((i) => (
            <li key={i.href}>
              <Link href={i.href} className="flex items-center justify-between px-4 py-3.5 text-sm hover:bg-surface-2">
                {i.label}
                <ChevronRight className="size-4 text-subtle" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
