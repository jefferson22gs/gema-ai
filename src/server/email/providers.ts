/**
 * EmailProvider — contrato único para Resend e Brevo.
 * `accepted`: provedor aceitou (tem id). `rejected`: recusa COMPROVADA (4xx/validação) — permite fallback.
 * `ambiguous`: timeout/erro de rede/5xx — a mensagem PODE ter sido aceita; nunca faz fallback (evita duplicidade).
 */
export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  tags?: Record<string, string>;
}

export type SendResult =
  | { outcome: "accepted"; providerMessageId: string }
  | { outcome: "rejected"; error: string; status?: number }
  | { outcome: "ambiguous"; error: string; status?: number };

export interface EmailProvider {
  readonly name: "resend" | "brevo";
  send(message: EmailMessage): Promise<SendResult>;
}

type FetchLike = typeof fetch;

async function postJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      // corpo vazio/não JSON
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function classify(status: number, json: Record<string, unknown>, idField: string): SendResult {
  if (status >= 200 && status < 300) {
    const id = json[idField];
    if (typeof id === "string" && id) return { outcome: "accepted", providerMessageId: id };
    return { outcome: "ambiguous", error: "resposta 2xx sem id de mensagem", status };
  }
  const error = typeof json.message === "string" ? json.message : `HTTP ${status}`;
  // 409 = conflito de idempotência (já enviado com a mesma chave): não é recusa.
  if (status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429) return { outcome: "rejected", error, status };
  return { outcome: "ambiguous", error, status };
}

export class ResendProvider implements EmailProvider {
  readonly name = "resend" as const;
  constructor(private readonly apiKey: string, private readonly fetchImpl: FetchLike = fetch, private readonly timeoutMs = 10_000) {}

  async send(m: EmailMessage): Promise<SendResult> {
    try {
      const { status, json } = await postJson(
        this.fetchImpl,
        "https://api.resend.com/emails",
        { authorization: `Bearer ${this.apiKey}`, "Idempotency-Key": m.idempotencyKey.slice(0, 256) },
        {
          from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text,
          tags: Object.entries(m.tags ?? {}).map(([name, value]) => ({ name, value })),
        },
        this.timeoutMs,
      );
      return classify(status, json, "id");
    } catch (e) {
      return { outcome: "ambiguous", error: e instanceof Error ? e.message : "erro de rede" };
    }
  }
}

export class BrevoProvider implements EmailProvider {
  readonly name = "brevo" as const;
  constructor(private readonly apiKey: string, private readonly fetchImpl: FetchLike = fetch, private readonly timeoutMs = 10_000) {}

  async send(m: EmailMessage): Promise<SendResult> {
    const fromMatch = /^(.*)<(.+)>$/.exec(m.from.trim());
    const sender = fromMatch ? { name: fromMatch[1].trim().replace(/"/g, ""), email: fromMatch[2].trim() } : { email: m.from.trim() };
    try {
      const { status, json } = await postJson(
        this.fetchImpl,
        "https://api.brevo.com/v3/smtp/email",
        { "api-key": this.apiKey, accept: "application/json" },
        {
          sender, to: [{ email: m.to }], subject: m.subject, htmlContent: m.html, textContent: m.text,
          headers: { "X-Idempotency-Key": m.idempotencyKey },
          tags: Object.values(m.tags ?? {}),
        },
        this.timeoutMs,
      );
      return classify(status, json, "messageId");
    } catch (e) {
      return { outcome: "ambiguous", error: e instanceof Error ? e.message : "erro de rede" };
    }
  }
}
