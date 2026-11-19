"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, signIn, signInWithGoogle, signUp, updatePassword, type AuthFormState } from "@/app/(auth)/actions";
import { Alert, Button, Field, Input } from "@/components/ui/primitives";

function Feedback({ state }: { state: AuthFormState }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

function GoogleButton({ enabled }: { enabled: boolean }) {
  return (
    <form action={signInWithGoogle}>
      <Button type="submit" variant="secondary" className="w-full" disabled={!enabled} title={enabled ? undefined : "Login Google não configurado nesta instalação"}>
        <svg viewBox="0 0 24 24" aria-hidden className="size-4"><path fill="currentColor" d="M21.35 11.1H12v2.98h5.35c-.23 1.5-1.68 4.4-5.35 4.4-3.22 0-5.85-2.67-5.85-5.96S8.78 6.56 12 6.56c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.68 4.02 14.56 3 12 3 7.03 3 3 7.03 3 12s4.03 9 9 9c5.2 0 8.64-3.65 8.64-8.8 0-.59-.06-1.04-.14-1.48z" /></svg>
        Continuar com Google
      </Button>
    </form>
  );
}

export function SignInForm({ next, googleEnabled, configured }: { next?: string; googleEnabled: boolean; configured: boolean }) {
  const [state, action, pending] = useActionState(signIn, {});
  return (
    <div className="space-y-5">
      {!configured ? <Alert tone="warning" title="Instalação sem Supabase">Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY para habilitar o login.</Alert> : null}
      <GoogleButton enabled={googleEnabled && configured} />
      <div className="flex items-center gap-3 text-xs text-subtle"><span className="hairline flex-1" />ou<span className="hairline flex-1" /></div>
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next ?? "/app"} />
        <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Senha" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} /></Field>
        <Feedback state={state} />
        <Button type="submit" className="w-full" disabled={pending || !configured}>{pending ? "Entrando…" : "Entrar"}</Button>
      </form>
      <div className="flex justify-between text-sm">
        <Link href="/recuperar-senha" className="text-muted hover:text-fg">Esqueci a senha</Link>
        <Link href="/cadastro" className="text-gold hover:underline">Criar conta</Link>
      </div>
    </div>
  );
}

export function SignUpForm({ googleEnabled, configured }: { googleEnabled: boolean; configured: boolean }) {
  const [state, action, pending] = useActionState(signUp, {});
  return (
    <div className="space-y-5">
      {!configured ? <Alert tone="warning" title="Instalação sem Supabase">Cadastro indisponível até configurar o Supabase.</Alert> : null}
      <GoogleButton enabled={googleEnabled && configured} />
      <div className="flex items-center gap-3 text-xs text-subtle"><span className="hairline flex-1" />ou<span className="hairline flex-1" /></div>
      <form action={action} className="space-y-4">
        <Field label="Nome" htmlFor="name"><Input id="name" name="name" autoComplete="name" required minLength={2} /></Field>
        <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Senha" htmlFor="password" hint="Mínimo de 10 caracteres."><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} /></Field>
        <label className="flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" name="terms" required className="mt-0.5 accent-[var(--gold)]" />
          <span>Li e aceito os <Link href="/termos" className="text-gold underline">Termos</Link> e a <Link href="/privacidade" className="text-gold underline">Política de Privacidade</Link>.</span>
        </label>
        <Feedback state={state} />
        <Button type="submit" className="w-full" disabled={pending || !configured}>{pending ? "Criando…" : "Criar conta"}</Button>
      </form>
      <p className="text-center text-sm text-muted">Já tem conta? <Link href="/entrar" className="text-gold underline underline-offset-2">Entrar</Link></p>
    </div>
  );
}

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Feedback state={state} />
      <Button type="submit" className="w-full" disabled={pending}>Enviar link</Button>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Nova senha" htmlFor="password" hint="Mínimo de 10 caracteres."><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} /></Field>
      <Feedback state={state} />
      <Button type="submit" className="w-full" disabled={pending}>Salvar nova senha</Button>
    </form>
  );
}
