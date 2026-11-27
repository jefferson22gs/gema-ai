import type { Metadata } from "next";
import { Suspense } from "react";
import { CancelBookingForm } from "@/components/booking/cancel-booking-form";
import { Skeleton } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Cancelar agendamento", robots: { index: false, follow: false } };

async function Content({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <CancelBookingForm token={typeof token === "string" ? token : ""} />;
}

export default function CancelarPage(props: PageProps<"/agendar/cancelar">) {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Cancelar agendamento</h1>
      <p className="mt-2 text-sm text-muted">Ao confirmar, o horário é liberado e quem você agendou é avisado.</p>
      <div className="mt-6"><Suspense fallback={<Skeleton className="h-24" />}><Content searchParams={props.searchParams as Promise<{ token?: string }>} /></Suspense></div>
    </main>
  );
}
