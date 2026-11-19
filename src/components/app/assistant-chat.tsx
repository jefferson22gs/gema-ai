"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Loader2, Mic, Square, X } from "lucide-react";
import { Alert, Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

interface Outcome {
  executionId: string | null;
  tool: string;
  status: "proposed" | "awaiting_confirmation" | "running" | "succeeded" | "failed" | "cancelled";
  message: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  outcomes?: Outcome[];
  pending?: boolean;
}

const STATUS_LABEL: Record<Outcome["status"], { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  succeeded: { label: "Concluída", tone: "success" },
  awaiting_confirmation: { label: "Aguardando confirmação", tone: "warning" },
  failed: { label: "Falhou", tone: "danger" },
  cancelled: { label: "Cancelada", tone: "neutral" },
  running: { label: "Executando", tone: "neutral" },
  proposed: { label: "Proposta", tone: "neutral" },
};

async function post(body: unknown) {
  const res = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Falha na comunicação.");
  return data;
}

export function AssistantChat({ initialMessages, initialQuery, assistantName, aiConfigured }: { initialMessages: ChatMessage[]; initialQuery?: string; assistantName: string; aiConfigured: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const conversationId = useRef<string | undefined>(undefined);
  const recorder = useRef<MediaRecorder | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages]);

  async function send(payload: { text?: string; media?: { mimeType: string; base64: string } }, display: string) {
    setError(null);
    setBusy(true);
    const localId = crypto.randomUUID();
    setMessages((m) => [...m, { id: localId, role: "user", text: display }, { id: `${localId}-a`, role: "assistant", text: "", pending: true }]);
    try {
      const data = await post({ action: "message", clientMessageId: localId, conversationId: conversationId.current, ...payload });
      conversationId.current = data.conversationId;
      setMessages((m) => m.map((x) => (x.id === `${localId}-a` ? { ...x, text: data.reply, outcomes: data.outcomes, pending: false } : x)));
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== `${localId}-a`));
      setError(e instanceof Error ? e.message : "Erro ao enviar.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialQuery && !sentInitial.current) {
      sentInitial.current = true;
      void send({ text: initialQuery }, initialQuery);
    }
  }, [initialQuery]);

  async function decide(msgId: string, o: Outcome, action: "confirm" | "cancel") {
    if (!o.executionId) return;
    setBusy(true);
    try {
      const data = await post({ action, executionId: o.executionId });
      const updated: Outcome = action === "confirm" ? data.outcome : { ...o, status: "cancelled", message: "Ação cancelada. Nada foi executado." };
      setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, outcomes: x.outcomes?.map((y) => (y.executionId === o.executionId ? updated : y)) } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (blob.size > 8 * 1024 * 1024) return setError("Áudio muito longo (máx. 8 MB).");
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        await send({ media: { mimeType: blob.type.split(";")[0], base64 } }, "🎙️ Áudio enviado");
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError("Não foi possível acessar o microfone. Verifique a permissão do navegador.");
    }
  }

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-[420px] flex-col rounded-[var(--radius-card)] border border-border bg-surface lg:h-[calc(100dvh-11rem)]">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-live="polite">
        {!aiConfigured ? (
          <Alert tone="warning" title="Gemini: Não configurado">O assistente responderá com o status de configuração até que GEMINI_API_KEY seja definida no servidor.</Alert>
        ) : null}
        {messages.length === 0 ? (
          <div className="mx-auto max-w-md py-10 text-center">
            <p className="text-lg font-medium">Como posso ajudar, hoje?</p>
            <p className="mt-2 text-sm text-muted">Exemplos: “gastei 85 no almoço e 40 no combustível”, “marca reunião com Ana amanhã às 10”, “como está meu dia?”.</p>
          </div>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[88%] rounded-2xl px-4 py-2.5 text-sm", m.role === "user" ? "rounded-br-sm bg-gold-soft" : "rounded-bl-sm border border-border bg-bg-elevated")}>
              {m.role === "assistant" ? <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-gold">{assistantName}</p> : null}
              {m.pending ? <Loader2 className="size-4 animate-spin text-muted" aria-label="Processando" /> : null}
              {m.outcomes?.length ? (
                <ul className="space-y-2">
                  {m.outcomes.map((o, i) => (
                    <li key={o.executionId ?? i} className="rounded-lg border border-border bg-surface px-3 py-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-subtle">{o.tool}</span>
                        <Badge tone={STATUS_LABEL[o.status].tone}>{STATUS_LABEL[o.status].label}</Badge>
                      </div>
                      <p className="whitespace-pre-wrap">{o.message}</p>
                      {o.status === "awaiting_confirmation" && o.executionId ? (
                        <div className="mt-2 flex gap-2">
                          <button disabled={busy} onClick={() => decide(m.id, o, "confirm")} className="inline-flex items-center gap-1 rounded-md bg-gold px-2.5 py-1 text-xs font-medium text-on-gold"><Check className="size-3" /> Confirmar</button>
                          <button disabled={busy} onClick={() => decide(m.id, o, "cancel")} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted"><X className="size-3" /> Cancelar</button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : !m.pending ? (
                <p className="whitespace-pre-wrap">{m.text}</p>
              ) : null}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {error ? <div className="px-4"><Alert tone="danger">{error}</Alert></div> : null}
      <form
        className="flex items-end gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t || busy) return;
          setText("");
          void send({ text: t }, t);
        }}
      >
        <button type="button" onClick={toggleRecording} disabled={busy && !recording} className={cn("grid size-10 shrink-0 place-items-center rounded-lg border border-border", recording ? "bg-danger-soft text-danger" : "text-muted hover:text-fg")} aria-label={recording ? "Parar gravação" : "Gravar áudio"}>
          {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
        </button>
        <label htmlFor="chat-input" className="sr-only">Mensagem</label>
        <textarea
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder={recording ? "Gravando… toque para parar" : "Escreva um pedido"}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-border-strong bg-bg-elevated px-3 py-2 text-sm focus:border-gold focus:outline-none"
        />
        <button type="submit" disabled={busy || !text.trim()} className="grid size-10 shrink-0 place-items-center rounded-lg bg-gold text-on-gold disabled:opacity-40" aria-label="Enviar">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </button>
      </form>
    </div>
  );
}
