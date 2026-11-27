import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/app/action-form";
import { Alert, Card, CardBody, CardHeader, Field, Input, PageHeader, Skeleton, StatusPill, buttonVariants } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { isConfigured } from "@/lib/env";
import { formatDateTime } from "@/lib/time";
import { maskPii } from "@/lib/utils";
import { primaryWhatsApp } from "@/server/runtime";
import { requireSession } from "@/server/session";
import { confirmWhatsAppVerification, disconnectGoogle, revokeWhatsApp, startWhatsAppVerification, syncGoogleNow, updateWhatsAppPrivacy } from "./actions";
import { WhatsAppLinkCode } from "@/components/app/whatsapp-link";

export const metadata: Metadata = { title: "Integrações" };

type Status = "connected" | "pending" | "error" | "not_configured" | "revoked";

async function Integrations({ searchParams }: { searchParams: PageProps<"/app/integracoes">["searchParams"] }) {
  const sp = await searchParams;
  const s = await requireSession();
  const { integrations, channels, sync } = await db.asUser(s.userId, async (q) => ({
    integrations: await q.query<{ provider: string; status: Status; last_error: string | null; connected_at: Date | null }>(
      "select provider, status, last_error, connected_at from integrations where workspace_id = $1 and user_id = $2",
      [s.workspace.id, s.userId],
    ),
    channels: await q.query<{ id: string; provider: string; address: string; status: string; verified_at: Date | null; show_balances: boolean; show_transactions: boolean; show_documents: boolean }>(
      "select id, provider, address, status, verified_at, show_balances, show_transactions, show_documents from channel_accounts where user_id = $1 and status <> 'revoked' order by created_at desc",
      [s.userId],
    ),
    sync: await q.query<{ last_synced_at: Date | null; last_error: string | null }>(
      "select last_synced_at, last_error from calendar_sync_state where workspace_id = $1 and user_id = $2 and provider = 'google'",
      [s.workspace.id, s.userId],
    ),
  }));
  const googleReady = isConfigured("google");
  const wa = primaryWhatsApp();
  const statusOf = (provider: string): Status => (googleReady ? integrations.find((i) => i.provider === provider)?.status ?? "revoked" : "not_configured");
  const verified = channels.find((c) => c.status === "verified");
  const pendingCode = channels.find((c) => c.status === "pending_verification");

  return (
    <div className="space-y-6">
      {typeof sp.erro === "string" ? <Alert tone="danger" title="Integração não concluída">{sp.erro}</Alert> : null}
      {sp.google === "conectado" ? <Alert tone="success">Google conectado com sucesso.</Alert> : null}

      <div className="grid gap-4 md:grid-cols-2">
        {([
          ["google_calendar", "calendar", "Google Agenda", "Criar eventos (com confirmação) e importar compromissos do calendário principal."],
          ["google_contacts", "contacts", "Google Contatos", "Gravar contatos no Google após sua confirmação. Escopo apenas de contatos."],
        ] as const).map(([provider, product, title, desc]) => {
          const st = statusOf(provider);
          const row = integrations.find((i) => i.provider === provider);
          return (
            <Card key={provider}>
              <CardHeader title={title} description={desc} action={<StatusPill status={st} />} />
              <CardBody className="space-y-3">
                {!googleReady ? <p className="text-xs text-subtle">Requer GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI e OAUTH_ENCRYPTION_KEY.</p> : null}
                {row?.last_error ? <Alert tone="danger">{row.last_error}</Alert> : null}
                {row?.connected_at && st === "connected" ? <p className="text-xs text-muted">Conectado em {formatDateTime(row.connected_at, s.profile.timezone)}</p> : null}
                {product === "calendar" && st === "connected" ? (
                  <p className="text-xs text-muted">Última sincronização: {sync[0]?.last_synced_at ? formatDateTime(sync[0].last_synced_at, s.profile.timezone) : "nunca"}{sync[0]?.last_error ? ` · erro: ${sync[0].last_error}` : ""}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {googleReady && st !== "connected" ? (
                    <Link href={`/api/oauth/google/start?product=${product}`} prefetch={false} className={buttonVariants({ size: "sm" })}>Conectar</Link>
                  ) : null}
                  {st === "connected" && product === "calendar" ? (
                    <form action={syncGoogleNow}><button className={buttonVariants({ variant: "secondary", size: "sm" })}>Sincronizar agora</button></form>
                  ) : null}
                  {st === "connected" ? (
                    <form action={disconnectGoogle}><input type="hidden" name="product" value={product} /><button className={buttonVariants({ variant: "danger", size: "sm" })}>Desconectar e remover tokens</button></form>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          );
        })}

        <Card>
          <CardHeader title="WhatsApp" description="Converse com a GEMA após comprovar a posse do número." action={<StatusPill status={!wa ? "not_configured" : verified ? "connected" : pendingCode ? "pending" : "revoked"} />} />
          <CardBody className="space-y-3">
            {!wa ? (
              <p className="text-xs text-subtle">O operador precisa configurar a Cloud API oficial da Meta ou um host Evolution API persistente (ver docs/EVOLUTION_DOCKER.md).</p>
            ) : verified ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span>{maskPii(verified.address)} · verificado</span>
                  <form action={revokeWhatsApp}><input type="hidden" name="id" value={verified.id} /><button className="text-xs text-danger hover:underline">Desvincular</button></form>
                </div>
                <form action={updateWhatsAppPrivacy} className="space-y-1.5 rounded-lg border border-border p-3 text-xs text-muted">
                  <input type="hidden" name="id" value={verified.id} />
                  <p className="font-medium text-fg">O que o assistente pode mostrar no WhatsApp</p>
                  <label className="flex items-center gap-2"><input type="checkbox" name="show_balances" defaultChecked={verified.show_balances} className="accent-[var(--gold)]" />Saldos, limites e projeções</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="show_transactions" defaultChecked={verified.show_transactions} className="accent-[var(--gold)]" />Lançamentos</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="show_documents" defaultChecked={verified.show_documents} className="accent-[var(--gold)]" />Documentos</label>
                  <button className="mt-1 rounded-md border border-border px-2 py-1 text-fg hover:bg-surface-2">Salvar privacidade</button>
                </form>
                <WhatsAppLinkCode />
                <p className="text-[11px] text-subtle">Para trocar de número, gere um código e envie do número novo: o anterior é desvinculado.</p>
              </div>
            ) : (
              <>
                <WhatsAppLinkCode />
                <details className="text-xs text-muted">
                  <summary className="cursor-pointer">Prefiro receber um código no meu número</summary>
                  <div className="mt-3 space-y-3">
                    <ActionForm action={startWhatsAppVerification} submitLabel="Enviar código" resetOnSuccess={false}>
                      <Field label="Seu número com DDD" htmlFor="phone"><Input id="phone" name="phone" type="tel" placeholder="+55 11 91234-5678" required /></Field>
                    </ActionForm>
                    {pendingCode ? (
                      <ActionForm action={confirmWhatsAppVerification} submitLabel="Verificar">
                        <Field label="Código recebido" htmlFor="code"><Input id="code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required /></Field>
                      </ActionForm>
                    ) : null}
                  </div>
                </details>
              </>
            )}
            <p className="text-[11px] text-subtle">Ao verificar, você consente receber mensagens da GEMA neste número. Envie “parar” ou desvincule a qualquer momento.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="AgendaFácil365" description="Integração de agendamentos para negócios." action={<StatusPill status="not_configured" />} />
          <CardBody>
            <p className="text-sm text-muted">Aguardando API oficial do AgendaFácil365. Nenhuma ação externa é executada até a integração ser publicada e autorizada.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Open Finance" description="Conector futuro com parceiro autorizado." action={<StatusPill status="not_configured" />} />
          <CardBody><p className="text-sm text-muted">Não armazenamos senhas bancárias nem fazemos scraping. Disponível apenas com parceiro regulado e consentimento.</p></CardBody>
        </Card>
        <Card>
          <CardHeader title="ComandaZero · Frota Easy · Portaria Prime" description="Produtos de negócios do ecossistema." action={<StatusPill status="not_configured" />} />
          <CardBody><p className="text-sm text-muted">Dependem de APIs seguras com escopo por empresa ainda não disponibilizadas.</p></CardBody>
        </Card>
      </div>
    </div>
  );
}

export default function IntegracoesPage(props: PageProps<"/app/integracoes">) {
  return (
    <>
      <PageHeader title="Integrações" description="Status real de cada conexão. Você pode revogar acessos a qualquer momento." />
      <Suspense fallback={<Skeleton className="h-96" />}><Integrations searchParams={props.searchParams} /></Suspense>
    </>
  );
}
