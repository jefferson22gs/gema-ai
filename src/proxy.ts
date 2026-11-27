import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Renova a sessão Supabase (cookies) e faz checagem OTIMISTA de acesso às áreas autenticadas.
 * A autorização real acontece no servidor (getSession + RLS); o proxy não é barreira de segurança.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (!data.user && (path.startsWith("/app") || path.startsWith("/super-admin"))) {
    const login = request.nextUrl.clone();
    login.pathname = "/entrar";
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ["/app/:path*", "/super-admin/:path*", "/entrar", "/cadastro", "/auth/:path*", "/convite/:path*"],
};
