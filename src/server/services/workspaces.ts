import type { Queryable } from "@/lib/db/types";
import { DomainError } from "../context";

export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: "personal" | "family" | "business";
  role: "owner" | "admin" | "member" | "viewer";
  plan_id: string;
  timezone: string;
  subscription_status: string | null;
}

export interface ProfileRow {
  id: string;
  full_name: string | null;
  phone_e164: string | null;
  phone_verified_at: Date | null;
  timezone: string;
  currency: string;
  locale: string;
  assistant_name: string;
  assistant_style: string;
  onboarding_completed_at: Date | null;
}

export async function listMyWorkspaces(q: Queryable, userId: string): Promise<WorkspaceSummary[]> {
  return q.query<WorkspaceSummary>(
    `select w.id, w.name, w.kind, m.role, w.plan_id, w.timezone, s.status as subscription_status
     from workspaces w
     join workspace_members m on m.workspace_id = w.id and m.user_id = $1
     left join subscriptions s on s.workspace_id = w.id
     where w.deleted_at is null
     order by case w.kind when 'personal' then 0 when 'family' then 1 else 2 end, w.created_at`,
    [userId],
  );
}

export async function getProfile(q: Queryable, userId: string): Promise<ProfileRow | null> {
  const rows = await q.query<ProfileRow>(
    `select id, full_name, phone_e164, phone_verified_at, timezone, currency, locale, assistant_name, assistant_style, onboarding_completed_at
     from profiles where id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function updateProfile(
  q: Queryable,
  userId: string,
  patch: { fullName?: string; timezone?: string; assistantName?: string; assistantStyle?: string; onboardingDone?: boolean },
) {
  await q.query(
    `update profiles set
       full_name = coalesce($2, full_name),
       timezone = coalesce($3, timezone),
       assistant_name = coalesce($4, assistant_name),
       assistant_style = coalesce($5, assistant_style),
       onboarding_completed_at = case when $6 then coalesce(onboarding_completed_at, now()) else onboarding_completed_at end
     where id = $1`,
    [userId, patch.fullName ?? null, patch.timezone ?? null, patch.assistantName ?? null, patch.assistantStyle ?? null, patch.onboardingDone ?? false],
  );
}

export async function createSharedWorkspace(q: Queryable, name: string, kind: "family" | "business"): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new DomainError("invalid", "Nome obrigatório.");
  const [row] = await q.query<{ id: string }>("select public.create_workspace($1, $2) as id", [trimmed, kind]);
  return row.id;
}

export interface MemberRow {
  user_id: string;
  role: string;
  full_name: string | null;
  created_at: Date;
}

export async function listMembers(q: Queryable, workspaceId: string): Promise<MemberRow[]> {
  return q.query<MemberRow>(
    `select m.user_id, m.role, p.full_name, m.created_at
     from workspace_members m left join profiles p on p.id = m.user_id
     where m.workspace_id = $1 order by m.created_at`,
    [workspaceId],
  );
}

export interface PlanRow {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  limits: Record<string, number>;
  features: string[];
}

export async function listPlans(q: Queryable): Promise<PlanRow[]> {
  return q.query<PlanRow>("select id, name, description, price_cents, limits, features from plans where is_public and active order by sort_order");
}
