import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { ActionForm } from "@/components/app/action-form";
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Skeleton, buttonVariants } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { addDaysToDateString, formatTime, localDateString, localParts, zonedToUtc } from "@/lib/time";
import { cn } from "@/lib/utils";
import { listEvents, type CalendarEventRow } from "@/server/services/calendar";
import { actorContext, requireSession } from "@/server/session";
import { cancelEventAction, createEventAction } from "../actions";

export const metadata: Metadata = { title: "Agenda" };

type View = "dia" | "semana" | "mes";

function rangeFor(view: View, anchor: string): { from: string; to: string; days: string[] } {
  if (view === "dia") return { from: anchor, to: addDaysToDateString(anchor, 1), days: [anchor] };
  if (view === "semana") {
    const wd = new Date(`${anchor}T12:00:00Z`).getUTCDay();
    const start = addDaysToDateString(anchor, -wd);
    const days = Array.from({ length: 7 }, (_, i) => addDaysToDateString(start, i));
    return { from: start, to: addDaysToDateString(start, 7), days };
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const [y, m] = first.split("-").map(Number);
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: first, to: addDaysToDateString(first, len), days: Array.from({ length: len }, (_, i) => addDaysToDateString(first, i)) };
}

function shift(view: View, anchor: string, dir: 1 | -1): string {
  if (view === "dia") return addDaysToDateString(anchor, dir);
  if (view === "semana") return addDaysToDateString(anchor, 7 * dir);
  const [y, m] = anchor.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + dir, 1));
  return d.toISOString().slice(0, 10);
}

function EventItem({ e, tz }: { e: CalendarEventRow; tz: string }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-border bg-bg-elevated px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{e.title}</p>
        <p className="text-xs text-muted">
          {e.all_day ? "Dia inteiro" : `${formatTime(e.starts_at, tz)}–${formatTime(e.ends_at, tz)}`}
          {e.location ? <span className="ml-2 inline-flex items-center gap-1"><MapPin className="size-3" />{e.location}</span> : null}
        </p>
        <div className="mt-1 flex gap-1">
          {e.external_provider === "google" ? <Badge tone={e.sync_status === "error" ? "danger" : "neutral"}>Google{e.sync_status === "error" ? " · erro de sync" : ""}</Badge> : null}
          {e.visibility === "workspace" ? <Badge>Compartilhado</Badge> : null}
        </div>
      </div>
      <form action={cancelEventAction}>
        <input type="hidden" name="id" value={e.id} />
        <button className="text-xs text-subtle hover:text-danger">Cancelar</button>
      </form>
    </li>
  );
}

