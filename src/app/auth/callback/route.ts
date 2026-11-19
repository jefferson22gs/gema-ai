import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Troca o código (confirmação de e-mail, OAuth Google, recuperação de senha) por sessão. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/app";
  const next = nextParam.startsWith("/app") || nextParam === "/redefinir-senha" ? nextParam : "/app";
  const base = env.appUrl();
  const supabase = await createSupabaseServerClient();
  if (!supabase || !code) return NextResponse.redirect(new URL("/entrar?erro=callback", base));
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/entrar?erro=callback", base));
  return NextResponse.redirect(new URL(next, base));
}
