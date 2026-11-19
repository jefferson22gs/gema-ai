import type { Database } from "@/lib/db/types";
import { getAccessToken, type GoogleOAuthConfig } from "./oauth";
import type { GoogleContactInput, GoogleEventInput, GoogleGateway } from "./types";

type FetchLike = typeof fetch;

/** Google Calendar API v3 + People API v1 com tokens do próprio usuário. */
export class GoogleApiGateway implements GoogleGateway {
  constructor(private readonly db: Database, private readonly cfg: GoogleOAuthConfig, private readonly fetchImpl: FetchLike = fetch) {}

  async isConnected(userId: string, workspaceId: string, product: "calendar" | "contacts") {
    return (await getAccessToken(this.db, this.cfg, userId, workspaceId, product, this.fetchImpl)) !== null;
  }

  private async token(userId: string, workspaceId: string, product: "calendar" | "contacts") {
    const t = await getAccessToken(this.db, this.cfg, userId, workspaceId, product, this.fetchImpl);
    if (!t) throw new Error("Google não conectado.");
    return t;
  }

  async createCalendarEvent(userId: string, workspaceId: string, e: GoogleEventInput) {
    const token = await this.token(userId, workspaceId, "calendar");
    const res = await this.fetchImpl("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary: e.title,
        description: e.description ?? undefined,
        location: e.location ?? undefined,
        start: { dateTime: e.startsAt.toISOString(), timeZone: e.timezone },
        end: { dateTime: e.endsAt.toISOString(), timeZone: e.timezone },
        // Marca origem para evitar loop de sincronização (eventos com esta chave não são reimportados).
        extendedProperties: { private: { gemaOrigin: "gema-ai" } },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; etag?: string; htmlLink?: string; error?: { message?: string } };
    if (!res.ok || !json.id) throw new Error(json.error?.message ?? `Google Calendar HTTP ${res.status}`);
    return { id: json.id, etag: json.etag, htmlLink: json.htmlLink };
  }

  async createContact(userId: string, workspaceId: string, c: GoogleContactInput) {
    const token = await this.token(userId, workspaceId, "contacts");
    const res = await this.fetchImpl("https://people.googleapis.com/v1/people:createContact?personFields=names,phoneNumbers,emailAddresses", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        names: [{ unstructuredName: c.name }],
        phoneNumbers: c.phoneE164 ? [{ value: c.phoneE164 }] : undefined,
        emailAddresses: c.email ? [{ value: c.email }] : undefined,
        organizations: c.company ? [{ name: c.company }] : undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { resourceName?: string; error?: { message?: string } };
    if (!res.ok || !json.resourceName) throw new Error(json.error?.message ?? `People API HTTP ${res.status}`);
    return { resourceName: json.resourceName };
  }
}
