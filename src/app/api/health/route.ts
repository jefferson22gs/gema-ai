import { connection } from "next/server";
import { db, isDatabaseConfigured } from "@/lib/db";
import { integrationConfig } from "@/lib/env";

/** Saúde pública mínima: sem segredos nem dados de clientes. */
export async function GET() {
  await connection();
  let database: "ok" | "error" | "not_configured" = "not_configured";
  if (isDatabaseConfigured()) {
    try {
      await db.asService((q) => q.query("select 1"));
      database = "ok";
    } catch {
      database = "error";
    }
  }
  const integrations = Object.fromEntries(integrationConfig().map((i) => [i.key, i.configured ? "configured" : "not_configured"]));
  return Response.json(
    { status: database === "error" ? "degraded" : "ok", time: new Date().toISOString(), database, integrations },
    { status: database === "error" ? 503 : 200, headers: { "cache-control": "no-store" } },
  );
}
