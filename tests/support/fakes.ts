/**
 * Dublês EXCLUSIVOS de teste. Nunca importados pelo código de produção.
 */
import type { AiModel, ModelInput, ModelOutput } from "@/server/ai/model";
import type { GoogleContactInput, GoogleEventInput, GoogleGateway } from "@/server/integrations/google/types";

/** Modelo roteirizado: devolve as chamadas de função definidas pelo teste. */
export class ScriptedModel implements AiModel {
  readonly name = "scripted-test-model";
  calls: ModelInput[] = [];
  constructor(private readonly script: (input: ModelInput) => Partial<ModelOutput>) {}
  async generate(input: ModelInput): Promise<ModelOutput> {
    this.calls.push(input);
    const out = this.script(input);
    return { text: out.text ?? "", functionCalls: out.functionCalls ?? [], usage: out.usage ?? { inputTokens: 100, outputTokens: 20 }, model: this.name };
  }
}

export class FakeGoogle implements GoogleGateway {
  events: GoogleEventInput[] = [];
  contacts: GoogleContactInput[] = [];
  constructor(private readonly connected = true) {}
  async isConnected() {
    return this.connected;
  }
  async createCalendarEvent(_u: string, _w: string, event: GoogleEventInput) {
    this.events.push(event);
    return { id: `gcal_${this.events.length}`, etag: '"1"' };
  }
  async createContact(_u: string, _w: string, contact: GoogleContactInput) {
    this.contacts.push(contact);
    return { resourceName: `people/c${this.contacts.length}` };
  }
}
