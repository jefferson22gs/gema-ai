"use client";

import { useRef } from "react";
import { recategorizeAction } from "@/app/app/financas/importar/actions";

/**
 * Corrige a categoria ao escolher no seletor. "Lembrar" (marcado por padrão) cria/atualiza a regra para o mesmo
 * estabelecimento, usada nas próximas importações e lançamentos (FIN-10).
 */
export function Recategorize({ id, description, value, options }: { id: string; description: string; value: string | null; options: { id: string; name: string }[] }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={recategorizeAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`cat-${id}`}>Categoria de {description}</label>
      <select
        id={`cat-${id}`}
        name="categoryId"
        defaultValue={value ?? ""}
        onChange={() => form.current?.requestSubmit()}
        className="h-8 max-w-44 rounded-md border border-border bg-surface px-2 text-xs text-muted"
      >
        {value ? null : <option value="" disabled>—</option>}
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <label className="flex items-center gap-1 text-[11px] text-subtle" title="Aplicar a próximos lançamentos deste estabelecimento">
        <input type="checkbox" name="learn" defaultChecked className="size-3.5 accent-[var(--color-gold)]" />lembrar
      </label>
    </form>
  );
}
