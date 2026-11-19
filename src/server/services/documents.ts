import { randomUUID } from "node:crypto";
import { DomainError, type ServiceDeps } from "../context";

export const ALLOWED_DOC_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain"] as const;
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

/** Assinaturas mágicas: o MIME declarado precisa bater com o conteúdo real. */
export function sniffMime(bytes: Uint8Array): string | null {
  const h = (n: number) => Array.from(bytes.slice(0, n)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (h(4) === "25504446") return "application/pdf";
  if (h(3) === "ffd8ff") return "image/jpeg";
  if (h(8) === "89504e470d0a1a0a") return "image/png";
  if (h(4) === "52494646" && Array.from(bytes.slice(8, 12)).map((b) => String.fromCharCode(b)).join("") === "WEBP") return "image/webp";
  // texto: sem bytes nulos nos primeiros 1 KB
  const head = bytes.slice(0, 1024);
  if (head.length && !head.includes(0)) return "text/plain";
  return null;
}

export function sanitizeFileName(name: string): string {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").slice(0, 100);
  return base || "arquivo";
}

export function validateUpload(fileName: string, declaredMime: string, bytes: Uint8Array): { mime: string; safeName: string } {
  if (bytes.byteLength === 0) throw new DomainError("invalid", "Arquivo vazio.");
  if (bytes.byteLength > MAX_DOC_BYTES) throw new DomainError("invalid", "Arquivo acima de 10 MB.");
  if (!(ALLOWED_DOC_MIME as readonly string[]).includes(declaredMime)) throw new DomainError("invalid", "Tipo de arquivo não permitido (PDF, JPG, PNG, WEBP ou TXT).");
  const sniffed = sniffMime(bytes);
  if (sniffed !== declaredMime) throw new DomainError("invalid", "O conteúdo do arquivo não corresponde ao tipo informado.");
  return { mime: sniffed, safeName: sanitizeFileName(fileName) };
}

export function storagePathFor(workspaceId: string, ownerId: string, safeName: string): string {
  return `${workspaceId}/${ownerId}/${randomUUID()}-${safeName}`;
}

export interface DocumentRow {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  kind: string;
  status: string;
  storage_path: string;
  created_at: Date;
  owner_id: string;
}

export async function listDocuments({ q, ctx }: ServiceDeps): Promise<DocumentRow[]> {
  return q.query<DocumentRow>(
    `select id, file_name, mime_type, size_bytes, kind, status, storage_path, created_at, owner_id
     from documents where workspace_id = $1 and deleted_at is null order by created_at desc limit 200`,
    [ctx.workspaceId],
  );
}

export async function getDocument({ q, ctx }: ServiceDeps, id: string): Promise<DocumentRow | null> {
  const rows = await q.query<DocumentRow>(
    "select id, file_name, mime_type, size_bytes, kind, status, storage_path, created_at, owner_id from documents where id = $1 and workspace_id = $2 and deleted_at is null",
    [id, ctx.workspaceId],
  );
  return rows[0] ?? null;
}
