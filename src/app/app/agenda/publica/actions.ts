"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { DomainError } from "@/server/context";
import { saveBookingPage } from "@/server/services/booking";
import { actorContext, requireSession } from "@/server/session";

export interface PageFormState {
  ok?: string;
  error?: string;
}

const DAYS = ["0", "1", "2", "3", "4", "5", "6"] as const;

export async function saveBookingPageAction(_: PageFormState, form: FormData): Promise<PageFormState> {
  const s = await requireSession();
  const id = z.string().uuid().optional().safeParse(form.get("id") || undefined);
  const weekly: Record<string, [string, string][]> = {};
  for (const d of DAYS) {
    if (form.get(`day_${d}`) !== "on") continue;
    const ranges: [string, string][] = [[String(form.get(`from_${d}`) ?? ""), String(form.get(`to_${d}`) ?? "")]];
    const from2 = String(form.get(`from2_${d}`) ?? "");
    const to2 = String(form.get(`to2_${d}`) ?? "");
    if (from2 && to2) ranges.push([from2, to2]);
    weekly[d] = ranges;
  }
  const num = (k: string) => Number(form.get(k));
  try {
    await db.asUser(s.userId, (q) => saveBookingPage({ q, ctx: actorContext(s) }, {
      slug: String(form.get("slug") ?? ""),
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      durationMinutes: num("duration"),
      bufferMinutes: num("buffer"),
      minNoticeHours: num("notice"),
      maxDaysAhead: num("ahead"),
      timezone: String(form.get("timezone") ?? s.profile.timezone ?? "America/Sao_Paulo"),
      weeklyHours: weekly,
      active: form.get("active") === "on",
    }, id.success ? id.data : undefined));
    refresh();
    return { ok: "Página salva." };
  } catch (e) {
    return { error: e instanceof DomainError ? e.message : "Não foi possível salvar." };
  }
}
