"use client";

import { useActionState } from "react";
import { cancelBookingAction } from "@/app/agendar/[slug]/actions";
import { Alert, Button } from "@/components/ui/primitives";

/** Cancelamento exige clique (não acontece só por abrir o link — pré-visualizadores de e-mail abrem links). */
export function CancelBookingForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<{ done?: boolean; error?: string }, FormData>(cancelBookingAction, {});
  if (state.done) return <Alert tone="success" title="Agendamento cancelado">O horário foi liberado.</Alert>;
  if (!token) return <Alert tone="warning">Link de cancelamento incompleto.</Alert>;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <Button type="submit" variant="danger" disabled={pending}>{pending ? "Cancelando…" : "Cancelar meu horário"}</Button>
    </form>
  );
}
