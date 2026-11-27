"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { rateLimit } from "@/server/http";

export interface AuthFormState {
  error?: string;
  message?: string;
}

async function ipKey() {
  const h = await headers();
  return h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function safeNext(next: FormDataEntryValue | null): string {
  const v = typeof next === "string" ? next : "";
  // Somente caminhos internos conhecidos (evita open redirect).
  return /^\/(app|super-admin|convite)(\/|$)/.test(v) && !v.startsWith("//") ? v : "/app";
}

const signInSchema = z.object({ email: z.email(), password: z.string().min(8).max(128) });

export async function signIn(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Autenticação não configurada nesta instalação (Supabase: Não configurado)." };
  const parsed = signInSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Informe e-mail e senha válidos (mínimo 8 caracteres)." };
  // Proteção contra força bruta: por IP e por conta.
  const okIp = await rateLimit(`login:ip:${await ipKey()}`, 20, 600);
  const okAcct = await rateLimit(`login:acct:${parsed.data.email.toLowerCase()}`, 8, 600);
  if (!okIp || !okAcct) return { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "E-mail ou senha incorretos, ou e-mail ainda não confirmado." };
  redirect(safeNext(form.get("next")));
}

const signUpSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email(),
  password: z.string().min(10, "A senha deve ter ao menos 10 caracteres.").max(128),
  terms: z.literal("on", { error: "É necessário aceitar os termos e a política de privacidade." }),
});

export async function signUp(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Cadastro indisponível: Supabase não configurado nesta instalação." };
  const parsed = signUpSchema.safeParse({ name: form.get("name"), email: form.get("email"), password: form.get("password"), terms: form.get("terms") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  if (!(await rateLimit(`signup:ip:${await ipKey()}`, 5, 3600))) return { error: "Muitos cadastros a partir desta rede. Tente mais tarde." };
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.name }, emailRedirectTo: `${env.appUrl()}/auth/callback?next=/app/onboarding` },
  });
  if (error) return { error: error.message.includes("registered") ? "Este e-mail já possui conta." : "Não foi possível criar a conta agora." };
  if (data.user) {
    // Registro de consentimento (termos + privacidade) com versão.
    await db.asService((q) =>
      q.query(
        "insert into consent_records (user_id, consent_type, granted, version, source) values ($1, 'terms', true, '2026-11', 'signup'), ($1, 'privacy', true, '2026-11', 'signup')",
        [data.user!.id],
      ),
    ).catch(() => undefined);
  }
  if (data.session) redirect("/app/onboarding");
  return { message: "Conta criada. Enviamos um link de confirmação para o seu e-mail." };
}

export async function signInWithGoogle(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/entrar?erro=nao_configurado");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${env.appUrl()}/auth/callback?next=/app`, scopes: "openid email profile" },
  });
  if (error || !data.url) redirect("/entrar?erro=google");
  redirect(data.url);
}

export async function requestPasswordReset(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Supabase não configurado." };
  const email = z.email().safeParse(form.get("email"));
  if (!email.success) return { error: "E-mail inválido." };
  if (!(await rateLimit(`reset:ip:${await ipKey()}`, 5, 3600))) return { error: "Muitas solicitações. Tente mais tarde." };
  await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${env.appUrl()}/auth/callback?next=/redefinir-senha` });
  // Resposta idêntica exista ou não a conta (evita enumeração).
  return { message: "Se houver uma conta com este e-mail, você receberá um link de redefinição." };
}

export async function updatePassword(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Supabase não configurado." };
  const pw = z.string().min(10).max(128).safeParse(form.get("password"));
  if (!pw.success) return { error: "A senha deve ter ao menos 10 caracteres." };
  const { error } = await supabase.auth.updateUser({ password: pw.data });
  if (error) return { error: "Link expirado. Solicite uma nova redefinição." };
  redirect("/app");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase?.auth.signOut();
  redirect("/entrar");
}
