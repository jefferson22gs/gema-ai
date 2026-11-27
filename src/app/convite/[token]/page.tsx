import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { Alert, Button, Skeleton, buttonVariants } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { DomainError } from "@/server/context";
import { acceptInvitation } from "@/server/services/members";
import { getSession, WORKSPACE_COOKIE } from "@/server/session";

export const metadata: Metadata = { title: "Convite", robots: { index: false } };

async function accept(form: FormData) {
  "use server";
  const s = await getSession();
  const token = String(form.get("token") ?? "");
  if (!s) redirect(`/entrar?next=${encodeURIComponent(`/convite/${token}`)}`);
  let wsId: string;
  try {
    wsId = await db.asUser(s.userId, (q) => acceptInvitation(q, token));
  } catch (e) {
    redirect(`/convite/${encodeURIComponent(token)}?erro=${encodeURIComponent(e instanceof DomainError ? e.message : "Não foi possível aceitar o convite.")}`);
  }
  (await cookies()).set(WORKSPACE_COOKIE, wsId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/app");
}

async function Invite({ params, searchParams }: { params: PageProps<"/convite/[token]">["params"]; searchParams: PageProps<"/convite/[token]">["searchParams"] }) {
  const { token } = await params;
  const sp = await searchParams;
  const s = await getSession();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Convite para um workspace</h1>
      <p className="text-sm text-muted">Ao aceitar, você passa a ver apenas o que for compartilhado neste workspace, conforme o papel definido. Seu workspace pessoal continua privado.</p>
      {typeof sp.erro === "string" ? <Alert tone="danger">{sp.erro}</Alert> : null}
      {s ? (
        <form action={accept}>
          <input type="hidden" name="token" value={token} />
          <p className="mb-3 text-xs text-subtle">Entrando como {s.email}</p>
          <Button type="submit">Aceitar convite</Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Link href={`/entrar?next=${encodeURIComponent(`/convite/${token}`)}`} className={buttonVariants()}>Entrar para aceitar</Link>
          <Link href="/cadastro" className={buttonVariants({ variant: "secondary" })}>Criar conta com o e-mail convidado</Link>
        </div>
      )}
    </div>
  );
}

export default function ConvitePage(props: PageProps<"/convite/[token]">) {
  return (
    <main id="conteudo" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-4">
      <Logo />
      <Suspense fallback={<Skeleton className="h-40" />}>
        <Invite params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
