"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { ActionState } from "@/app/app/actions";
import { Alert, Button } from "@/components/ui/primitives";

/** Formulário genérico ligado a uma Server Action com feedback acessível e reset em sucesso. */
export function ActionForm({
  action,
  children,
  submitLabel,
  className,
  resetOnSuccess = true,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children: ReactNode;
  submitLabel: string;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className ?? "space-y-4"}>
      {children}
      <div aria-live="polite">
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        {state.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Salvando…" : submitLabel}</Button>
    </form>
  );
}
