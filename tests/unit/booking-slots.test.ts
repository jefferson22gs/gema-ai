import { describe, expect, it } from "vitest";
import { availableSlots, isOfferedSlot, parseWeeklyHours, type BookingRules } from "@/server/booking/slots";

// 2026-11-27 é sexta-feira. São Paulo = UTC-3 (sem horário de verão).
const NOW = new Date("2026-11-27T12:00:00Z"); // 09:00 local
const rules: BookingRules = {
  durationMinutes: 60,
  bufferMinutes: 0,
  minNoticeHours: 2,
  maxDaysAhead: 7,
  timezone: "America/Sao_Paulo",
  weeklyHours: { "1": [["09:00", "12:00"]], "5": [["09:00", "12:00"], ["14:00", "16:00"]] },
};
const local = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 16);

describe("grade semanal", () => {
  it("valida e ordena; rejeita faixas inválidas ou sobrepostas", () => {
    expect(parseWeeklyHours({ "1": [["14:00", "18:00"], ["08:00", "12:00"]] })).toEqual({ "1": [["08:00", "12:00"], ["14:00", "18:00"]] });
    expect(() => parseWeeklyHours({ "7": [] })).toThrow();
    expect(() => parseWeeklyHours({ "1": [["10:00", "09:00"]] })).toThrow(/inválida/);
    expect(() => parseWeeklyHours({ "1": [["09:00", "12:00"], ["11:00", "13:00"]] })).toThrow(/sobrepostas/);
    expect(() => parseWeeklyHours({ "1": [["9:00", "12:00"]] })).toThrow();
  });
});

describe("horários livres", () => {
  it("respeita antecedência mínima, grade, dias e limite", () => {
    const days = availableSlots(rules, [], NOW);
    // Sexta: 09:00 e 10:00 caem antes de 11:00 (agora + 2 h); sobram 11:00, 14:00, 15:00.
    expect(days[0]).toMatchObject({ date: "2026-11-27" });
    expect(days[0].slots.map(local)).toEqual(["2026-11-27 11:00", "2026-11-27 14:00", "2026-11-27 15:00"]);
    // Segunda seguinte: 09, 10, 11. Fim de semana sem grade.
    expect(days[1]).toMatchObject({ date: "2026-11-30" });
    expect(days[1].slots.map(local)).toEqual(["2026-11-30 09:00", "2026-11-30 10:00", "2026-11-30 11:00"]);
    expect(days.map((d) => d.date)).toEqual(["2026-11-27", "2026-11-30", "2026-12-04"]);
  });

  it("ocupados bloqueiam, com folga antes e depois", () => {
    const busy = [{ start: new Date("2026-11-30T13:30:00Z"), end: new Date("2026-11-30T13:45:00Z") }]; // 10:30–10:45 local
    const noBuf = availableSlots(rules, busy, NOW).find((d) => d.date === "2026-11-30")!;
    expect(noBuf.slots.map(local)).toEqual(["2026-11-30 09:00", "2026-11-30 11:00"]);
    const withBuf = availableSlots({ ...rules, bufferMinutes: 20 }, busy, NOW).find((d) => d.date === "2026-11-30")!;
    expect(withBuf.slots.map(local)).toEqual(["2026-11-30 09:00"]); // 11:00 fica a 15 min do fim: bloqueado
  });

  it("horário de verão: horário local inexistente não é oferecido", () => {
    // Nova York, 2027-03-14 (domingo): 02:00–03:00 não existe.
    const ny: BookingRules = { ...rules, timezone: "America/New_York", minNoticeHours: 0, weeklyHours: { "0": [["01:00", "04:00"]] } };
    const day = availableSlots(ny, [], new Date("2027-03-13T12:00:00Z")).find((d) => d.date === "2027-03-14")!;
    expect(day.slots.map((s) => s.toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(11, 16))).toEqual(["01:00", "03:00"]);
  });

  it("isOfferedSlot só aceita inícios da grade", () => {
    expect(isOfferedSlot(rules, new Date("2026-11-30T12:00:00Z"))).toBe(true); // seg 09:00
    expect(isOfferedSlot(rules, new Date("2026-11-30T12:07:00Z"))).toBe(false); // 09:07
    expect(isOfferedSlot(rules, new Date("2026-11-30T14:00:00Z"))).toBe(true); // 11:00, termina 12:00
    expect(isOfferedSlot(rules, new Date("2026-11-30T15:00:00Z"))).toBe(false); // 12:00 (fim da faixa)
    expect(isOfferedSlot({ ...rules, durationMinutes: 45 }, new Date("2026-11-30T13:00:00Z"))).toBe(false); // 10:00 fora do passo de 45 min
    expect(isOfferedSlot(rules, new Date("2026-11-29T12:00:00Z"))).toBe(false); // domingo
  });
});
