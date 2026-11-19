import { connection, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { completeGoogleOAuth } from "@/server/integrations/google/oauth";
import { googleConfig } from "@/server/runtime";
import { getSession } from "@/server/session";

export async function GET(req: Request) {
  await connection();
  const base = env.appUrl();
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/entrar", base));
  const cfg = googleConfig();
  if (!cfg) return NextResponse.redirect(new URL("/app/integracoes?google=nao_configurado", base));
  const p = new URL(req.url).searchParams;
  const result = await completeGoogleOAuth(db, cfg, session.userId, { state: p.get("state"), code: p.get("code"), error: p.get("error") });
  const target = new URL("/app/integracoes", base);
  if (result.ok) target.searchParams.set("google", "conectado");
  else target.searchParams.set("erro", result.error);
  return NextResponse.redirect(target);
}
