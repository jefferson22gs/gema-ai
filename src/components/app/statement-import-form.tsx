"use client";

import { useActionState } from "react";
import { commitImportAction, previewImportAction, type ImportState } from "@/app/app/financas/importar/actions";
import { Alert, Badge, Button, Field, Input, Select } from "@/components/ui/primitives";
import { formatCents } from "@/lib/money";

export function StatementImportForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const [preview, previewAction, previewing] = useActionState<ImportState, FormData>(previewImportAction, {});
  const [result, commitAction, committing] = useActionState<ImportState, FormData>(commitImportAction, {});
  const p = preview.preview;
  return (
    <div className="space-y-6">
      <form action={previewAction} className="grid gap-4 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
        <Field label="Arquivo do extrato (OFX ou CSV)" htmlFor="imp-file" hint="Exporte do app ou internet banking. Máximo ~900 KB.">
          <Input id="imp-file" name="file" type="file" accept=".ofx,.csv,.txt,text/csv,application/x-ofx" required />
        </Field>
        <Field label="Valores positivos no CSV são" htmlFor="imp-sign">
          <Select id="imp-sign" name="positiveIs" defaultValue="income">
            <option value="income">Entradas (extrato de conta)</option>
            <option value="expense">Compras (fatura de cartão)</option>
          </Select>
        </Field>
        <Button type="submit" variant="secondary" disabled={previewing}>{previewing ? "Lendo…" : "Pré-visualizar"}</Button>
      </form>
      {preview.error ? <Alert tone="danger">{preview.error}</Alert> : null}

      {p && preview.content ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
            <Badge tone="gold">{p.format.toUpperCase()}</Badge>
            <span><strong>{p.newCount}</strong> novo(s)</span>
            <span className="text-muted">· {p.duplicateCount} já importado(s)</span>
            {p.skipped.length ? <span className="text-warning">· {p.skipped.length} linha(s) ignorada(s): {p.skipped.slice(0, 3).map((x) => `linha ${x.line} (${x.reason})`).join(", ")}</span> : null}
          </div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <caption className="sr-only">Prévia da importação</caption>
              <thead className="text-left text-xs text-subtle">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium">Data</th><th className="px-3 py-2 font-medium">Descrição</th>
                  <th className="px-3 py-2 font-medium">Categoria sugerida</th><th className="px-4 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {p.rows.map((r) => (
                  <tr key={r.externalId} className={r.duplicate ? "text-subtle" : ""}>
                    <td className="px-4 py-2 tabular-nums">{r.date}</td>
                    <td className="px-3 py-2">{r.description}{r.duplicate ? <Badge className="ml-2">já existe</Badge> : null}</td>
                    <td className="px-3 py-2 text-muted">{r.categoryName ?? "Outros"}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${r.kind === "income" ? "text-success" : ""}`}>{r.kind === "expense" ? "-" : "+"}{formatCents(r.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.total > p.rows.length ? <p className="text-xs text-subtle">Mostrando {p.rows.length} de {p.total} lançamentos.</p> : null}
          <form action={commitAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="content" value={preview.content} />
            <input type="hidden" name="fileName" value={preview.fileName} />
            <input type="hidden" name="positiveIs" value={preview.positiveIs} />
            {accounts.length ? (
              <Field label="Vincular à conta (opcional)" htmlFor="imp-acc">
                <Select id="imp-acc" name="accountId" defaultValue=""><option value="">Nenhuma</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
              </Field>
            ) : null}
            <Button type="submit" disabled={committing || p.newCount === 0}>{committing ? "Importando…" : `Importar ${p.newCount} lançamento(s)`}</Button>
          </form>
        </div>
      ) : null}
      {result.error ? <Alert tone="danger">{result.error}</Alert> : null}
      {result.done ? <Alert tone="success" title="Importação concluída">{result.done}</Alert> : null}
    </div>
  );
}
