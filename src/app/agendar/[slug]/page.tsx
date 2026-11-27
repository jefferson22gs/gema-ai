import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Clock } from "lucide-react";
import { BookingPicker } from "@/components/booking/booking-picker";
import { Alert, Skeleton } from "@/components/ui/primitives";
import { db, isDatabaseConfigured } from "@/lib/db";
import { publicAvailability } from "@/server/services/booking";

export const metadata: Metadata = { title: "Agendar horário", robots: { index: false, follow: false } };

async function Content({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) notFound();
  if (!isDatabaseConfigured()) return <Alert tone="warning" title="Agendamento indisponível">Este serviço ainda não foi configurado.</Alert>;
  const av = await db.asAnon((q) => publicAvailability(q, slug, new Date()));
  if (!av) notFound();
  const { page, days } = av;
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Agendamento{page.hostName ? ` com ${page.hostName}` : ""}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{page.title}</h1>
      <p className="mt-2 flex items-center gap-2 text-sm text-muted"><Clock className="size-4" aria-hidden />{page.rules.durationMinutes} minutos</p>
      {page.description ? <p className="mt-3 max-w-2xl whitespace-pre-line text-muted">{page.description}</p> : null}
      <div className="mt-8 rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <BookingPicker slug={slug} timezone={page.rules.timezone} days={days.map((d) => ({ date: d.date, slots: d.slots.map((s) => s.toISOString()) }))} />
      </div>
    </>
  );
}

export default function AgendarPage(props: PageProps<"/agendar/[slug]">) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Suspense fallback={<Skeleton className="h-96" />}><Content params={props.params} /></Suspense>
      <p className="mt-10 text-center text-xs text-subtle">Agenda gerenciada com GEMA AI. Apenas horários livres são exibidos.</p>
    </main>
  );
}
