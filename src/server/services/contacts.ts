import { DomainError, type ServiceDeps } from "../context";

export interface ContactRow {
  id: string;
  name: string;
  phone_e164: string | null;
  email: string | null;
  company: string | null;
  notes: string | null;
  tags: string[];
  google_resource_name: string | null;
  source: string;
  visibility: "private" | "workspace";
}

const COLUMNS = "id, name, phone_e164, email, company, notes, tags, google_resource_name, source, visibility";

/**
 * Normaliza telefone para E.164. Números brasileiros sem DDI recebem +55.
 * Retorna null quando não for possível obter um número plausível.
 */
export function normalizePhoneE164(raw: string, defaultCountry = "55"): string | null {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (!hasPlus) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (digits.length === 10 || digits.length === 11) digits = defaultCountry + digits.replace(/^0/, "");
  }
  if (digits.startsWith("55")) {
    const national = digits.slice(2);
    // DDD (2) + número (8 fixo ou 9 celular iniciando com 9)
    if (!/^[1-9]{2}(9\d{8}|[2-8]\d{7})$/.test(national)) return null;
  }
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}

export interface ContactInput {
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  notes?: string;
  tags?: string[];
  visibility?: "private" | "workspace";
  source?: "local" | "google" | "ai" | "import";
  idempotencyKey?: string;
}

export async function findDuplicateContact({ q, ctx }: ServiceDeps, phone: string | null, email: string | null): Promise<ContactRow | null> {
  if (!phone && !email) return null;
  const rows = await q.query<ContactRow>(
    `select ${COLUMNS} from contacts where workspace_id = $1 and deleted_at is null
       and (($2::text is not null and phone_e164 = $2) or ($3::text is not null and lower(email) = lower($3)))
     limit 1`,
    [ctx.workspaceId, phone, email],
  );
  return rows[0] ?? null;
}

export async function createContact(deps: ServiceDeps, input: ContactInput): Promise<{ contact: ContactRow; created: boolean; duplicate: boolean }> {
  const name = input.name.trim();
  if (!name) throw new DomainError("invalid", "Nome obrigatório.");
  let phone: string | null = null;
  if (input.phone) {
    phone = normalizePhoneE164(input.phone);
    if (!phone) throw new DomainError("invalid", "Telefone inválido. Use o formato +55 11 91234-5678.");
  }
  const email = input.email?.trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("invalid", "E-mail inválido.");

  const dup = await findDuplicateContact(deps, phone, email);
  if (dup) return { contact: dup, created: false, duplicate: true };

  const rows = await deps.q.query<{ id: string }>(
    `insert into contacts (workspace_id, owner_id, visibility, name, phone_e164, email, company, notes, tags, source, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (workspace_id, idempotency_key) do nothing returning id`,
    [deps.ctx.workspaceId, deps.ctx.userId, input.visibility ?? "private", name, phone, email, input.company ?? null,
      input.notes ?? null, input.tags ?? [], input.source ?? "local", input.idempotencyKey ?? null],
  );
  const created = rows.length > 0;
  const id = created
    ? rows[0].id
    : (await deps.q.query<{ id: string }>("select id from contacts where workspace_id = $1 and idempotency_key = $2", [deps.ctx.workspaceId, input.idempotencyKey]))[0]?.id;
  const [contact] = await deps.q.query<ContactRow>(`select ${COLUMNS} from contacts where id = $1`, [id]);
  return { contact, created, duplicate: false };
}

export async function searchContacts({ q, ctx }: ServiceDeps, term?: string, limit = 50): Promise<ContactRow[]> {
  return q.query<ContactRow>(
    `select ${COLUMNS} from contacts
     where workspace_id = $1 and deleted_at is null
       and ($2::text is null or name ilike '%' || $2 || '%' or email ilike '%' || $2 || '%' or phone_e164 like '%' || $2 || '%' or company ilike '%' || $2 || '%')
     order by name limit $3`,
    [ctx.workspaceId, term?.trim() || null, Math.min(limit, 200)],
  );
}

export async function setGoogleResource({ q, ctx }: ServiceDeps, id: string, resourceName: string) {
  await q.query("update contacts set google_resource_name = $3 where id = $1 and workspace_id = $2", [id, ctx.workspaceId, resourceName]);
}

export async function deleteContact({ q, ctx }: ServiceDeps, id: string): Promise<boolean> {
  const rows = await q.query("update contacts set deleted_at = now() where id = $1 and workspace_id = $2 and deleted_at is null returning id", [id, ctx.workspaceId]);
  return rows.length > 0;
}
