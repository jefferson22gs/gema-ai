import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { db, isDatabaseConfigured } from "@/lib/db";
import { createSupabaseServerClient, isSupabaseAuthConfigured } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import type { ActorContext } from "./context";
import { getProfile, listMyWorkspaces, type ProfileRow, type WorkspaceSummary } from "./services/workspaces";

export const WORKSPACE_COOKIE = "gema_ws";

export interface Session {
  userId: string;
  email: string | null;
  profile: ProfileRow;
  workspaces: WorkspaceSummary[];
  workspace: WorkspaceSummary;
  isPlatformAdmin: boolean;
}

export function isPlatformReady(): boolean {
  return isSupabaseAuthConfigured() && isDatabaseConfigured();
}

/** Usuário autenticado validado no servidor Supabase Auth (getUser, não getSession). */
export const getAuthUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

export const getSession = cache(async (): Promise<Session | null> => {
  // Sessão é sempre dado de request: nunca pode ser pré-renderizada (nem quando falta configuração).
  await connection();
  if (!isPlatformReady()) return null;
  const user = await getAuthUser();
  if (!user) return null;
  const { profile, workspaces } = await db.asUser(user.id, async (q) => ({
    profile: await getProfile(q, user.id),
    workspaces: await listMyWorkspaces(q, user.id),
  }));
  if (!profile || !workspaces.length) return null;
  const selected = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const workspace = workspaces.find((w) => w.id === selected) ?? workspaces[0];
  const admin = await db.asService((q) => q.query("select 1 from platform_admins where user_id = $1", [user.id]));
  return { userId: user.id, email: user.email ?? null, profile, workspaces, workspace, isPlatformAdmin: admin.length > 0 };
});

export async function requireSession(): Promise<Session> {
  if (isSupabaseAuthConfigured() && !isDatabaseConfigured()) {
    // Auth configurada, mas sem DATABASE_URL: erro explícito (tratado por app/app/error.tsx), sem loop de login.
    throw new Error("DATABASE_URL não configurado.");
  }
  const s = await getSession();
  if (!s) redirect("/entrar");
  return s;
}

export async function requirePlatformAdmin(): Promise<Session> {
  const s = await requireSession();
  if (!s.isPlatformAdmin) redirect("/app");
  return s;
}

export function actorContext(s: Session, channel: ActorContext["channel"] = "dashboard"): ActorContext {
  return {
    userId: s.userId,
    workspaceId: s.workspace.id,
    timezone: s.profile.timezone || DEFAULT_TIMEZONE,
    now: new Date(),
    channel,
  };
}
