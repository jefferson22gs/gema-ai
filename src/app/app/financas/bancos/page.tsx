import type { Metadata } from "next";
import { Suspense } from "react";
import { Landmark, ShieldCheck } from "lucide-react";
import { BankConnectButton } from "@/components/app/bank-connect";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { isConfigured } from "@/lib/env";
import { formatCents } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { requireSession } from "@/server/session";
import { revokeAction, syncNowAction } from "./actions";

export const metadata: Metadata = { title: "Bancos conectados" };

const STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "gold" }> = {
  connecting: { label: "Conectando", tone: "gold" },
  syncing: { label: "Sincronizando", tone: "gold" },
  updated: { label: "Atualizado", tone: "success" },
  outdated: { label: "Desatualizado", tone: "warning" },
  error: { label: "Erro", tone: "danger" },
  consent_expired: { label: "Consentimento expirado", tone: "danger" },
  revoked: { label: "Revogado", tone: "neutral" },
  waiting_user: { label: "Aguardando você", tone: "warning" },
  unavailable: { label: "Indisponível", tone: "danger" },
};

interface Conn {
  id: string;
  institution_name: string;
  institution_logo_url: string | null;
  is_open_finance: boolean;
  is_sandbox: boolean;
  status: string;
  consent_expires_at: Date | null;
  last_synced_at: Date | null;
  last_sync_error: string | null;
  revoked_at: Date | null;
  created_at: Date;
  external_item_id: string;
}

interface Acc {
  id: string;
  connection_id: string;
  kind: "bank" | "credit";
  name: string;
  number_masked: string | null;
  balance_cents: number | null;
  balance_at: Date | null;
  credit_limit_cents: number | null;
  credit_available_cents: number | null;
}

