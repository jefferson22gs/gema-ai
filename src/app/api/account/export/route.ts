import { db } from "@/lib/db";
import { json, rateLimit } from "@/server/http";
import { getSession } from "@/server/session";

/** Portabilidade (LGPD): exporta os dados do titular acessíveis a ele, em JSON. */
export async function GET() {
  const s = await getSession();
  if (!s) return json({ error: "Não autenticado." }, 401);
  if (!(await rateLimit(`export:${s.userId}`, 3, 3600))) return json({ error: "Limite de exportações por hora atingido." }, 429);
  const data = await db.asUser(s.userId, async (q) => {
    const own = (table: string, cols = "*") => q.query(`select ${cols} from ${table} where owner_id = $1`, [s.userId]);
    const result = {
      exported_at: new Date().toISOString(),
      profile: (await q.query("select * from profiles where id = $1", [s.userId]))[0],
      preferences: (await q.query("select * from user_preferences where user_id = $1", [s.userId]))[0],
      consents: await q.query("select consent_type, granted, version, created_at from consent_records where user_id = $1", [s.userId]),
      workspaces: s.workspaces,
      transactions: await own("transactions"),
      calendar_events: await own("calendar_events"),
      tasks: await own("tasks"),
      projects: await own("projects"),
      contacts: await own("contacts"),
      reminders: await own("reminders"),
      documents: await own("documents", "id, file_name, mime_type, size_bytes, kind, created_at"),
      conversations: await own("conversations"),
      messages: await own("messages", "conversation_id, role, content, created_at"),
    };
    await q.query("select public.write_audit($1, 'user', 'account.exported', 'user', $2, '{}'::jsonb)", [s.workspace.id, s.userId]);
    return result;
  });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="gema-ai-meus-dados-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
