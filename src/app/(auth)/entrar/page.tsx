import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInForm } from "@/components/auth/auth-forms";
import { Alert } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Entrar" };

const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED === "true";

async function Params({ searchParams }: { searchParams: PageProps<"/entrar">["searchParams"] }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const erro = typeof sp.erro === "string" ? sp.erro : undefined;
  return (
    <>
      {erro ? <div className="mb-4"><Alert tone="danger">Não foi possível concluir o login. Tente novamente.</Alert></div> : null}
      <SignInForm next={next} configured={configured} googleEnabled={googleEnabled} />
    </>
  );
}

export default function EntrarPage(props: PageProps<"/entrar">) {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Bem-vindo de volta</h1>
      <p className="mb-8 mt-1 text-sm text-muted">Acesse seu painel executivo.</p>
      <Suspense fallback={<SignInForm configured={configured} googleEnabled={googleEnabled} />}>
        <Params searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
