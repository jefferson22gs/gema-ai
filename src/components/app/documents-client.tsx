"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileUp, Loader2, ScanText, Trash2 } from "lucide-react";
import { Alert, Button, Select } from "@/components/ui/primitives";

export function UploadDocument() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        const file = data.get("file");
        if (!(file instanceof File) || !file.size) return setMsg({ tone: "danger", text: "Escolha um arquivo." });
        if (file.size > 10 * 1024 * 1024) return setMsg({ tone: "danger", text: "Arquivo acima de 10 MB." });
        setBusy(true);
        setMsg(null);
        const res = await fetch("/api/documents", { method: "POST", body: data });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return setMsg({ tone: "danger", text: body.error ?? "Falha no envio." });
        form.reset();
        setMsg({ tone: "success", text: "Documento enviado com segurança." });
        router.refresh();
      }}
    >
      <label htmlFor="file" className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-4 py-8 text-center text-sm text-muted hover:border-gold/60">
        <FileUp className="size-6 text-gold" aria-hidden />
        Selecione PDF, JPG, PNG, WEBP ou TXT (até 10 MB)
        <input id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,text/plain" className="sr-only" />
      </label>
      <label htmlFor="kind" className="sr-only">Tipo</label>
      <Select id="kind" name="kind" defaultValue="receipt">
        <option value="receipt">Comprovante</option>
        <option value="invoice">Boleto / fatura</option>
        <option value="contract">Contrato</option>
        <option value="id">Documento pessoal</option>
        <option value="other">Outro</option>
      </Select>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Button type="submit" disabled={busy} className="w-full">{busy ? <Loader2 className="animate-spin" /> : null} Enviar</Button>
    </form>
  );
}

export function DocumentActions({ id, canExtract, canDelete }: { id: string; canExtract: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <a href={`/api/documents/${id}`} className="rounded-md px-2 py-1 text-xs text-gold hover:underline">Abrir</a>
        {canExtract ? (
          <button
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:text-fg"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("extract");
              const res = await fetch(`/api/documents/${id}/extract`, { method: "POST" });
              const body = await res.json().catch(() => ({}));
              setBusy(null);
              if (!res.ok) return setResult(body.error ?? "Falha.");
              const x = body.extraction;
              setResult(`Proposta (revise antes de lançar): ${x.merchant ?? "?"} · ${x.total != null ? `R$ ${Number(x.total).toFixed(2).replace(".", ",")}` : "valor ?"} · ${x.date ?? "data ?"}`);
              router.refresh();
            }}
          >
            {busy === "extract" ? <Loader2 className="size-3 animate-spin" /> : <ScanText className="size-3" />} Extrair
          </button>
        ) : null}
        {canDelete ? (
          <button
            className="rounded-md px-2 py-1 text-subtle hover:text-danger"
            aria-label="Excluir documento"
            disabled={busy !== null}
            onClick={async () => {
              if (!confirm("Excluir este documento definitivamente?")) return;
              setBusy("delete");
              await fetch(`/api/documents/${id}`, { method: "DELETE" });
              setBusy(null);
              router.refresh();
            }}
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>
      {result ? <p className="max-w-xs text-right text-[11px] text-muted">{result}</p> : null}
    </div>
  );
}
