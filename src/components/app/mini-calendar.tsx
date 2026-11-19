import { addDaysToDateString, localDateString, localParts } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Mini calendário do mês corrente (timezone do usuário) com marcação de dias com compromissos. */
export function MiniCalendar({ now, timezone, eventDates }: { now: Date; timezone: string; eventDates: Set<string> }) {
  const today = localDateString(now, timezone);
  const p = localParts(now, timezone);
  const first = `${p.year}-${String(p.month).padStart(2, "0")}-01`;
  const firstWeekday = new Date(`${first}T12:00:00Z`).getUTCDay();
  const daysInMonth = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => addDaysToDateString(first, i))];
  const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: timezone }).format(now);
  return (
    <div>
      <p className="mb-3 text-sm font-medium capitalize">{monthName}</p>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px]" role="grid" aria-label={`Calendário de ${monthName}`}>
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
          <span key={i} className="py-1 text-subtle" aria-hidden>{d}</span>
        ))}
        {cells.map((date, i) =>
          date ? (
            <span
              key={date}
              className={cn(
                "relative grid aspect-square place-items-center rounded-md text-xs",
                date === today ? "bg-gold font-semibold text-on-gold" : "text-muted",
              )}
              aria-label={`${date}${eventDates.has(date) ? ", com compromissos" : ""}`}
            >
              {Number(date.slice(8))}
              {eventDates.has(date) && date !== today ? <span className="absolute bottom-1 size-1 rounded-full bg-gold" /> : null}
            </span>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
    </div>
  );
}
