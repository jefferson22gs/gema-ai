import { addDaysToDateString, localDateString, localParts, zonedToUtc } from "@/lib/time";
import { DomainError, type ActorContext } from "../context";

export const RELATIVE_DAYS = ["hoje", "amanha", "depois_de_amanha"] as const;
export const WEEKDAYS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"] as const;

/**
 * Resolve a data local no SERVIDOR (relógio + timezone do usuário), sem confiar em datas
 * calculadas pelo modelo. Prioridade: relative_day > weekday > date explícita.
 */
export function resolveLocalDate(
  ctx: Pick<ActorContext, "now" | "timezone">,
  input: { date?: string; relative_day?: (typeof RELATIVE_DAYS)[number]; weekday?: (typeof WEEKDAYS)[number] },
): string {
  const today = localDateString(ctx.now, ctx.timezone);
  if (input.relative_day) {
    return addDaysToDateString(today, RELATIVE_DAYS.indexOf(input.relative_day));
  }
  if (input.weekday) {
    const target = WEEKDAYS.indexOf(input.weekday);
    const current = localParts(ctx.now, ctx.timezone).weekday;
    const diff = (target - current + 7) % 7 || 7; // "sexta" = próxima sexta (nunca hoje)
    return addDaysToDateString(today, diff);
  }
  if (input.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new DomainError("invalid", "Data inválida.");
    return input.date;
  }
  return today;
}

export function resolveInstant(ctx: Pick<ActorContext, "now" | "timezone">, date: string, time: string): Date {
  try {
    return zonedToUtc(date, time, ctx.timezone);
  } catch {
    throw new DomainError("invalid", `Data/hora inválida: ${date} ${time}.`);
  }
}