async function Calendar({ searchParams }: { searchParams: PageProps<"/app/agenda">["searchParams"] }) {
  const sp = await searchParams;
  const s = await requireSession();
  const ctx = actorContext(s);
  const today = localDateString(ctx.now, ctx.timezone);
  const view: View = sp.v === "dia" || sp.v === "mes" ? sp.v : "semana";
  const anchor = typeof sp.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : today;
  const { from, to, days } = rangeFor(view, anchor);
  const events = await db.asUser(s.userId, (q) => listEvents({ q, ctx }, zonedToUtc(from, "00:00", ctx.timezone), zonedToUtc(to, "00:00", ctx.timezone)));
  const byDay = new Map<string, CalendarEventRow[]>();
  for (const e of events) {
    const key = localDateString(new Date(e.starts_at), ctx.timezone);
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }
  const label = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", ...(view === "mes" ? { month: "long", year: "numeric" } : { day: "numeric", month: "short" }) }).format(new Date(`${from}T12:00:00Z`));

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <div className="flex items-center gap-1">
            <Link href={`?v=${view}&d=${shift(view, anchor, -1)}`} className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="Anterior"><ChevronLeft /></Link>
            <Link href={`?v=${view}&d=${today}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Hoje</Link>
            <Link href={`?v=${view}&d=${shift(view, anchor, 1)}`} className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="Próximo"><ChevronRight /></Link>
            <span className="ml-2 text-sm font-medium capitalize">{view === "semana" ? `Semana de ${label}` : label}</span>
          </div>
          <div className="flex rounded-lg border border-border p-0.5 text-xs">
            {(["dia", "semana", "mes"] as const).map((v) => (
              <Link key={v} href={`?v=${v}&d=${anchor}`} aria-current={v === view ? "page" : undefined} className={cn("rounded-md px-3 py-1.5", v === view ? "bg-surface-2 text-fg" : "text-muted")}>
                {v === "dia" ? "Dia" : v === "semana" ? "Semana" : "Mês"}
              </Link>
            ))}
          </div>
        </div>
        <CardBody>
          {view === "mes" ? (
            <div className="grid grid-cols-7 gap-1 text-xs">
              {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => <div key={d} className="pb-1 text-center text-subtle">{d}</div>)}
              {Array.from({ length: new Date(`${from}T12:00:00Z`).getUTCDay() }).map((_, i) => <div key={`p${i}`} />)}
              {days.map((d) => (
                <Link key={d} href={`?v=dia&d=${d}`} className={cn("min-h-16 rounded-md border p-1.5", d === today ? "border-gold/60" : "border-border", "hover:bg-surface-2")}>
                  <span className={cn("text-[11px]", d === today ? "font-semibold text-gold" : "text-muted")}>{Number(d.slice(8))}</span>
                  {(byDay.get(d) ?? []).slice(0, 2).map((e) => <p key={e.id} className="mt-0.5 truncate text-[10px] text-fg">{formatTime(e.starts_at, ctx.timezone)} {e.title}</p>)}
                  {(byDay.get(d)?.length ?? 0) > 2 ? <p className="text-[10px] text-subtle">+{byDay.get(d)!.length - 2}</p> : null}
                </Link>
              ))}
            </div>
          ) : (
            <div className="space-y-5">
              {days.map((d) => {
                const list = byDay.get(d) ?? [];
                const wd = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
                return (
                  <section key={d} aria-label={wd}>
                    <h3 className={cn("mb-2 text-xs font-medium capitalize", d === today ? "text-gold" : "text-subtle")}>{wd}{d === today ? " · hoje" : ""}</h3>
                    {list.length ? <ul className="space-y-2">{list.map((e) => <EventItem key={e.id} e={e} tz={ctx.timezone} />)}</ul> : <p className="text-xs text-subtle">Livre</p>}
                  </section>
                );
              })}
            </div>
          )}
          {view !== "mes" && events.length === 0 ? (
            <EmptyState icon={<CalendarClock />} title="Sem compromissos no período" description="Crie ao lado ou peça: “marca reunião amanhã às 10”." />
          ) : null}
        </CardBody>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Novo compromisso" description={`Fuso: ${ctx.timezone}`} />
        <CardBody>
          <ActionForm action={createEventAction} submitLabel="Criar compromisso">
            <Field label="Título" htmlFor="title"><Input id="title" name="title" required maxLength={200} /></Field>
            <Field label="Data" htmlFor="date"><Input id="date" name="date" type="date" defaultValue={anchor} required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Início" htmlFor="start"><Input id="start" name="start" type="time" defaultValue={`${String(Math.min(localParts(ctx.now, ctx.timezone).hour + 1, 22)).padStart(2, "0")}:00`} required /></Field>
              <Field label="Fim" htmlFor="end"><Input id="end" name="end" type="time" defaultValue={`${String(Math.min(localParts(ctx.now, ctx.timezone).hour + 2, 23)).padStart(2, "0")}:00`} required /></Field>
            </div>
            <Field label="Local" htmlFor="location"><Input id="location" name="location" maxLength={200} /></Field>
            <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="allowConflict" className="accent-[var(--gold)]" /> Manter mesmo com conflito</label>
            {s.workspace.kind !== "personal" ? (
              <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="visibility" value="workspace" className="accent-[var(--gold)]" /> Compartilhar com o workspace</label>
            ) : null}
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}

export default function AgendaPage(props: PageProps<"/app/agenda">) {
  return (
    <>
      <PageHeader title="Agenda" description="Compromissos locais e sincronizados. Conflitos nunca são ignorados silenciosamente." />
      <Suspense fallback={<Skeleton className="h-96" />}><Calendar searchParams={props.searchParams} /></Suspense>
    </>
  );
}
