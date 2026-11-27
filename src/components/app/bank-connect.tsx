"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Landmark, Loader2 } from "lucide-react";
import { Alert, Button } from "@/components/ui/primitives";

/**
 * Abre o widget oficial Pluggy Connect (iframe do provedor). A senha bancária é digitada
 * apenas no ambiente do banco/provedor — o GEMA nunca a recebe.
 */
export function BankConnectButton({ itemId, label = "Conectar banco" }: { itemId?: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "danger" | "success"; text: string } | null>(null);

  async function open() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/open-finance/connect-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Não foi possível iniciar a conexão.");
      const { PluggyConnect } = await import("pluggy-connect-sdk");
      const widget = new PluggyConnect({
        connectToken: data.token,
        includeSandbox: Boolean(data.includeSandbox),
        language: "pt",
        updateItem: itemId,
        onSuccess: async ({ item }) => {
          const r = await fetch("/api/open-finance/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId: item.id }) });
          const body = await r.json().catch(() => ({}));
          setMsg(r.ok ? { tone: "success", text: "Conexão autorizada. A sincronização começa em instantes." } : { tone: "danger", text: body.error ?? "Falha ao registrar a conexão." });
          router.refresh();
        },
        onError: ({ message }) => setMsg({ tone: "danger", text: message || "Não foi possível concluir a conexão." }),
        onClose: () => setBusy(false),
      });
      await widget.init();
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "Erro inesperado." });
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={open} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Landmark />} {label}</Button>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
    </div>
  );
}
