import Link from "next/link";
import { Logo } from "@/components/brand";
import { Alert, buttonVariants } from "@/components/ui/primitives";

/** Estado explícito quando Supabase/DATABASE_URL não estão configurados: nada de dados falsos. */
export function SetupRequired() {
  return (
    <main id="conteudo" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4">
      <Logo />
      <h1 className="text-2xl font-semibold tracking-tight">Painel indisponível nesta instalação</h1>
      <Alert tone="warning" title="Supabase: Não configurado">
        Defina <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code> e <code>DATABASE_URL</code>
        {" "}e aplique as migrations em <code>supabase/migrations</code>. Consulte o README.
      </Alert>
      <Link href="/" className={buttonVariants({ variant: "secondary" })}>Voltar ao site</Link>
    </main>
  );
}
