"use server";

import { headers } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/time";
import { DomainError } from "@/server/context";
import { rateLimit } from "@/server/http";
import { bookPublic, cancelPublic } from "@/server/services/booking";

export interface BookState {
  error?: string;
  booked?: { when: string; cancelUrl: string | null };
}

async function ip(): Promise<string> {
  const h = await headers();
  return h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function bookAction(_: BookState, form: FormData): Promise<BookState> {
  // Página pública: honeypot + limite por IP e por página (anti-spam / anti-esgotamento da agenda).
  if (String(form.get("website") ?? "")) return { error: "Não foi possível concluir." };
  const slug = String(form.get("slug") ?? "");
  const addr = await ip();
  if (!(await rateLimit(`booking:ip:${addr}`, 6, 3600)) || !(await rateLimit(`booking:page:${slug}`, 60, 3600))) {
    return { error: "Muitas tentativas. Tente novamente mais tarde." };
  }
  try {
    const r = await bookPublic(db, {
      slug,
      startsAt: String(form.get("startsAt") ?? ""),
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      note: String(form.get("note") ?? ""),
      clientKey: String(form.get("clientKey") ?? ""),
    }, new Date());
    return {
      booked: {
        when: formatDateTime(r.startsAt, r.page.rules.timezone, { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }),
        cancelUrl: r.cancelToken ? `${env.appUrl()}/agendar/cancelar?token=${r.cancelToken}` : null,
      },
    };
  } catch (e) {
    return { error: e instanceof DomainError ? e.message : "Não foi possível reservar agora. Tente novamente." };
  }
}

export async function cancelBookingAction(_: { done?: boolean; error?: string }, form: FormData): Promise<{ done?: boolean; error?: string }> {
  if (!(await rateLimit(`booking:cancel:${await ip()}`, 10, 3600))) return { error: "Muitas tentativas. Tente mais tarde." };
  const ok = await cancelPublic(db, String(form.get("token") ?? ""));
  return ok ? { done: true } : { error: "Reserva não encontrada, já cancelada ou já realizada." };
}
