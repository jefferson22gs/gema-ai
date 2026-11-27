"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { DomainError } from "@/server/context";
import { MAX_IMPORT_BYTES, StatementError, parseStatement } from "@/server/finance/statement-import";
import { rateLimit } from "@/server/http";
import { commitImport, deleteRule, previewImport, recategorize, type ImportPreview } from "@/server/services/statement-import";
import { actorContext, requireSession } from "@/server/session";

export interface ImportState {
  error?: string;
  /** Conteúdo do arquivo devolvido para a confirmação (nada é gravado na prévia). */
  fileName?: string;
  content?: string;
  positiveIs?: "income" | "expense";
  preview?: Omit<ImportPreview, "rows"> & { rows: ImportPreview["rows"]; total: number };
  done?: string;
}

async function readUpload(form: FormData): Promise<{ name: string; text: string; positiveIs: "income" | "expense" }> {
  const positiveIs = form.get("positiveIs") === "expense" ? "expense" : "income";
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_IMPORT_BYTES) throw new StatementError("Arquivo muito grande (máximo ~900 KB). Exporte um período menor.");
    const buf = Buffer.from(await file.arrayBuffer());
    // Bancos brasileiros ainda exportam em Latin-1: se não for UTF-8 válido, decodifica como Windows-1252.
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf);
    return { name: file.name, text, positiveIs };
  }
  const content = form.get("content");
  if (typeof content === "string" && content) return { name: String(form.get("fileName") ?? "extrato"), text: content, positiveIs };
  throw new StatementError("Escolha um arquivo OFX ou CSV.");
}

export async function previewImportAction(_: ImportState, form: FormData): Promise<ImportState> {
  const s = await requireSession();
  if (!(await rateLimit(`import:preview:${s.userId}`, 30, 3600))) return { error: "Muitas tentativas. Aguarde alguns minutos." };
  try {
    const { name, text, positiveIs } = await readUpload(form);
    const parsed = parseStatement(name, text, positiveIs);
    const preview = await db.asUser(s.userId, (q) => previewImport({ q, ctx: actorContext(s) }, parsed));
    return { fileName: name, content: text, positiveIs, preview: { ...preview, rows: preview.rows.slice(0, 50), total: preview.rows.length } };
  } catch (e) {
    return { error: e instanceof StatementError || e instanceof DomainError ? e.message : "Não foi possível ler o arquivo." };
  }
}

export async function commitImportAction(_: ImportState, form: FormData): Promise<ImportState> {
  const s = await requireSession();
  if (!(await rateLimit(`import:commit:${s.userId}`, 20, 3600))) return { error: "Muitas importações seguidas. Aguarde alguns minutos." };
  const accountId = z.string().uuid().optional().safeParse(form.get("accountId") || undefined);
  try {
    const { name, text, positiveIs } = await readUpload(form);
    const parsed = parseStatement(name, text, positiveIs);
    const r = await db.asUser(s.userId, (q) => commitImport({ q, ctx: actorContext(s) }, parsed, { accountId: accountId.success ? accountId.data : null }));
    refresh();
    return { done: `${r.inserted} lançamento(s) importado(s); ${r.duplicates} já existia(m)${r.skipped ? `; ${r.skipped} linha(s) ignorada(s)` : ""}.` };
  } catch (e) {
    return { error: e instanceof StatementError || e instanceof DomainError ? e.message : "Não foi possível importar agora." };
  }
}

export async function recategorizeAction(form: FormData) {
  const s = await requireSession();
  const id = z.string().uuid().parse(form.get("id"));
  const categoryId = z.string().uuid().parse(form.get("categoryId"));
  await db.asUser(s.userId, (q) => recategorize({ q, ctx: actorContext(s) }, id, categoryId, form.get("learn") === "on")).catch(() => undefined);
  refresh();
}

export async function deleteRuleAction(form: FormData) {
  const s = await requireSession();
  const id = z.string().uuid().parse(form.get("id"));
  await db.asUser(s.userId, (q) => deleteRule({ q, ctx: actorContext(s) }, id));
  refresh();
}
