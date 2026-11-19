import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AlertTriangle, CalendarClock, CheckSquare, Lightbulb, Receipt, Wallet } from "lucide-react";
import { MiniCalendar } from "@/components/app/mini-calendar";
import { QuickAsk } from "@/components/app/quick-ask";
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton, buttonVariants } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatLongDate, formatTime, localDateString, monthRange } from "@/lib/time";
import { buildBriefing } from "@/server/services/briefing";
import { listEvents } from "@/server/services/calendar";
import { actorContext, requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Início" };

function Kpi({ icon: Icon, label, value, hint, href }: { icon: typeof Wallet; label: string; value: string; hint?: string; href: string }) {
  return (
    <Link href={href} className="group rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-card transition-colors hover:border-gold/40">
      <div className="flex items-center justify-between text-muted">
        <span className="text-xs font-medium">{label}</span>
        <Icon className="size-4 text-gold" aria-hidden />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-subtle">{hint}</p> : null}
    </Link>
  );
}

async function Dashboard() {
  const s = await requireSession();
  if (!s.profile.onboarding_completed_at) redirect("/app/onboarding");
  const ctx = actorContext(s);
  const { start, end } = monthRange(ctx.now, ctx.timezone);
  const { briefing, monthEvents } = await db.asUser(s.userId, async (q) => ({
    briefing: await buildBriefing({ q, ctx }),
    monthEvents: await listEvents({ q, ctx }, new Date(`${start}T00:00:00Z`), new Date(`${end}T12:00:00Z`)),
  }));
  const eventDates = new Set(monthEvents.map((e) => localDateString(new Date(e.starts_at), ctx.timezone)));
  const firstName = s.profile.full_name?.split(" ")[0];
  const nextActions = [
    ...briefing.overdueTasks.map((t) => ({ id: t.id, label: t.title, tag: "Atrasada", tone: "danger" as const, href: "/app/tarefas" })),
    ...briefing.events.filter((e) => new Date(e.ends_at) > ctx.now).map((e) => ({ id: e.id, label: `${formatTime(e.starts_at, ctx.timezone)} · ${e.title}`, tag: "Agenda", tone: "gold" as const, href: "/app/agenda" })),
    ...briefing.todayTasks.map((t) => ({ id: t.id, label: t.title, tag: "Hoje", tone: "warning" as const, href: "/app/tarefas" })),
    ...briefing.bills.map((b) => ({ id: b.id, label: `${b.description} · ${formatCents(b.amount_cents)}`, tag: `Vence ${b.due_on?.slice(8)}/${b.due_on?.slice(5, 7)}`, tone: "warning" as const, href: "/app/financas/transacoes" })),
  ].slice(0, 8);

  return (
    <div className="space-y-6">
      <section className="rise">
        <p className="text-sm capitalize text-muted">{formatLongDate(ctx.now, ctx.timezone)}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{firstName ? `Olá, ${firstName}.` : "Olá."} Aqui está o seu dia.</h1>
        <div className="mt-5 max-w-3xl"><QuickAsk /></div>
      </section>

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={CalendarClock} label="Compromissos hoje" value={String(briefing.kpis.eventsToday)} href="/app/agenda" />
        <Kpi icon={CheckSquare} label="Pendências" value={String(briefing.kpis.openTasks)} hint={briefing.overdueTasks.length ? `${briefing.overdueTasks.length} atrasada(s)` : undefined} href="/app/tarefas" />
        <Kpi icon={Wallet} label="Gasto do mês" value={formatCents(briefing.kpis.monthExpenseCents)} hint={briefing.month.transactionCount ? undefined : "Sem lançamentos"} href="/app/financas" />
        <Kpi icon={Receipt} label="Contas a vencer (7d)" value={String(briefing.kpis.billsDueCount)} href="/app/financas/transacoes" />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Briefing do dia" description="Fatos dos seus registros; sugestões aparecem separadas." action={<Link href="/app/briefings" className="text-xs text-gold hover:underline">Detalhes</Link>} />
          <CardBody className="space-y-4">
            {briefing.facts.length ? (
              <ul className="space-y-2">
                {briefing.facts.map((f) => (
                  <li key={f.text} className="flex items-start gap-2 text-sm">
                    <Badge tone="neutral" className="mt-0.5 shrink-0">{f.source}</Badge>
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Ainda não há registros para hoje.</p>
            )}
            {briefing.gaps.length ? (
              <p className="text-xs text-subtle">Sem dados: {briefing.gaps.join(" ")}</p>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardBody><MiniCalendar now={ctx.now} timezone={ctx.timezone} eventDates={eventDates} /></CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Próximas ações" />
          {nextActions.length ? (
            <ul className="divide-y divide-border px-5 pb-3">
              {nextActions.map((a) => (
                <li key={`${a.tag}-${a.id}`}>
                  <Link href={a.href} className="flex items-center justify-between gap-3 py-3 text-sm hover:text-gold">
                    <span className="truncate">{a.label}</span>
                    <Badge tone={a.tone}>{a.tag}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<CheckSquare />} title="Nada pendente por agora" description="Crie tarefas, compromissos ou peça ao assistente." action={<Link href="/app/tarefas" className={buttonVariants({ variant: "secondary", size: "sm" })}>Nova tarefa</Link>} />
          )}
        </Card>
        <Card>
          <CardHeader title="Insights" description="Sugestões baseadas em regras sobre os seus dados." />
          <CardBody>
            {briefing.recommendations.length ? (
              <ul className="space-y-3">
                {briefing.recommendations.map((r) => (
                  <li key={r} className="flex gap-2 text-sm text-muted">
                    {r.includes("vencimento") ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> : <Lightbulb className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />}
                    {r}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Sem alertas no momento.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-12 w-full max-w-3xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-56" />
    </div>
  );
}

export default function AppHome() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}
