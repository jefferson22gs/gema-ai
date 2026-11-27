import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ExternalLink } from "lucide-react";
import { BookingPageForm } from "@/components/booking/booking-page-form";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/time";
import { listBookingPages, listUpcomingBookings } from "@/server/services/booking";
import { actorContext, requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Agenda pública" };

async function Content() {
  const s = await requireSession();
  const ctx = actorContext(s);
  const { pages, bookings } = await db.asUser(s.userId, async (q) => ({
    pages: await listBookingPages({ q, ctx }),
    bookings: await listUpcomingBookings({ q, ctx }),
  }));
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        {pages.map((p) => (
          <Card key={p.id}>
            <CardHeader
              title={p.title}
              description={`${env.appUrl()}/agendar/${p.slug}`}
              action={
                <span className="flex items-center gap-2">
                  <Badge tone={p.active ? "success" : "neutral"}>{p.active ? "ativa" : "pausada"}</Badge>
                  {p.active ? <Link href={`/agendar/${p.slug}`} target="_blank" className="text-gold" aria-label="Abrir página pública"><ExternalLink className="size-4" /></Link> : null}
                </span>
              }
            />
            <CardBody><BookingPageForm page={p} timezone={ctx.timezone} /></CardBody>
          </Card>
        ))}
        {pages.length < 3 ? (
          <Card>
            <CardHeader title={pages.length ? "Nova página" : "Crie sua página de agendamento"} description="Compartilhe o link: a pessoa escolhe um horário livre e o compromisso entra na sua agenda." />
            <CardBody><BookingPageForm timezone={ctx.timezone} /></CardBody>
          </Card>
        ) : null}
      </div>
      <Card>
        <CardHeader title="Próximos agendamentos" />
        <CardBody>
          {bookings.length ? (
            <ul className="divide-y divide-border text-sm">
              {bookings.map((b) => (
                <li key={b.id} className={`py-2.5 ${b.status === "cancelled" ? "text-subtle line-through" : ""}`}>
                  <p className="font-medium">{b.guest_name} <span className="font-normal text-muted">· {b.page_title}</span></p>
                  <p className="text-xs text-muted">{formatDateTime(b.starts_at, ctx.timezone)} · {b.guest_email}</p>
                  {b.guest_note ? <p className="mt-1 text-xs text-subtle">{b.guest_note}</p> : null}
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Nenhum agendamento" description="As reservas aparecem aqui e na sua agenda." />}
        </CardBody>
      </Card>
    </div>
  );
}

export default function AgendaPublicaPage() {
  return (
    <>
      <PageHeader title="Agenda pública" description="Link para outras pessoas reservarem horários livres, sem ver os detalhes da sua agenda." />
      <Suspense fallback={<Skeleton className="h-96" />}><Content /></Suspense>
    </>
  );
}
