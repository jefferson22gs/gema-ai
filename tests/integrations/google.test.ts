import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { completeGoogleOAuth, getAccessToken, revokeGoogle, startGoogleOAuth } from "@/server/integrations/google/oauth";
import { GoogleApiGateway } from "@/server/integrations/google/gateway";
import { syncGoogleCalendar } from "@/server/integrations/google/sync";
import { createTestDb, createUser } from "../db/harness";
import { pgliteDatabase } from "../support/pglite-db";

let pg: PGlite;
let db: Database;
let user: { id: string; personalWorkspaceId: string };
let intruder: { id: string; personalWorkspaceId: string };
const cfg = { clientId: "cid", clientSecret: "csecret", redirectUri: "https://app.test/api/oauth/google/callback", encryptionKey: Buffer.alloc(32, 9).toString("base64") };

/** Servidor Google simulado (contrato) — exclusivo de teste. */
const calls: { url: string; body: string; auth: string | null }[] = [];
const googleFetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const body = typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : "";
  calls.push({ url, body, auth: new Headers(init?.headers).get("authorization") });
  const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    const p = new URLSearchParams(body);
    if (p.get("grant_type") === "authorization_code" && p.get("code") === "good-code" && p.get("code_verifier")) {
      return json(200, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "https://www.googleapis.com/auth/calendar.events" });
    }
    return json(400, { error: "invalid_grant" });
  }
  if (url.includes("/calendar/v3/calendars/primary/events") && init?.method === "POST") return json(200, { id: "evt_abc", etag: '"e1"' });
  if (url.includes("/calendar/v3/calendars/primary/events")) {
    return json(200, {
      items: [
        { id: "g1", etag: '"1"', summary: "Do Google", start: { dateTime: "2026-11-21T12:00:00Z" }, end: { dateTime: "2026-11-21T13:00:00Z" } },
        { id: "g1", etag: '"1"', summary: "Do Google", start: { dateTime: "2026-11-21T12:00:00Z" }, end: { dateTime: "2026-11-21T13:00:00Z" } },
      ],
      nextSyncToken: "sync-1",
    });
  }
  if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new Response("", { status: 200 });
  throw new Error(`rota não simulada: ${url}`);
}) as typeof fetch;

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  user = await createUser(pg, "g@example.test");
  intruder = await createUser(pg, "x@example.test");
});

describe("Google OAuth (critério 6 — contrato)", () => {
  let state: string;

  it("gera URL com escopo mínimo, PKCE e state", async () => {
    const url = new URL(await startGoogleOAuth(db, cfg, user.id, user.personalWorkspaceId, "calendar"));
    expect(url.searchParams.get("scope")).toContain("calendar.events");
    expect(url.searchParams.get("scope")).not.toContain("contacts");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    state = url.searchParams.get("state")!;
    expect(state.length).toBeGreaterThan(30);
  });

  it("rejeita callback de outro usuário (anti-CSRF) e consome o state", async () => {
    const r = await completeGoogleOAuth(db, cfg, intruder.id, { state, code: "good-code", error: null }, googleFetch);
    expect(r).toEqual({ ok: false, error: "Autorização iniciada por outro usuário." });
    const again = await completeGoogleOAuth(db, cfg, user.id, { state, code: "good-code", error: null }, googleFetch);
    expect(again.ok).toBe(false); // uso único
  });

  it("callback válido cifra tokens e conecta", async () => {
    const url = new URL(await startGoogleOAuth(db, cfg, user.id, user.personalWorkspaceId, "calendar"));
    const r = await completeGoogleOAuth(db, cfg, user.id, { state: url.searchParams.get("state"), code: "good-code", error: null }, googleFetch);
    expect(r.ok).toBe(true);
    const { rows } = await pg.query<{ ciphertext: string }>("select ciphertext from encrypted_oauth_tokens");
    expect(rows[0].ciphertext).not.toContain("at-1");
    expect(rows[0].ciphertext).not.toContain("rt-1");
    expect(await getAccessToken(db, cfg, user.id, user.personalWorkspaceId, "calendar", googleFetch)).toBe("at-1");
    expect(await getAccessToken(db, cfg, user.id, user.personalWorkspaceId, "contacts", googleFetch)).toBeNull();
  });

  it("gateway cria evento com token do usuário e retorna id externo", async () => {
    const gw = new GoogleApiGateway(db, cfg, googleFetch);
    const ev = await gw.createCalendarEvent(user.id, user.personalWorkspaceId, {
      title: "Reunião", startsAt: new Date("2026-11-20T13:00:00Z"), endsAt: new Date("2026-11-20T14:00:00Z"), timezone: "America/Sao_Paulo",
    });
    expect(ev.id).toBe("evt_abc");
    expect(calls.at(-1)!.auth).toBe("Bearer at-1");
    expect(JSON.parse(calls.at(-1)!.body).extendedProperties.private.gemaOrigin).toBe("gema-ai");
  });

  it("sync incremental deduplica por external_id e salva sync token", async () => {
    const r = await syncGoogleCalendar(db, cfg, user.id, user.personalWorkspaceId, googleFetch);
    expect(r.ok).toBe(true);
    const ev = await pg.query("select external_id from calendar_events where external_id = 'g1'");
    expect(ev.rows).toHaveLength(1);
    const st = await pg.query<{ sync_token: string }>("select sync_token from calendar_sync_state");
    expect(st.rows[0].sync_token).toBe("sync-1");
  });

  it("revogação remove tokens localmente", async () => {
    await revokeGoogle(db, cfg, user.id, user.personalWorkspaceId, "calendar", googleFetch);
    expect((await pg.query("select 1 from encrypted_oauth_tokens")).rows).toHaveLength(0);
    const { rows } = await pg.query<{ status: string }>("select status from integrations where provider = 'google_calendar'");
    expect(rows[0].status).toBe("revoked");
    expect(await getAccessToken(db, cfg, user.id, user.personalWorkspaceId, "calendar", googleFetch)).toBeNull();
  });
});
