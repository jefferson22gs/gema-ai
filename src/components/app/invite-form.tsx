"use client";

import { useActionState } from "react";
import { inviteAction, type InviteState } from "@/app/app/membros/actions";
import { Alert, Button, Field, Input, Select } from "@/components/ui/primitives";

export function InviteForm({ roles }: { roles: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="E-mail" htmlFor="inv-email"><Input id="inv-email" name="email" type="email" required /></Field>
      <Field label="Papel" htmlFor="inv-role">
        <Select id="inv-role" name="role" defaultValue="member">{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select>
      </Field>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.link ? (
        <Alert tone="success" title={state.emailStatus}>
          <span className="break-all font-mono text-[11px]">{state.link}</span>
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending}>{pending ? "Gerando…" : "Convidar"}</Button>
    </form>
  );
}
