import Link from "next/link";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/primitives";

const nav = [
  { href: "/recursos", label: "Recursos" },
  { href: "/como-funciona", label: "Como funciona" },
  { href: "/demo", label: "Demonstração" },
  { href: "/planos", label: "Planos" },
  { href: "/seguranca", label: "Segurança" },
];

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-fg">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/entrar" className={buttonVariants({ variant: "ghost", size: "sm" })}>Entrar</Link>
            <Link href="/cadastro" className={buttonVariants({ size: "sm" })}>Criar conta</Link>
          </div>
        </div>
        <nav aria-label="Principal (mobile)" className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main id="conteudo" className="flex-1">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-4 sm:px-6">
          <div className="sm:col-span-2">
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-muted">
              Assessor executivo de IA para agenda, finanças, tarefas e contatos. Não é consultoria financeira regulamentada.
            </p>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-subtle">Produto</p>
            <ul className="space-y-2 text-sm text-muted">
              {nav.map((n) => (
                <li key={n.href}><Link href={n.href} className="hover:text-fg">{n.label}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-subtle">Legal</p>
            <ul className="space-y-2 text-sm text-muted">
              <li><Link href="/privacidade" className="hover:text-fg">Privacidade</Link></li>
              <li><Link href="/termos" className="hover:text-fg">Termos de uso</Link></li>
              <li><Link href="/contato" className="hover:text-fg">Contato e encarregado (DPO)</Link></li>
            </ul>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-8 text-xs text-subtle sm:px-6">GEMA AI é nome de trabalho, sujeito a confirmação de marca.</div>
      </footer>
    </div>
  );
}
