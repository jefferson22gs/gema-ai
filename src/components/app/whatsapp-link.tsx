"use client";

import { useState } from "react";
import { Copy, Loader2, MessageCircle } from "lucide-react";
import { createWhatsAppLinkCode } from "@/app/app/integracoes/actions";
import { Alert, Button } from "@/components/ui/primitives";

/** Fluxo recomendado: gerar código no painel e enviá-lo do próprio WhatsApp ao número oficial do GEMA. */
export function WhatsAppLinkCode() {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ code?: string; expiresAt?: string; number?: string | null; error?: string } | null>(null);
  const digits = state?.number?.replace(/\D/g, "");
  return (
    <div className="space-y-3">
      <Button
        onClick={async () => {
          setBusy(true);
          setState(await createWhatsAppLinkCode());
          setBusy(false);
        }}
        disabled={busy}
      >
        {busy ? <Loader2 className="animate-spin" /> : <MessageCircle />} Gerar código de vinculação
      </Button>
      {state?.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state?.code ? (
        <div className="rounded-lg border border-gold/40 bg-gold-soft p-4">
          <p className="text-xs text-muted">Envie esta mensagem do seu WhatsApp{state.number ? ` para ${state.number}` : " para o número oficial do GEMA"}:</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded-md bg-bg-elevated px-3 py-2 font-mono text-lg tracking-wider text-fg">{state.code}</code>
            <button type="button" aria-label="Copiar código" className="rounded-md p-2 text-muted hover:text-fg" onClick={() => navigator.clipboard?.writeText(state.code!)}>
              <Copy className="size-4" />
            </button>
          </div>
          <p className="mt-2 text-[11px] text-subtle">Uso único · expira às {new Date(state.expiresAt!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. Não compartilhe este código.</p>
          {digits ? (
            <a className="mt-3 inline-block text-sm text-gold underline" href={`https://wa.me/${digits}?text=${encodeURIComponent(state.code)}`} target="_blank" rel="noopener noreferrer">
              Abrir conversa no WhatsApp
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
