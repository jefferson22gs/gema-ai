import { describe, expect, it } from "vitest";
import { toCents } from "@/lib/money";
import { localDateString, nextOccurrence, zonedToUtc } from "@/lib/time";
import { resolveLocalDate } from "@/server/ai/dates";
import { normalizePhoneE164 } from "@/server/services/contacts";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

describe("dinheiro", () => {
  it.each([
    [85, 8500],
    ["85", 8500],
    ["85,90", 8590],
    ["1.234,56", 123456],
    ["R$ 40", 4000],
    ["12.5", 1250],
  ])("toCents(%s) = %s", (input, cents) => expect(toCents(input)).toBe(cents));

  it.each([["abc"], [0], [-5], ["1,2,3"]])("rejeita %s", (input) => expect(toCents(input as never)).toBeNull());
});

describe("tempo e timezone", () => {
  it("converte horário local de São Paulo para UTC", () => {
    expect(zonedToUtc("2026-11-20", "10:00", "America/Sao_Paulo").toISOString()).toBe("2026-11-20T13:00:00.000Z");
  });

  it("rejeita data inexistente", () => {
    expect(() => zonedToUtc("2026-02-31", "10:00", "America/Sao_Paulo")).toThrow();
  });

  it("data local considera o fuso (23h em SP já é outro dia em UTC)", () => {
    expect(localDateString(new Date("2026-11-20T02:30:00Z"), "America/Sao_Paulo")).toBe("2026-11-19");
  });

  it("resolve 'amanhã' e dia da semana no servidor", () => {
    const ctx = { now: new Date("2026-11-19T15:00:00Z"), timezone: "America/Sao_Paulo" }; // quinta
    expect(resolveLocalDate(ctx, { relative_day: "amanha" })).toBe("2026-11-20");
    expect(resolveLocalDate(ctx, { weekday: "segunda" })).toBe("2026-11-23");
    expect(resolveLocalDate(ctx, { weekday: "quinta" })).toBe("2026-11-26");
  });
});

describe("recorrência com DST (critério 10)", () => {
  it("lembrete diário 07:00 em New York mantém horário local na troca de horário", () => {
    const tz = "America/New_York";
    // 07/03/2026 07:00 EST = 12:00 UTC; DST começa em 08/03/2026.
    const anchor = zonedToUtc("2026-03-07", "07:00", tz);
    expect(anchor.toISOString()).toBe("2026-03-07T12:00:00.000Z");
    const next = nextOccurrence(anchor, "daily", "07:00", tz, anchor);
    expect(next.toISOString()).toBe("2026-03-08T11:00:00.000Z"); // 07:00 EDT
    const after = nextOccurrence(anchor, "daily", "07:00", tz, next);
    expect(after.toISOString()).toBe("2026-03-09T11:00:00.000Z");
  });

  it("mensal no dia 31 cai no último dia de meses curtos", () => {
    const tz = "America/Sao_Paulo";
    const anchor = zonedToUtc("2026-01-31", "09:00", tz);
    const next = nextOccurrence(anchor, "monthly", "09:00", tz, anchor);
    expect(localDateString(next, tz)).toBe("2026-02-28");
  });
});

describe("telefone E.164", () => {
  it.each([
    ["+55 11 91234-5678", "+5511912345678"],
    ["(11) 91234-5678", "+5511912345678"],
    ["11 3456-7890", "+551134567890"],
    ["+1 415 555 2671", "+14155552671"],
  ])("%s => %s", (raw, e164) => expect(normalizePhoneE164(raw)).toBe(e164));

  it.each([["123"], ["+55 11 1234"], ["abc"]])("rejeita %s", (raw) => expect(normalizePhoneE164(raw)).toBeNull());
});

describe("criptografia de tokens", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  it("cifra e decifra; adulteração falha", () => {
    const enc = encryptSecret('{"refresh_token":"x"}', key);
    expect(enc).not.toContain("refresh_token");
    expect(decryptSecret(enc, key)).toBe('{"refresh_token":"x"}');
    const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(tampered, key)).toThrow();
  });
});
