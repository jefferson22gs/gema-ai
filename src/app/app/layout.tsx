import Link from "next/link";
import { Suspense } from "react";
import { Bell, LogOut, Shield } from "lucide-react";
import { Logo } from "@/components/brand";
import { MobileTabBar, SidebarNav } from "@/components/app/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { signOut } from "@/app/(auth)/actions";
import { requireSession } from "@/server/session";
import { switchWorkspace } from "./actions";
import { SetupRequired } from "./setup-required";

// Variáveis NEXT_PUBLIC_* são incorporadas no build: este estado reflete a configuração do deploy.
const authConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const KIND_LABEL = { personal: "Pessoal", family: "Família", business: "Empresa" } as const;

async function WorkspaceBar() {
  const s = await requireSession();
  const unread = await db.asUser(s.userId, (q) =>
    q.query<{ n: number }>("select count(*)::bigint as n from notification_outbox where user_id = $1 and read_at is null", [s.userId]),
  );
  return (
    <div className="flex items-center gap-2">
      <form action={switchWorkspace} className="flex items-center gap-2">
        <label htmlFor="ws" className="sr-only">Workspace</label>
        <select id="ws" name="workspaceId" defaultValue={s.workspace.id} className="h-9 max-w-[180px] rounded-lg border border-border bg-surface px-2 text-sm text-fg">
          {s.workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.name} · {KIND_LABEL[w.kind]}</option>
          ))}
        </select>
        <button type="submit" className="h-9 rounded-lg border border-border px-2 text-xs text-muted hover:text-fg">Trocar</button>
      </form>
      <Link href="/app/notificacoes" className="relative grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Notificações (${unread[0]?.n ?? 0} não lidas)`}>
        <Bell className="size-4" />
        {unread[0]?.n ? <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-gold" /> : null}
      </Link>
      {s.isPlatformAdmin ? (
        <Link href="/super-admin" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="Super Admin">
          <Shield className="size-4" />
        </Link>
      ) : null}
      <ThemeToggle />
      <form action={signOut}>
        <button type="submit" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="Sair">
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/app">) {
  if (!authConfigured) return <SetupRequired />;
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-bg-elevated px-3 py-5 lg:flex">
        <div className="mb-6 px-2"><Logo href="/app" /></div>
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur sm:px-6">
          <div className="lg:hidden"><Logo href="/app" compact /></div>
          <div className="hidden text-sm text-subtle lg:block">Assessor Executivo</div>
          <Suspense fallback={<Skeleton className="h-9 w-64" />}>
            <WorkspaceBar />
          </Suspense>
        </header>
        <main id="conteudo" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 sm:px-6 lg:pb-10">{children}</main>
      </div>
      <MobileTabBar />
    </div>
  );
}
