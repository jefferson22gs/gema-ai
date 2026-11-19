"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function Tabs({ label, tabs }: { label: string; tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn("shrink-0 border-b-2 px-3 pb-2.5 text-sm", active ? "border-gold text-fg" : "border-transparent text-muted hover:text-fg")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
