import { Logo } from "@/components/brand";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-4 py-8 sm:px-10">
        <Logo />
        <main id="conteudo" className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</main>
      </div>
      <aside aria-hidden className="relative hidden overflow-hidden border-l border-border bg-bg-elevated lg:block">
        <div className="absolute -right-24 top-1/4 size-[520px] rounded-full bg-gold/10 blur-3xl" />
        <div className="relative flex h-full flex-col justify-end p-12">
          <p className="max-w-md text-2xl font-medium leading-snug tracking-tight text-fg">
            “Organização é o que permite que a sua atenção vá para o que importa.”
          </p>
          <p className="mt-4 text-sm text-muted">GEMA AI · Assessor Executivo Inteligente</p>
        </div>
      </aside>
    </div>
  );
}
