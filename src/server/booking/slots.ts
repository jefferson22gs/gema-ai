import { addDaysToDateString, localDateString, localParts, zonedToUtc } from "@/lib/time";

/** Grade semanal: chave = dia da semana (0 = domingo), valor = faixas ["HH:mm","HH:mm"] no fuso da página. */
export type WeeklyHours = Record<string, [string, string][]>;

export interface BookingRules {
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  timezone: string;
  weeklyHours: WeeklyHours;
}

export interface Interval {
  start: Date;
  end: Date;
}

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** Valida e normaliza a grade (faixas ordenadas, sem sobreposição, fim > início). */
export function parseWeeklyHours(raw: unknown): WeeklyHours {
  if (!raw || typeof raw !== "object") throw new Error("Grade de horários inválida.");
  const out: WeeklyHours = {};
  for (const [day, ranges] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(day) || !Array.isArray(ranges)) throw new Error("Grade de horários inválida.");
    const list = ranges.map((r) => {
      if (!Array.isArray(r) || r.length !== 2 || !HM.test(String(r[0])) || !HM.test(String(r[1])) || toMin(String(r[1])) <= toMin(String(r[0]))) {
        throw new Error(`Faixa de horário inválida no dia ${day}.`);
      }
      return [String(r[0]), String(r[1])] as [string, string];
    }).sort((a, b) => toMin(a[0]) - toMin(b[0]));
    for (let i = 1; i < list.length; i++) if (toMin(list[i][0]) < toMin(list[i - 1][1])) throw new Error(`Faixas sobrepostas no dia ${day}.`);
    if (list.length) out[day] = list;
  }
  return out;
}

/**
 * Horários livres por dia (no fuso da página), de `from` até o limite de dias. Um horário é livre quando cabe na
 * grade, respeita a antecedência mínima e não encosta em nenhum intervalo ocupado (considerando a folga).
 * Passo = duração (slots alinhados ao início de cada faixa), o que evita horários "quebrados" para o convidado.
 */
export function availableSlots(rules: BookingRules, busy: Interval[], now: Date, days = rules.maxDaysAhead): { date: string; slots: Date[] }[] {
  const { durationMinutes: dur, bufferMinutes: buf, timezone: tz } = rules;
  const earliest = now.getTime() + rules.minNoticeHours * 3_600_000;
  const latest = now.getTime() + rules.maxDaysAhead * 86_400_000;
  const blocked = busy.map((b) => ({ s: b.start.getTime() - buf * 60_000, e: b.end.getTime() + buf * 60_000 }));
  const today = localDateString(now, tz);
  const out: { date: string; slots: Date[] }[] = [];
  for (let i = 0; i <= Math.min(days, rules.maxDaysAhead); i++) {
    const date = addDaysToDateString(today, i);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const slots: Date[] = [];
    for (const [from, to] of rules.weeklyHours[String(weekday)] ?? []) {
      for (let m = toMin(from); m + dur <= toMin(to); m += dur) {
        const hm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        const start = zonedToUtc(date, hm, tz);
        // Salto de horário de verão: horário inexistente desloca; descarta se mudou de hora local.
        if (localParts(start, tz).hour !== Math.floor(m / 60)) continue;
        const s = start.getTime();
        const e = s + dur * 60_000;
        if (s < earliest || s > latest) continue;
        if (blocked.some((b) => s < b.e && e > b.s)) continue;
        slots.push(start);
      }
    }
    if (slots.length) out.push({ date, slots });
  }
  return out;
}

/** O horário pedido pertence à grade publicada? (impede reservar 09:07 ou fora do expediente via API) */
export function isOfferedSlot(rules: BookingRules, start: Date): boolean {
  const p = localParts(start, rules.timezone);
  const m = p.hour * 60 + p.minute;
  if (start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0) return false;
  return (rules.weeklyHours[String(p.weekday)] ?? []).some(([from, to]) => m >= toMin(from) && m + rules.durationMinutes <= toMin(to) && (m - toMin(from)) % rules.durationMinutes === 0);
}
