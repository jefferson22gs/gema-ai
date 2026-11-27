import type { Metadata } from "next";
import { Suspense } from "react";
import { Archive, Camera, Gem } from "lucide-react";
import { ActionForm } from "@/components/app/action-form";
import { BalanceLineChart } from "@/components/app/charts";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton, buttonVariants } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { ASSET_KINDS, ASSET_KIND_LABEL, computeNetWorth, listAssets, listSnapshots } from "@/server/services/patrimony";
import { actorContext, requireSession } from "@/server/session";
import { archiveAssetAction, createAssetAction, revalueAssetAction, snapshotAction } from "../actions";

export const metadata: Metadata = { title: "Patrimônio" };

function Group({ title, lines, tone }: { title: string; lines: { group: string; label: string; cents: number; note?: string }[]; tone: "success" | "danger" }) {
  const groups = [...new Set(lines.map((l) => l.group))];
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {lines.length ? (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g}>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">{g}</p>
                <ul className="divide-y divide-border text-sm">
                  {lines.filter((l) => l.group === g).map((l) => (
                    <li key={`${g}:${l.label}`} className="flex justify-between gap-3 py-2">
                      <span>{l.label}{l.note ? <span className="block text-xs text-subtle">{l.note}</span> : null}</span>
                      <span className={`shrink-0 tabular-nums ${tone === "danger" ? "text-danger" : ""}`}>{formatCents(l.cents)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted">Nada registrado.</p>}
      </CardBody>
    </Card>
  );
}

async function Content() {
  const s = await requireSession();
  const ctx = actorContext(s);
  const { nw, assets, snaps } = await db.asUser(s.userId, async (q) => ({
    nw: await computeNetWorth({ q, ctx }),
    assets: await listAssets({ q, ctx }),
    snaps: await listSnapshots({ q, ctx }),
  }));
  const empty = !nw.assets.length && !nw.liabilities.length;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-6">
        {empty ? (
          <EmptyState icon={<Gem />} title="Comece pelo que você tem" description="Cadastre bens ao lado. Contas, dívidas e cartões já registrados entram automaticamente." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([["Patrimônio líquido", nw.netWorthCents], ["Ativos", nw.assetsCents], ["Passivos", nw.liabilitiesCents], ["Liquidez", nw.liquidCents]] as const).map(([k, v], i) => (
                <div key={k} className={`rounded-xl border bg-surface p-4 ${i === 0 ? "border-gold/50" : "border-border"}`}>
                  <p className="text-xs text-subtle">{k}</p>
                  <p className={`mt-1 text-lg font-semibold tabular-nums ${v < 0 ? "text-danger" : ""}`}>{formatCents(v)}</p>
                  {i === 0 && snaps.change ? (
                    <p className="mt-1 text-xs text-muted">{snaps.change.cents >= 0 ? "+" : ""}{formatCents(snaps.change.cents)} desde a fotografia anterior</p>
                  ) : null}
                </div>
              ))}
            </div>
            {nw.warnings.length ? <Alert tone="warning" title="Atenção">{nw.warnings.map((w) => <span key={w} className="block">{w}</span>)}</Alert> : null}
            <Group title="Ativos" lines={nw.assets} tone="success" />
            <Group title="Passivos" lines={nw.liabilities} tone="danger" />
          </>
        )}
        <Card>
          <CardHeader
            title="Evolução"
            description="Fotografias mensais automáticas (dia 1) ou quando você registrar uma."
            action={<form action={snapshotAction}><button className={buttonVariants({ variant: "secondary", size: "sm" })}><Camera /> Registrar hoje</button></form>}
          />
          <CardBody>
            {snaps.series.length >= 2
              ? <BalanceLineChart points={snaps.series.map((p) => ({ date: p.date, balanceCents: p.netWorthCents }))} title="Evolução do patrimônio líquido" />
              : <p className="text-sm text-muted">São necessárias ao menos duas fotografias para mostrar a evolução.</p>}
          </CardBody>
        </Card>
        <ul className="list-disc space-y-1 pl-5 text-xs text-subtle">{nw.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Cadastrar bem" />
          <CardBody>
            <ActionForm action={createAssetAction} submitLabel="Cadastrar">
              <Field label="Nome" htmlFor="as-name"><Input id="as-name" name="name" required maxLength={120} placeholder="Ex.: Apartamento, Tesouro Selic" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tipo" htmlFor="as-kind">
                  <Select id="as-kind" name="kind" defaultValue="investment">{ASSET_KINDS.map((k) => <option key={k} value={k}>{ASSET_KIND_LABEL[k]}</option>)}</Select>
                </Field>
                <Field label="Valor (R$)" htmlFor="as-value"><Input id="as-value" name="value" inputMode="decimal" required /></Field>
              </div>
              <Field label="Data da avaliação" htmlFor="as-date" hint="Vazio = hoje"><Input id="as-date" name="valuedOn" type="date" /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="liquid" className="size-4 accent-[var(--color-gold)]" />Vira dinheiro rápido (liquidez)</label>
              {s.workspace.kind !== "personal" ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="shared" className="size-4 accent-[var(--color-gold)]" />Visível para o workspace</label> : null}
            </ActionForm>
          </CardBody>
        </Card>
        {assets.length ? (
          <Card>
            <CardHeader title="Meus bens" description="Atualize o valor ao reavaliar." />
            <CardBody>
              <ul className="space-y-4 text-sm">
                {assets.map((a) => (
                  <li key={a.id}>
                    <div className="flex items-start justify-between gap-2">
                      <span>{a.name} <Badge>{ASSET_KIND_LABEL[a.kind]}</Badge>{a.visibility === "workspace" ? <Badge tone="gold" className="ml-1">compartilhado</Badge> : null}
                        <span className="block text-xs text-subtle">{formatCents(Number(a.value_cents))} · avaliado em {a.valued_on}</span>
                      </span>
                      {a.owner_id === s.userId ? (
                        <form action={archiveAssetAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <button className="text-subtle hover:text-danger" aria-label={`Remover ${a.name}`}><Archive className="size-4" /></button>
                        </form>
                      ) : null}
                    </div>
                    {a.owner_id === s.userId ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-gold">Atualizar valor</summary>
                        <div className="mt-2">
                          <ActionForm action={revalueAssetAction} submitLabel="Salvar">
                            <input type="hidden" name="id" value={a.id} />
                            <Field label="Novo valor (R$)" htmlFor={`rv-${a.id}`}><Input id={`rv-${a.id}`} name="value" inputMode="decimal" required /></Field>
                          </ActionForm>
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}
        <Alert tone="neutral">Valores informados por você. O GEMA AI não avalia bens nem recomenda investimentos.</Alert>
      </div>
    </div>
  );
}

export default function PatrimonioPage() {
  return (
    <>
      <PageHeader title="Patrimônio" description="O que você tem, o que deve e o patrimônio líquido, sem contar nada duas vezes." />
      <Suspense fallback={<Skeleton className="h-96" />}><Content /></Suspense>
    </>
  );
}
