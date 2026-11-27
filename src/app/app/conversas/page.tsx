import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Bot, MessagesSquare, Pause, UserRound, Wand2 } from "lucide-react";
import { ActionForm } from "@/components/app/action-form";
import { Badge, Card, CardBody, CardHeader, EmptyState, Input, PageHeader, Skeleton, Textarea } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { listInbox, type ConversationMode } from "@/server/services/inbox";
import { requireSession } from "@/server/session";
import { addNoteAction, humanReplyAction, setModeAction } from "./actions";

export const metadata: Metadata = { title: "Conversas" };

const MODES: Record<ConversationMode, { label: string; tone: "success" | "warning" | "gold" | "neutral"; icon: typeof Bot; help: string }> = {
  ai: { label: "IA automática", tone: "success", icon: Bot, help: "A GEMA responde automaticamente." },
  human: { label: "Atendimento humano", tone: "warning", icon: UserRound, help: "Você responde; a IA não envia nada." },
  copilot: { label: "Copiloto", tone: "gold", icon: Wand2, help: "A IA sugere respostas; você decide o que enviar." },
  paused: { label: "IA pausada", tone: "neutral", icon: Pause, help: "Ninguém responde automaticamente." },
};

async function Inbox({ searchParams }: { searchParams: PageProps<"/app/conversas">["searchParams"] }) {
  const sp = await searchParams;
  const s = await requireSession();
  const tz = s.profile.timezone;
  const search = typeof sp.q === "string" ? sp.q.slice(0, 100) : undefined;
  const convs = await db.asUser(s.userId, (q) => listInbox(q, s.workspace.id, { search }));
  const activeId = typeof sp.c === "string" ? sp.c : convs[0]?.id;
  const active = convs.find((c) => c.id === activeId);
  const { messages, notes, executions } = active
    ? await db.asUser(s.userId, async (q) => ({
        messages: await q.query<{ id: string; role: string; content: string; author_kind: string; created_at: Date; modality: string; delivery_status: string | null }>(
          "select id, role, content, author_kind, created_at, modality, delivery_status from messages where conversation_id = $1 order by created_at desc limit 60",
          [active.id],
        ),
        notes: await q.query<{ id: string; body: string; created_at: Date }>("select id, body, created_at from conversation_notes where conversation_id = $1 order by created_at desc limit 20", [active.id]),
        executions: await q.query<{ tool_name: string; status: string; created_at: Date }>(
          "select tool_name, status, created_at from ai_tool_executions where conversation_id = $1 order by created_at desc limit 10",
          [active.id],
        ),
      }))
    : { messages: [], notes: [], executions: [] };

  if (!convs.length && !search) {
    return <Card><EmptyState icon={<MessagesSquare />} title="Nenhuma conversa ainda" description="Conversas do painel e do WhatsApp aparecem aqui, com o modo de atendimento de cada uma." /></Card>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <Card className="h-fit">
        <form role="search" className="p-3">
          <label htmlFor="cq" className="sr-only">Buscar nas conversas</label>
          <Input id="cq" name="q" defaultValue={search} placeholder="Buscar nas mensagens" />
        </form>
        <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
          {convs.map((c) => (
            <li key={c.id}>
              <Link href={`?c=${c.id}${search ? `&q=${encodeURIComponent(search)}` : ""}`} aria-current={c.id === activeId ? "page" : undefined}
                className={cn("block px-4 py-3 text-sm hover:bg-surface-2", c.id === activeId && "bg-gold-soft")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{c.title ?? (c.channel === "whatsapp" ? "WhatsApp" : "Painel")}</span>
                  {c.unanswered ? <span className="size-2 shrink-0 rounded-full bg-gold" aria-label="Aguardando resposta" /> : null}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted">{c.last_preview ?? "—"}</p>
                <div className="mt-1 flex gap-1"><Badge>{c.channel}</Badge><Badge tone={MODES[c.mode].tone}>{MODES[c.mode].label}</Badge></div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {active ? (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Modo de atendimento" description={MODES[active.mode].help} />
            <CardBody className="flex flex-wrap gap-2">
              {(Object.keys(MODES) as ConversationMode[]).map((m) => {
                const Icon = MODES[m].icon;
                return (
                  <form key={m} action={setModeAction}>
                    <input type="hidden" name="id" value={active.id} /><input type="hidden" name="mode" value={m} /><input type="hidden" name="version" value={active.lock_version} />
                    <button disabled={m === active.mode} aria-pressed={m === active.mode}
                      className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs", m === active.mode ? "border-gold bg-gold-soft text-fg" : "border-border text-muted hover:text-fg")}>
                      <Icon className="size-3.5" />{MODES[m].label}
                    </button>
                  </form>
                );
              })}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Mensagens" />
            <CardBody>
              <ol className="flex max-h-[50vh] flex-col-reverse gap-2 overflow-y-auto">
                {messages.map((m) => (
                  <li key={m.id} className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                    m.role === "user" ? "self-start border border-border bg-bg-elevated" : m.role === "system" ? "self-center border border-dashed border-gold/50 text-xs text-muted" : "self-end bg-gold-soft")}>
                    <p className="whitespace-pre-wrap">{m.role === "system" ? `Sugestão do copiloto (não enviada): ${m.content}` : m.content}</p>
                    <p className="mt-1 text-[10px] text-subtle">
                      {formatDateTime(m.created_at, tz)} · {m.author_kind === "human_agent" ? "você" : m.author_kind === "ai" ? "IA" : m.role === "user" ? "contato" : "sistema"}
                      {m.modality !== "text" ? ` · ${m.modality}` : ""}{m.delivery_status ? ` · ${m.delivery_status}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
              {active.mode === "human" || active.mode === "copilot" ? (
                <div className="mt-4">
                  <ActionForm action={humanReplyAction} submitLabel="Enviar resposta">
                    <input type="hidden" name="id" value={active.id} /><input type="hidden" name="version" value={active.lock_version} />
                    <label htmlFor="reply" className="sr-only">Resposta</label>
                    <Textarea id="reply" name="text" rows={3} maxLength={4000} required placeholder="Escreva sua resposta" />
                  </ActionForm>
                </div>
              ) : <p className="mt-3 text-xs text-subtle">Para responder manualmente, mude para “Atendimento humano” ou “Copiloto”.</p>}
            </CardBody>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader title="Ações executadas" />
              <CardBody>
                {executions.length ? (
                  <ul className="space-y-1 text-xs">{executions.map((e, i) => <li key={i} className="flex justify-between"><span>{e.tool_name}</span><Badge tone={e.status === "succeeded" ? "success" : e.status === "failed" ? "danger" : "neutral"}>{e.status}</Badge></li>)}</ul>
                ) : <p className="text-xs text-muted">Nenhuma ação nesta conversa.</p>}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Notas internas" description="Visíveis só para você." />
              <CardBody className="space-y-3">
                <ActionForm action={addNoteAction} submitLabel="Salvar nota">
                  <input type="hidden" name="id" value={active.id} />
                  <label htmlFor="note" className="sr-only">Nota</label>
                  <Textarea id="note" name="body" rows={2} maxLength={4000} required />
                </ActionForm>
                <ul className="space-y-1 text-xs text-muted">{notes.map((n) => <li key={n.id}>{formatDateTime(n.created_at, tz)} — {n.body}</li>)}</ul>
              </CardBody>
            </Card>
          </div>
        </div>
      ) : <Card><EmptyState icon={<MessagesSquare />} title="Nenhum resultado" /></Card>}
    </div>
  );
}

export default function ConversasPage(props: PageProps<"/app/conversas">) {
  return (
    <>
      <PageHeader title="Conversas" description="Painel e WhatsApp em um só lugar. Humano e IA nunca respondem ao mesmo tempo." />
      <Suspense fallback={<Skeleton className="h-96" />}><Inbox searchParams={props.searchParams} /></Suspense>
    </>
  );
}
