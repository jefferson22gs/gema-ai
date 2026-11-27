import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import { toolDeclarations } from "./tools";

/** Porta de modelo de IA. Produção: Gemini. Testes: implementação roteirizada (somente em testes). */
export interface ModelInput {
  systemInstruction: string;
  history: { role: "user" | "model"; text: string }[];
  text?: string;
  media?: { mimeType: string; base64: string };
  /** Ferramentas declaradas ao modelo (escopo do agente ativo). Ausente = todas. */
  tools?: ReadonlySet<string>;
}

export interface ModelOutput {
  text: string;
  functionCalls: { name: string; args: Record<string, unknown> }[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface AiModel {
  readonly name: string;
  generate(input: ModelInput, signal?: AbortSignal): Promise<ModelOutput>;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("Gemini não configurado (GEMINI_API_KEY ausente).");
    this.name = "AiNotConfiguredError";
  }
}

export class GeminiModel implements AiModel {
  private readonly client: GoogleGenAI;

  constructor(apiKey: string, readonly name: string, private readonly timeoutMs = 25_000) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generate(input: ModelInput, signal?: AbortSignal): Promise<ModelOutput> {
    const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [];
    if (input.media) parts.push({ inlineData: { mimeType: input.media.mimeType, data: input.media.base64 } });
    if (input.text) parts.push({ text: input.text });

    const response = await this.client.models.generateContent({
      model: this.name,
      contents: [
        ...input.history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
        { role: "user", parts },
      ],
      config: {
        systemInstruction: input.systemInstruction,
        temperature: 0.2,
        maxOutputTokens: 1024,
        tools: [{ functionDeclarations: toolDeclarations(input.tools) }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        httpOptions: { timeout: this.timeoutMs },
        abortSignal: signal,
      },
    });

    return {
      text: response.text ?? "",
      functionCalls: (response.functionCalls ?? [])
        .filter((c) => typeof c.name === "string")
        .map((c) => ({ name: c.name!, args: (c.args ?? {}) as Record<string, unknown> })),
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model: this.name,
    };
  }
}

/** Custo estimado em USD com preços configuráveis por milhão de tokens (ver docs/AI_TOOLS.md). */
export function estimateCostUsd(usage: ModelOutput["usage"]): number {
  const inPrice = Number(process.env.GEMINI_PRICE_INPUT_PER_MTOK ?? "0.30");
  const outPrice = Number(process.env.GEMINI_PRICE_OUTPUT_PER_MTOK ?? "2.50");
  return (usage.inputTokens * inPrice + usage.outputTokens * outPrice) / 1_000_000;
}

export function getDefaultModel(): AiModel | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  return new GeminiModel(key, process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest");
}
