import "server-only";
import { db } from "@/lib/db";
import type { JobHandler } from "./queue";
import { refreshRecurringCandidates } from "../services/planning";
import { DEFAULT_TIMEZONE } from "@/lib/time";

/**
 * Registro central de handlers da fila. Cada handler recebe payload validado e roda com o
 * contexto do titular (RLS), nunca com acesso amplo, salvo jobs de sistema explícitos.
 */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  /** Reanálise de recorrências de um titular (disparada após importações). */
  "finance.recurring.refresh": async (payload) => {
    const userId = String(payload.userId ?? "");
    const workspaceId = String(payload.workspaceId ?? "");
    if (!userId || !workspaceId) throw new Error("payload inválido");
    await db.asUser(userId, (q) =>
      refreshRecurringCandidates({ q, ctx: { userId, workspaceId, timezone: String(payload.timezone ?? DEFAULT_TIMEZONE), now: new Date(), channel: "automation" } }),
    );
  },
};
