"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

/** Alterna Dark Executive (padrão) e Light Signature; preferência local do navegador. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.theme ?? "dark",
    () => "dark",
  );
  const next = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("gema-theme", next);
        } catch {
          // armazenamento indisponível: tema vale só nesta sessão
        }
      }}
      className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
      aria-label={next === "light" ? "Ativar tema claro" : "Ativar tema escuro"}
    >
      {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </button>
  );
}

/** Script inline mínimo para aplicar o tema antes da pintura (evita flash). */
export const themeInitScript = `try{var t=localStorage.getItem("gema-theme");if(t==="light")document.documentElement.dataset.theme="light"}catch(e){}`;