async function Banks() {
  const s = await requireSession();
  const tz = s.profile.timezone;
  const { conns, accs, logs } = await db.asUser(s.userId, async (q) => ({
    conns: await q.query<Conn>(
      `select id, institution_name, institution_logo_url, is_open_finance, is_sandbox, status, consent_expires_at, last_synced_at, last_sync_error,
         revoked_at, created_at, external_item_id
       from bank_connections where workspace_id = $1 order by revoked_at nulls first, created_at desc`,
      [s.workspace.id],
    ),
    accs: await q.query<Acc>(
      `select id, connection_id, kind, name, number_masked, balance_cents, balance_at, credit_limit_cents, credit_available_cents
       from bank_accounts where workspace_id = $1 order by kind, name`,
      [s.workspace.id],
    ),
    logs: await q.query<{ connection_id: string; trigger: string; status: string; transactions_created: number; error: string | null; started_at: Date }>(
      "select connection_id, trigger, status, transactions_created, error, started_at from bank_sync_logs where workspace_id = $1 order by started_at desc limit 30",
      [s.workspace.id],
    ),
  }));
  const active = conns.filter((c) => !c.revoked_at);
  const bankAccs = accs.filter((a) => a.kind === "bank" && active.some((c) => c.id === a.connection_id) && a.balance_cents !== null);
  const consolidated = bankAccs.reduce((sum, a) => sum + (a.balance_cents ?? 0), 0);
  const oldest = bankAccs.reduce<Date | null>((min, a) => (a.balance_at && (!min || new Date(a.balance_at) < min) ? new Date(a.balance_at) : min), null);
  const configured = isConfigured("pluggy");

  return (
    <div className="space-y-6">
      {!configured ? (
        <Alert tone="warning" title="Open Finance: Não configurado">Defina PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET e PLUGGY_WEBHOOK_SECRET no servidor. Sem contrato de produção, apenas o banco de testes (sandbox) fica disponível.</Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title="Saldo consolidado das contas conectadas"
            description={oldest ? `Saldos informados pelos bancos; o mais antigo é de ${formatDateTime(oldest, tz)}. Não é saldo em tempo real.` : "Conecte um banco para ver os saldos."}
          />
          <CardBody>
            <p className="text-3xl font-semibold tabular-nums">{bankAccs.length ? formatCents(consolidated) : "—"}</p>
            {accs.length ? (
              <ul className="mt-4 divide-y divide-border text-sm">
                {accs.filter((a) => active.some((c) => c.id === a.connection_id)).map((a) => (
                  <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2.5">
                    <span>{a.name} {a.number_masked ? <span className="text-muted">{a.number_masked}</span> : null} <Badge>{a.kind === "credit" ? "cartão" : "conta"}</Badge></span>
                    <span className="text-right tabular-nums">
                      {a.kind === "credit"
                        ? <>Fatura {a.balance_cents !== null ? formatCents(a.balance_cents) : "—"}{a.credit_available_cents !== null ? <span className="block text-[11px] text-muted">disponível {formatCents(a.credit_available_cents)}</span> : null}</>
                        : a.balance_cents !== null ? formatCents(a.balance_cents) : "indisponível"}
                      {a.balance_at ? <span className="block text-[11px] text-subtle">em {formatDateTime(a.balance_at, tz)}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Adicionar instituição" description="Conexão pelo ambiente oficial do provedor (Pluggy). Somente leitura." />
          <CardBody className="space-y-3">
            {configured ? <BankConnectButton /> : <Button disabled>Conectar banco</Button>}
            <ul className="space-y-1 text-xs text-muted">
              <li className="flex gap-2"><ShieldCheck className="size-4 shrink-0 text-success" />Você autoriza no banco; o GEMA nunca recebe sua senha.</li>
              <li className="flex gap-2"><ShieldCheck className="size-4 shrink-0 text-success" />Acesso somente leitura: o GEMA não faz pagamentos nem transferências.</li>
              <li className="flex gap-2"><ShieldCheck className="size-4 shrink-0 text-success" />Revogue a qualquer momento abaixo.</li>
            </ul>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Conexões e consentimentos" description="Finalidade: organização financeira pessoal (contas, saldos, transações e cartões), somente leitura." />
        <CardBody>
          {conns.length ? (
            <ul className="space-y-4">
              {conns.map((c) => {
                const st = STATUS[c.status] ?? { label: c.status, tone: "neutral" as const };
                const connLogs = logs.filter((l) => l.connection_id === c.id).slice(0, 3);
                return (
                  <li key={c.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {c.institution_logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- logo autorizado servido pelo provedor
                          <img src={c.institution_logo_url} alt="" className="size-9 rounded-md bg-white object-contain p-1" />
                        ) : <Landmark className="size-9 text-gold" />}
                        <div>
                          <p className="font-medium">{c.institution_name}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge tone={st.tone}>{st.label}</Badge>
                            {c.is_open_finance ? <Badge>Open Finance</Badge> : null}
                            {c.is_sandbox ? <Badge tone="warning">Sandbox (dados de teste)</Badge> : null}
                          </div>
                        </div>
                      </div>
                      {!c.revoked_at ? (
                        <div className="flex flex-wrap gap-2">
                          {c.status === "consent_expired" || c.status === "error" || c.status === "waiting_user" ? (
                            configured ? <BankConnectButton itemId={c.external_item_id} label="Reconectar" /> : null
                          ) : (
                            <form action={syncNowAction}><input type="hidden" name="id" value={c.id} /><Button size="sm" variant="secondary">Sincronizar</Button></form>
                          )}
                          <form action={revokeAction}><input type="hidden" name="id" value={c.id} /><Button size="sm" variant="danger">Revogar acesso</Button></form>
                        </div>
                      ) : null}
                    </div>
                    <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-3">
                      <div><dt className="inline">Autorizado em: </dt><dd className="inline">{formatDateTime(c.created_at, tz)}</dd></div>
                      <div><dt className="inline">Validade: </dt><dd className="inline">{c.consent_expires_at ? formatDateTime(c.consent_expires_at, tz) : "sem prazo definido pela instituição"}</dd></div>
                      <div><dt className="inline">Última sincronização: </dt><dd className="inline">{c.last_synced_at ? formatDateTime(c.last_synced_at, tz) : "ainda não"}</dd></div>
                      {c.revoked_at ? <div><dt className="inline">Revogado em: </dt><dd className="inline">{formatDateTime(c.revoked_at, tz)}</dd></div> : null}
                      <div className="sm:col-span-3"><dt className="inline">Dados compartilhados: </dt><dd className="inline">contas, saldos, transações, cartões e faturas (leitura)</dd></div>
                    </dl>
                    {c.last_sync_error ? <p className="mt-2 text-xs text-danger">Diagnóstico: {c.last_sync_error}</p> : null}
                    {connLogs.length ? (
                      <details className="mt-2 text-xs text-muted">
                        <summary className="cursor-pointer">Histórico de sincronização</summary>
                        <ul className="mt-1 space-y-0.5">
                          {connLogs.map((l, i) => <li key={i}>{formatDateTime(l.started_at, tz)} · {l.trigger} · {l.status}{l.transactions_created ? ` · ${l.transactions_created} novas` : ""}{l.error ? ` · ${l.error}` : ""}</li>)}
                        </ul>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState icon={<Landmark />} title="Nenhum banco conectado" description="Conectar um banco é opcional — você pode lançar tudo manualmente ou pelo assistente." />}
        </CardBody>
      </Card>
    </div>
  );
}

export default function BancosPage() {
  return (
    <>
      <PageHeader title="Bancos conectados" description="Open Finance somente leitura, com consentimento revogável." />
      <Suspense fallback={<Skeleton className="h-96" />}><Banks /></Suspense>
    </>
  );
}
