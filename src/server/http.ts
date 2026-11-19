import "server-only";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DomainError } from "./context";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export function errorResponse(e: unknown) {
  if (e instanceof DomainError) {
    const status = { not_found: 404, invalid: 422, conflict: 409, forbidden: 403, limit: 429, not_configured: 503 }[e.code];
    return json({ error: e.message, code: e.code, details: e.details }, status);
  }
  console.error("[api] erro inesperado", e instanceof Error ? e.message : e);
  return json({ error: "Erro interno." }, 500);
}

/** IP real atrás do Cloudflare/Vercel. */
export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** Rate limit por janela fixa no Postgres (compartilhado entre instâncias serverless). */
export async function rateLimit(bucket: string, max: number, windowSeconds = 60): Promise<boolean> {
  try {
    const [row] = await db.asService((q) => q.query<{ ok: boolean }>("select public.rate_limit_hit($1, $2, $3) as ok", [bucket, windowSeconds, max]));
    return row.ok;
  } catch {
    return true; // falha do limitador não derruba a requisição
  }
}

/** Anti-CSRF para mutações via fetch: exige Origin do próprio app. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function readRawBody(req: Request, maxBytes = 1_000_000): Promise<string | null> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) return null;
  const text = await req.text();
  return Buffer.byteLength(text) > maxBytes ? null : text;
}
