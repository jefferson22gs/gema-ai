import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, CardBody, CardHeader, PageHeader, Skeleton, Badge, buttonVariants } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatLongDate, formatTime } from "@/lib/time";
import { buildBriefing } from "@/server/services/briefing";
import { actorContext, requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Briefings" };

async function Briefing() {
  const s = await requireSession();
  const ctx = actorContext(s);
  const b = await db.asUser(s.userId, (q) => buildBriefing({ q, ctx }));
  const recent = await db.asUser(s.userId, (q) =>
    q.query<{ id: string; title: string; created_at: Date }>(
      "select id, title, created_at from notification_outbox where user_id = $1 and kind = 'briefing' order by created_at desc limit 10",
      [s.userId],
    ),
  );
  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader title={`Briefing 360° · ${formatLongDate(ctx.now, ctx.timezone)}`} description={`Gerado às ${formatTime(ctx.now, ctx.timezone)} a partir dos seus registros neste workspace.`} />
          <CardBody className="space-y-5 text-sm">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">Fatos confirmados</h3>
              {b.facts.length ? (
                <ul className="space-y-1.5">{b.facts.map((f) => <li key={f.text} className="flex gap-2"><Badge>{f.source}</Badge>{f.text}</li>)}</ul>
              ) : <p className="text-muted">Nenhum fato registrado para hoje.</p>}
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">Agenda</h3>
              {b.events.length ? <ul className="space-y-1">{b.events.map((e) => <li key={e.id}>{formatTime(e.starts_at, ctx.timezone)} · {e.title}</li>)}</ul> : <p className="text-muted">Sem compromissos.</p>}
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">Finanças do mês</h3>
              <p>Receitas {formatCents(b.month.incomeCents)} · Despesas {formatCents(b.month.expenseCents)} · Saldo {formatCents(b.month.balanceCents)}</p>
              {b.bills.length ? <ul className="mt-2 space-y-1">{b.bills.map((x) => <li key={x.id}>{x.due_on} · {x.description} · {formatCents(x.amount_cents)}</li>)}</ul> : null}
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">Sugestões (geradas por regras, não são fatos)</h3>
              {b.recommendations.length ? <ul className="space-y-1 text-muted">{b.recommendations.map((r) => <li key={r}>{r}</li>)}</ul> : <p className="text-muted">Nenhuma sugestão.</p>}
            </section>
            {b.gaps.length ? (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">Sem dados</h3>
                <ul className="space-y-1 text-subtle">{b.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
              </section>
            ) : null}
          </CardBody>
        </Card>
      </div>
      <Card className="h-fit">
        <CardHeader title="Briefings agendados" description="Configure o briefing diário em Automações." action={<Link href="/app/automacoes" className={buttonVariants({ variant: "secondary", size: "sm" })}>Configurar</Link>} />
        <CardBody>
          {recent.length ? <ul className="space-y-2 text-sm">{recent.map((r) => <li key={r.id} className="text-muted">{r.title}</li>)}</ul> : <p className="text-sm text-muted">Nenhum briefing enviado ainda.</p>}
        </CardBody>
      </Card>
    </div>
  );
}

export default function BriefingsPage() {
  return (
    <>
      <PageHeader title="Briefings" />
      <Suspense fallback={<Skeleton className="h-96" />}><Briefing /></Suspense>
    </>
  );
}
