"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUp, Sparkles } from "lucide-react";

const SUGGESTIONS = ["Como está meu dia?", "Gastei 85 no almoço", "Marca reunião amanhã às 10", "Lembrar de pagar o aluguel dia 5 às 9h"];

/** Campo "O que posso fazer por você?" — leva o pedido ao Assistente. */
export function QuickAsk() {
  const router = useRouter();
  const [text, setText] = useState("");
  const go = (t: string) => {
    if (!t.trim()) return;
    router.push(`/app/assistente?q=${encodeURIComponent(t.trim())}`);
  };
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(text);
        }}
        className="flex items-center gap-2 rounded-xl border border-border-strong bg-bg-elevated p-1.5 pl-3 focus-within:border-gold"
      >
        <Sparkles className="size-4 shrink-0 text-gold" aria-hidden />
        <label htmlFor="quick-ask" className="sr-only">O que posso fazer por você?</label>
        <input
          id="quick-ask"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="O que posso fazer por você?"
          className="h-9 min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-subtle focus:outline-none"
          maxLength={4000}
        />
        <button type="submit" className="grid size-9 place-items-center rounded-lg bg-gold text-on-gold disabled:opacity-40" disabled={!text.trim()} aria-label="Enviar ao assistente">
          <ArrowUp className="size-4" />
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => go(s)} className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-gold/50 hover:text-fg">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
