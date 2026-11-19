import { describe, expect, it } from "vitest";
import { EvolutionProvider, evolutionSender } from "@/server/messaging/evolution";

/** Evolution simulada (somente teste): registra chamadas e permite simular sessão fechada. */
function engine(status = 201) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (String(url).includes("/instance/connectionState/")) return new Response(JSON.stringify({ instance: { state: "open" } }), { status: 200 });
    return new Response(JSON.stringify(status < 300 ? { key: { id: "OUT-1" } } : { response: { message: ["Connection Closed"] } }), { status });
  }) as typeof fetch;
  return { impl, calls };
}

const SECRET = "evo-secret";
const cfg = { baseUrl: "https://api.evo.test/", instanceToken: "inst-token", instance: "gema-ai", webhookSecret: SECRET };

function upsert(data: Record<string, unknown>, instance = "gema-ai") {
  return JSON.stringify({ event: "messages.upsert", instance, data, apikey: "CHAVE-DO-CORPO-NUNCA-USADA", date_time: "2026-11-20T10:00:00Z" });
}
const msg = (id: string, message: Record<string, unknown>, key: Record<string, unknown> = {}) => ({
  key: { id, remoteJid: "5511912345678@s.whatsapp.net", fromMe: false, ...key },
  message,
  messageTimestamp: 1795000000,
});
const h = (secret: string | null = SECRET) => new Headers(secret === null ? {} : { "x-evo-secret": secret });

describe("webhook Evolution (x-evo-secret)", () => {
  const p = new EvolutionProvider(cfg, engine().impl);

  it("sem header, segredo errado ou segredo vazio no servidor => não verificado", async () => {
    const body = upsert(msg("A", { conversation: "oi" }));
    expect((await p.receive(body, h(null))).verified).toBe(false);
    expect((await p.receive(body, h("errado"))).verified).toBe(false);
    const noSecret = new EvolutionProvider({ ...cfg, webhookSecret: "" }, engine().impl);
    expect((await noSecret.receive(body, h(""))).verified).toBe(false);
    expect((await p.receive(body, h())).verified).toBe(true);
  });

  it("instância diferente, fromMe e grupo são ignorados", async () => {
    expect((await p.receive(upsert(msg("B", { conversation: "oi" }), "Tubarao"), h())).events).toEqual([]);
    expect((await p.receive(upsert(msg("C", { conversation: "oi" }, { remoteJid: "1203@g.us" })), h())).events).toEqual([]);
    const own = await p.receive(upsert(msg("D", { conversation: "oi" }, { fromMe: true })), h());
    expect(own.events[0].fromMe).toBe(true); // marcado para o pipeline descartar
  });

  it("texto, imagem base64 (com legenda), áudio base64 e documento são extraídos", async () => {
    const text = await p.receive(upsert(msg("T", { extendedTextMessage: { text: "olá" } })), h());
    expect(text.events[0]).toMatchObject({ type: "text", text: "olá", from: "+5511912345678" });

    const img = await p.receive(upsert(msg("I", { imageMessage: { mimetype: "image/jpeg", caption: "recibo" }, base64: "SU1H" })), h());
    expect(img.events[0]).toMatchObject({ type: "image", text: "recibo", inlineMedia: { mimeType: "image/jpeg", base64: "SU1H" } });

    const audio = await p.receive(upsert(msg("A2", { audioMessage: { mimetype: "audio/ogg; codecs=opus" }, base64: "QVVE" })), h());
    expect(audio.events[0]).toMatchObject({ type: "audio", inlineMedia: { mimeType: "audio/ogg", base64: "QVVE" } });
    expect(await p.downloadMedia(audio.events[0])).toEqual({ mimeType: "audio/ogg", base64: "QVVE" });

    const doc = await p.receive(upsert(msg("P", { documentMessage: { mimetype: "application/pdf", caption: "contrato" } })), h());
    expect(doc.events[0]).toMatchObject({ type: "text", text: "contrato" });
  });

  it("remetente @lid usa remoteJidAlt/senderPn; sem alternativa é descartado", async () => {
    expect(evolutionSender({ remoteJid: "999@lid", remoteJidAlt: "5511912345678@s.whatsapp.net" })).toBe("+5511912345678");
    expect(evolutionSender({ remoteJid: "999@lid", senderPn: "5521988887777@s.whatsapp.net" })).toBe("+5521988887777");
    expect((await p.receive(upsert(msg("L", { conversation: "oi" }, { remoteJid: "999@lid" })), h())).events).toEqual([]);
  });
});

describe("cliente Evolution", () => {
  it("usa o token da instância no header apikey e a rota da instância", async () => {
    const e = engine();
    const p = new EvolutionProvider(cfg, e.impl);
    const r = await p.sendText("+5511912345678", "teste");
    expect(r).toEqual({ ok: true, providerMessageId: "OUT-1" });
    expect(e.calls[0].url).toBe("https://api.evo.test/message/sendText/gema-ai");
    expect(e.calls[0].headers.get("apikey")).toBe("inst-token");
    expect(e.calls[0].body).toEqual({ number: "5511912345678", text: "teste" });
  });

  it("sessão fechada vira erro tratado, sem exceção", async () => {
    const p = new EvolutionProvider(cfg, engine(400).impl);
    await expect(p.sendText("+5511912345678", "x")).resolves.toEqual({ ok: false, error: "HTTP 400" });
  });

  it("health lê connectionState", async () => {
    const e = engine();
    expect(await new EvolutionProvider(cfg, e.impl).health()).toEqual({ status: "connected" });
    expect(e.calls[0].url).toBe("https://api.evo.test/instance/connectionState/gema-ai");
  });
});
