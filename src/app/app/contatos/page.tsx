import type { Metadata } from "next";
import { Suspense } from "react";
import { Trash2, Users } from "lucide-react";
import { ActionForm } from "@/components/app/action-form";
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Skeleton, Textarea } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { searchContacts } from "@/server/services/contacts";
import { actorContext, requireSession } from "@/server/session";
import { createContactAction, deleteContactAction } from "../actions";

export const metadata: Metadata = { title: "Contatos" };

async function Contacts({ searchParams }: { searchParams: PageProps<"/app/contatos">["searchParams"] }) {
  const sp = await searchParams;
  const term = typeof sp.q === "string" ? sp.q.slice(0, 100) : undefined;
  const s = await requireSession();
  const ctx = actorContext(s);
  const contacts = await db.asUser(s.userId, (q) => searchContacts({ q, ctx }, term, 200));
  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <Card>
        <form role="search" className="px-5 pt-5">
          <label htmlFor="cq" className="sr-only">Buscar contatos</label>
          <Input id="cq" name="q" defaultValue={term} placeholder="Buscar por nome, telefone, e-mail ou empresa" />
        </form>
        <CardBody>
          {contacts.length ? (
            <ul className="divide-y divide-border">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.name}{c.company ? <span className="ml-2 font-normal text-muted">· {c.company}</span> : null}</p>
                    <p className="text-xs text-muted">{[c.phone_e164, c.email].filter(Boolean).join(" · ") || "Sem telefone/e-mail"}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.google_resource_name ? <Badge tone="success">Google Contatos</Badge> : null}
                      {c.tags.map((t) => <Badge key={t}>{t}</Badge>)}
                    </div>
                  </div>
                  <form action={deleteContactAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-subtle hover:text-danger" aria-label={`Remover ${c.name}`}><Trash2 className="size-4" /></button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Users />} title={term ? "Nenhum contato encontrado" : "Nenhum contato ainda"} description="Seus contatos não são usados para treinar IA nem para marketing." />
          )}
        </CardBody>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Novo contato" description="Telefone validado no formato internacional (E.164)." />
        <CardBody>
          <ActionForm action={createContactAction} submitLabel="Salvar contato">
            <Field label="Nome" htmlFor="name"><Input id="name" name="name" required maxLength={160} /></Field>
            <Field label="Telefone" htmlFor="phone" hint="Ex.: +55 11 91234-5678"><Input id="phone" name="phone" type="tel" /></Field>
            <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" /></Field>
            <Field label="Empresa" htmlFor="company"><Input id="company" name="company" /></Field>
            <Field label="Etiquetas" htmlFor="tags" hint="Separadas por vírgula"><Input id="tags" name="tags" /></Field>
            <Field label="Notas" htmlFor="notes"><Textarea id="notes" name="notes" rows={2} /></Field>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}

export default function ContatosPage(props: PageProps<"/app/contatos">) {
  return (
    <>
      <PageHeader title="Contatos" />
      <Suspense fallback={<Skeleton className="h-80" />}><Contacts searchParams={props.searchParams} /></Suspense>
    </>
  );
}
