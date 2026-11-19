import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Folder } from "lucide-react";
import { ActionForm } from "@/components/app/action-form";
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Skeleton, Textarea } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { listProjects } from "@/server/services/tasks";
import { actorContext, requireSession } from "@/server/session";
import { createProjectAction } from "../actions";

export const metadata: Metadata = { title: "Projetos" };

async function Projects() {
  const s = await requireSession();
  const ctx = actorContext(s);
  const projects = await db.asUser(s.userId, (q) => listProjects({ q, ctx }));
  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="grid gap-4 sm:grid-cols-2">
        {projects.length ? projects.map((p) => {
          const total = p.open_tasks + p.done_tasks;
          const pct = total ? Math.round((p.done_tasks / total) * 100) : 0;
          return (
            <Card key={p.id} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-medium">{p.name}</h2>
                <Badge tone="gold">{p.status === "active" ? "Ativo" : p.status}</Badge>
              </div>
              {p.description ? <p className="mt-1 line-clamp-2 text-sm text-muted">{p.description}</p> : null}
              <div className="mt-4 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-gold" style={{ width: `${pct}%` }} /></div>
              <p className="mt-2 text-xs text-muted">{p.done_tasks}/{total} tarefas concluídas{p.due_on ? ` · prazo ${p.due_on}` : ""}</p>
              <Link href={`/app/tarefas?status=all`} className="mt-3 inline-block text-xs text-gold hover:underline">Ver tarefas</Link>
            </Card>
          );
        }) : (
          <Card className="sm:col-span-2"><EmptyState icon={<Folder />} title="Nenhum projeto" description="Agrupe tarefas por projeto para acompanhar o progresso." /></Card>
        )}
      </div>
      <Card className="h-fit">
        <CardHeader title="Novo projeto" />
        <CardBody>
          <ActionForm action={createProjectAction} submitLabel="Criar projeto">
            <Field label="Nome" htmlFor="name"><Input id="name" name="name" required maxLength={120} /></Field>
            <Field label="Descrição" htmlFor="description"><Textarea id="description" name="description" rows={3} /></Field>
            <Field label="Prazo" htmlFor="dueOn"><Input id="dueOn" name="dueOn" type="date" /></Field>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}

export default function ProjetosPage() {
  return (
    <>
      <PageHeader title="Projetos" />
      <Suspense fallback={<Skeleton className="h-72" />}><Projects /></Suspense>
    </>
  );
}
