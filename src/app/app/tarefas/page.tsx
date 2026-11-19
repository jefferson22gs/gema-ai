import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CheckSquare, Circle, CircleCheck, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/app/action-form";
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { listProjects, listTasks } from "@/server/services/tasks";
import { actorContext, requireSession } from "@/server/session";
import { createTaskAction, deleteTaskAction, toggleTaskAction } from "../actions";

export const metadata: Metadata = { title: "Tarefas" };

const PRIORITY = { urgent: { label: "Urgente", tone: "danger" }, high: { label: "Alta", tone: "warning" }, medium: { label: "Média", tone: "neutral" }, low: { label: "Baixa", tone: "neutral" } } as const;

async function TaskList({ searchParams }: { searchParams: PageProps<"/app/tarefas">["searchParams"] }) {
  const sp = await searchParams;
  const s = await requireSession();
  const ctx = actorContext(s);
  const status = sp.status === "done" || sp.status === "all" ? sp.status : "open";
  const search = typeof sp.q === "string" ? sp.q.slice(0, 100) : undefined;
  const { tasks, projects } = await db.asUser(s.userId, async (q) => ({ tasks: await listTasks({ q, ctx }, { status, search }), projects: await listProjects({ q, ctx }) }));
  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5">
          <div className="flex rounded-lg border border-border p-0.5 text-xs">
            {[["open", "Abertas"], ["done", "Concluídas"], ["all", "Todas"]].map(([v, l]) => (
              <Link key={v} href={`?status=${v}`} aria-current={v === status ? "page" : undefined} className={cn("rounded-md px-3 py-1.5", v === status ? "bg-surface-2 text-fg" : "text-muted")}>{l}</Link>
            ))}
          </div>
          <form role="search" className="flex gap-2">
            <input type="hidden" name="status" value={status} />
            <label htmlFor="tq" className="sr-only">Buscar tarefas</label>
            <Input id="tq" name="q" defaultValue={search} placeholder="Buscar" className="h-8 w-44" />
          </form>
        </div>
        <CardBody>
          {tasks.length ? (
            <ul className="divide-y divide-border">
              {tasks.map((t) => {
                const done = Boolean(t.completed_at);
                const overdue = !done && t.due_at && new Date(t.due_at) < ctx.now;
                return (
                  <li key={t.id} className="flex items-start gap-3 py-3">
                    <form action={toggleTaskAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="done" value={String(done)} />
                      <button aria-label={done ? `Reabrir ${t.title}` : `Concluir ${t.title}`} className="mt-0.5 text-muted hover:text-gold">
                        {done ? <CircleCheck className="size-5 text-success" /> : <Circle className="size-5" />}
                      </button>
                    </form>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm", done && "text-subtle line-through")}>{t.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
                        {t.due_at ? <span className={overdue ? "text-danger" : ""}>{overdue ? "Atrasada · " : ""}{formatDateTime(t.due_at, ctx.timezone)}</span> : null}
                        {t.project_name ? <Badge tone="gold">{t.project_name}</Badge> : null}
                        {t.source !== "manual" ? <Badge>{t.source === "whatsapp" ? "WhatsApp" : t.source === "ai" ? "IA" : "Automação"}</Badge> : null}
                      </div>
                    </div>
                    <form action={deleteTaskAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button className="text-subtle hover:text-danger" aria-label={`Excluir ${t.title}`}><Trash2 className="size-4" /></button>
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={<CheckSquare />} title={status === "done" ? "Nenhuma tarefa concluída" : "Nenhuma tarefa aberta"} description="Crie ao lado ou diga ao assistente: “criar tarefa enviar proposta até sexta”." />
          )}
        </CardBody>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Nova tarefa" />
        <CardBody>
          <ActionForm action={createTaskAction} submitLabel="Criar tarefa">
            <Field label="Título" htmlFor="title"><Input id="title" name="title" required maxLength={200} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prazo" htmlFor="dueDate"><Input id="dueDate" name="dueDate" type="date" /></Field>
              <Field label="Hora" htmlFor="dueTime"><Input id="dueTime" name="dueTime" type="time" /></Field>
            </div>
            <Field label="Prioridade" htmlFor="priority">
              <Select id="priority" name="priority" defaultValue="medium">
                <option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="urgent">Urgente</option>
              </Select>
            </Field>
            {projects.length ? (
              <Field label="Projeto" htmlFor="projectId">
                <Select id="projectId" name="projectId" defaultValue=""><option value="">Nenhum</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
              </Field>
            ) : null}
            <Field label="Notas" htmlFor="notes"><Textarea id="notes" name="notes" rows={3} maxLength={2000} /></Field>
            {s.workspace.kind !== "personal" ? (
              <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="visibility" value="workspace" className="accent-[var(--gold)]" /> Compartilhar com o workspace</label>
            ) : null}
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}

export default function TarefasPage(props: PageProps<"/app/tarefas">) {
  return (
    <>
      <PageHeader title="Tarefas" />
      <Suspense fallback={<Skeleton className="h-96" />}><TaskList searchParams={props.searchParams} /></Suspense>
    </>
  );
}
