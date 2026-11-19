import { connection, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { startGoogleOAuth, type GoogleProduct } from "@/server/integrations/google/oauth";
import { rateLimit } from "@/server/http";
import { googleConfig } from "@/server/runtime";
import { getSession } from "@/server/session";

export async function GET(req: Request) {
  await connection();
  const session = await getSession();
  const base = env.appUrl();
  if (!session) return NextResponse.redirect(new URL("/entrar", base));
  const cfg = googleConfig();
  if (!cfg) return NextResponse.redirect(new URL("/app/integracoes?google=nao_configurado", base));
  const product = new URL(req.url).searchParams.get("product");
  if (product !== "calendar" && product !== "contacts") return NextResponse.redirect(new URL("/app/integracoes?google=produto_invalido", base));
  if (!(await rateLimit(`oauth:start:${session.userId}`, 10))) return NextResponse.redirect(new URL("/app/integracoes?google=limite", base));
  const url = await startGoogleOAuth(db, cfg, session.userId, session.workspace.id, product as GoogleProduct);
  return NextResponse.redirect(url);
}
