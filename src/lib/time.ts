import { TZDate } from "@date-fns/tz";

/** Persistência sempre em UTC; cálculos de calendário no timezone do usuário. */
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Partes da data/hora local em `tz` para um instante. */
export function localParts(instant: Date, tz: string) {
  const d = new TZDate(instant.getTime(), tz);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    weekday: d.getDay(),
  };
}

/** Data local "YYYY-MM-DD" de um instante no timezone informado. */
export function localDateString(instant: Date, tz: string): string {
  const p = localParts(instant, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Converte data local (YYYY-MM-DD) + hora local (HH:mm) em instante UTC.
 * Horários inexistentes (salto de DST) são deslocados para frente pelo próprio TZDate.
 */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!dm || !tm) throw new Error(`data/hora inválida: ${date} ${time}`);
  const [, y, mo, d] = dm.map(Number);
  const [, h, mi] = tm.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) throw new Error(`data/hora inválida: ${date} ${time}`);
  // Dia inexistente (ex.: 31/02) seria normalizado para o mês seguinte: rejeitamos.
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) throw new Error(`data inexistente: ${date}`);
  const zoned = new TZDate(y, mo - 1, d, h, mi, 0, tz);
  return new Date(zoned.getTime());
}

/** Soma dias a uma data local YYYY-MM-DD (sem depender de timezone). */
export function addDaysToDateString(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d + days));
  return base.toISOString().slice(0, 10);
}

/** Início e fim (UTC) do dia local que contém `instant`. */
export function localDayRange(instant: Date, tz: string): { start: Date; end: Date; date: string } {
  const date = localDateString(instant, tz);
  return { start: zonedToUtc(date, "00:00", tz), end: zonedToUtc(addDaysToDateString(date, 1), "00:00", tz), date };
}

export function monthRange(instant: Date, tz: string): { start: string; end: string } {
  const p = localParts(instant, tz);
  const start = `${p.year}-${String(p.month).padStart(2, "0")}-01`;
  const next = p.month === 12 ? `${p.year + 1}-01-01` : `${p.year}-${String(p.month + 1).padStart(2, "0")}-01`;
  return { start, end: next };
}

export type Recurrence = "daily" | "weekly" | "monthly";

/**
 * Próxima ocorrência de um lembrete recorrente estritamente após `after`, mantendo o
 * mesmo horário LOCAL (ex.: 07:00 em America/New_York continua 07:00 após a troca de DST).
 * `anchor` é a primeira ocorrência (define dia da semana/dia do mês).
 */
export function nextOccurrence(anchor: Date, recurrence: Recurrence, localTime: string, tz: string, after: Date): Date {
  const a = localParts(anchor, tz);
  let date = localDateString(anchor, tz);
  let candidate = zonedToUtc(date, localTime, tz);
  let guard = 0;
  while (candidate.getTime() <= after.getTime()) {
    if (recurrence === "daily") {
      date = addDaysToDateString(date, 1);
    } else if (recurrence === "weekly") {
      date = addDaysToDateString(date, 7);
    } else {
      const [y, m] = date.split("-").map(Number);
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
      date = `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(a.day, lastDay)).padStart(2, "0")}`;
    }
    candidate = zonedToUtc(date, localTime, tz);
    if (++guard > 5000) throw new Error("recorrência sem convergência");
  }
  return candidate;
}

export function formatDateTime(instant: Date | string, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    dateStyle: "short",
    timeStyle: "short",
    ...opts,
  }).format(typeof instant === "string" ? new Date(instant) : instant);
}

export function formatTime(instant: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(
    typeof instant === "string" ? new Date(instant) : instant,
  );
}

export function formatLongDate(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(instant);
}
