import type { Metadata } from "next";
import { Suspense } from "react";
import { Bell } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { requireSession } from "@/server/session";
import { markNotificationsReadAction } from "../actions";

export const metadata: Metadata = { title: "Notificações" };

async function Notifications() {
  const s = await requireSession();
  const rows = await db.asUser(s.userId, (q) =>
    q.query<{ id: string; title: string; body: string; kind: string; status: string; read_at: Date | null; created_at: Date }>(
      "select id, title, body, kind, status, read_at, created_at from notification_outbox where user_id = $1 order by created_at desc limit 100",
      [s.userId],
    ),
  );
  return (
    <>
      {rows.some((r) => !r.read_at) ? (
        <form action={markNotificationsReadAction} className="mb-4"><Button variant="secondary" size="sm">Marcar todas como lidas</Button></form>
      ) : null}
      <Card>
        {rows.length ? (
          <ul className="divide-y divide-border">
            {rows.map((n) => (
              <li key={n.id} className="flex gap-3 px-5 py-4">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-gold"}`} aria-label={n.read_at ? undefined : "Não lida"} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{n.title}</p>
                    <span className="text-xs text-subtle">{formatDateTime(n.created_at, s.profile.timezone)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm text-muted">{n.body}</p>
                  {n.status === "failed" || n.status === "dead" ? <Badge tone="danger" className="mt-2">Falha de entrega em canal externo</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Bell />} title="Nenhuma notificação" description="Lembretes, briefings e alertas aparecem aqui." />
        )}
      </Card>
    </>
  );
}

export default function NotificacoesPage() {
  return (
    <>
      <PageHeader title="Notificações" />
      <Suspense fallback={<Skeleton className="h-72" />}><Notifications /></Suspense>
    </>
  );
}
