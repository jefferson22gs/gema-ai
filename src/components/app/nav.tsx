"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell, Calendar, CheckSquare, CreditCard, FileText, Folder, HelpCircle, Home, Plug, Settings, Sparkles, Sunrise, Users, Wallet, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAV, APP_NAV_SECONDARY, MOBILE_NAV } from "./nav-items";

const ICONS = {
  home: Home, sparkles: Sparkles, calendar: Calendar, wallet: Wallet, check: CheckSquare, folder: Folder, users: Users, file: FileText,
  sunrise: Sunrise, zap: Zap, plug: Plug, bell: Bell, settings: Settings, credit: CreditCard, help: HelpCircle,
};

function isActive(path: string, href: string) {
  return href === "/app" ? path === "/app" : path === href || path.startsWith(`${href}/`);
}

export function SidebarNav() {
  const path = usePathname();
  const render = (items: readonly { href: string; label: string; icon: keyof typeof ICONS }[]) =>
    items.map((item) => {
      const Icon = ICONS[item.icon];
      const active = isActive(path, item.href);
      return (
        <Link
          key={item.href}
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
            active ? "bg-gold-soft font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          <Icon className={cn("size-4", active ? "text-gold" : "")} aria-hidden />
          {item.label}
        </Link>
      );
    });
  return (
    <nav aria-label="Painel" className="flex flex-1 flex-col gap-0.5">
      {render(APP_NAV)}
      <div className="hairline my-3" />
      {render(APP_NAV_SECONDARY)}
    </nav>
  );
}

export function MobileTabBar() {
  const path = usePathname();
  return (
    <nav aria-label="Navegação rápida" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="grid grid-cols-5">
        {MOBILE_NAV.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(path, item.href);
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-1 py-2.5 text-[11px]", active ? "text-gold" : "text-muted")}>
                <Icon className="size-5" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
