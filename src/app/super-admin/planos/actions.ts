"use server";

import { refresh } from "next/cache";
import { db } from "@/lib/db";
import { LIMIT_KEYS, saveCoupon, savePlan } from "@/server/billing/plans";
import { DomainError } from "@/server/context";
import { requirePlatformAdmin } from "@/server/session";

export interface AdminFormState {
  error?: string;
  ok?: string;
}

/** Reais "59,90" → centavos inteiros (sem float acumulado). Vazio → null. */
function cents(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim().replace(/\./g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

const int = (v: FormDataEntryValue | null) => (String(v ?? "").trim() === "" ? null : Number(v));

export async function savePlanAction(_: AdminFormState, form: FormData): Promise<AdminFormState> {
  const s = await requirePlatformAdmin();
  const limits: Record<string, number | null> = {};
  for (const k of LIMIT_KEYS) limits[k] = int(form.get(`limit_${k}`));
  try {
    const p = await savePlan(db, s.userId, {
      id: String(form.get("id") ?? "").trim(),
      name: String(form.get("name") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      price_cents: cents(form.get("price")),
      price_yearly_cents: cents(form.get("price_yearly")),
      trial_days: int(form.get("trial_days")),
      features: form.getAll("features").map(String),
      limits,
      is_public: form.get("is_public") === "on",
      active: form.get("active") === "on",
      highlight: form.get("highlight") === "on",
      sort_order: int(form.get("sort_order")),
      workspace_kinds: form.getAll("workspace_kinds").map(String),
    });
    refresh();
    return { ok: `Plano "${p.name}" salvo.` };
  } catch (e) {
    return { error: e instanceof DomainError ? e.message : "Não foi possível salvar o plano." };
  }
}

export async function saveCouponAction(_: AdminFormState, form: FormData): Promise<AdminFormState> {
  const s = await requirePlatformAdmin();
  const kind = form.get("kind");
  const value = String(form.get("value") ?? "").trim();
  const until = String(form.get("valid_until") ?? "").trim();
  try {
    await saveCoupon(db, s.userId, {
      code: String(form.get("code") ?? "").trim().toUpperCase(),
      description: String(form.get("description") ?? "").trim() || null,
      percent_off: kind === "percent" ? int(value) : null,
      amount_off_cents: kind === "amount" ? cents(value) : null,
      duration_months: int(form.get("duration_months")),
      plan_ids: form.getAll("plan_ids").map(String),
      cycles: form.getAll("cycles").map(String),
      max_redemptions: int(form.get("max_redemptions")),
      valid_until: until ? new Date(`${until}T23:59:59-03:00`).toISOString() : null,
      active: form.get("active") === "on",
    });
    refresh();
    return { ok: "Cupom salvo." };
  } catch (e) {
    return { error: e instanceof DomainError ? e.message : "Não foi possível salvar o cupom." };
  }
}
