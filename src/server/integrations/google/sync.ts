import type { Database } from "@/lib/db/types";
import { getAccessToken, type GoogleOAuthConfig } from "./oauth";

type FetchLike = typeof fetch;

interface GoogleEvent {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
}

/**
 * Sincronização incremental Google -> GEMA (sync token). Deduplicação por (workspace, provider, external_id);
 * eventos criados pelo próprio GEMA (extendedProperties.gemaOrigin) apenas atualizam o vínculo (sem loop).
 * Sync token inválido (410) => reinicia janela completa.
 */
export async function syncGoogleCalendar(db: Database, cfg: GoogleOAuthConfig, userId: string, workspaceId: string, fetchImpl: FetchLike = fetch) {
  const token = await getAccessToken(db, cfg, userId, workspaceId, "calendar", fetchImpl);
  if (!token) return { ok: false as const, error: "Google Agenda não conectado." };

  const [state] = await db.asService((q) =>
    q.query<{ sync_token: string | null }>(
      "select sync_token from calendar_sync_state where workspace_id = $1 and user_id = $2 and provider = 'google' and calendar_id = 'primary'",
      [workspaceId, userId],
    ),
  );
  let syncToken = state?.sync_token ?? null;
  let pageToken: string | undefined;
  let upserts = 0;
  let cancellations = 0;
  let nextSyncToken: string | undefined;

  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ maxResults: "250", singleEvents: "true" });
    if (syncToken) params.set("syncToken", syncToken);
    else params.set("timeMin", new Date(Date.now() - 30 * 86_400_000).toISOString());
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 410 && syncToken) {
      syncToken = null;
      pageToken = undefined;
      continue;
    }
    if (!res.ok) {
      await saveState(db, workspaceId, userId, null, `HTTP ${res.status}`);
      return { ok: false as const, error: `Google Calendar HTTP ${res.status}` };
    }
    const body = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };
    for (const ev of body.items ?? []) {
      if (ev.status === "cancelled") {
        const r = await db.asService((q) =>
          q.query("update calendar_events set status = 'cancelled' where workspace_id = $1 and external_provider = 'google' and external_id = $2 and status <> 'cancelled' returning id", [workspaceId, ev.id]),
        );
        cancellations += r.length;
        continue;
      }
      const start = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
      const end = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null);
      if (!start || !end) continue;
      await db.asService((q) =>
        q.query(
          `insert into calendar_events (workspace_id, owner_id, title, description, location, starts_at, ends_at, all_day, timezone, source,
             external_provider, external_id, external_etag, sync_status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'google', 'google', $10, $11, 'synced')
           on conflict (workspace_id, external_provider, external_id) where external_id is not null do update set
             title = excluded.title, description = excluded.description, location = excluded.location,
             starts_at = excluded.starts_at, ends_at = excluded.ends_at, all_day = excluded.all_day,
             external_etag = excluded.external_etag, sync_status = 'synced', status = 'confirmed'
           where calendar_events.external_etag is distinct from excluded.external_etag`,
          [workspaceId, userId, ev.summary ?? "(sem título)", ev.description ?? null, ev.location ?? null, start, end,
            Boolean(ev.start?.date), ev.start?.timeZone ?? "America/Sao_Paulo", ev.id, ev.etag ?? null],
        ),
      );
      upserts++;
    }
    pageToken = body.nextPageToken;
    nextSyncToken = body.nextSyncToken ?? nextSyncToken;
    if (!pageToken) break;
  }
  await saveState(db, workspaceId, userId, nextSyncToken ?? syncToken, null);
  return { ok: true as const, upserts, cancellations };
}

async function saveState(db: Database, workspaceId: string, userId: string, syncToken: string | null, error: string | null) {
  await db.asService((q) =>
    q.query(
      `insert into calendar_sync_state (workspace_id, user_id, provider, calendar_id, sync_token, last_synced_at, last_error)
       values ($1, $2, 'google', 'primary', $3, case when $4::text is null then now() end, $4)
       on conflict (workspace_id, user_id, provider, calendar_id) do update set
         sync_token = coalesce(excluded.sync_token, calendar_sync_state.sync_token),
         last_synced_at = coalesce(excluded.last_synced_at, calendar_sync_state.last_synced_at),
         last_error = excluded.last_error`,
      [workspaceId, userId, syncToken, error],
    ),
  );
}
