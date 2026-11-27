import type { Metadata } from "next";
import { Suspense } from "react";
import { Trash2 } from "lucide-react";
import { StatementImportForm } from "@/components/app/statement-import-form";
import { Badge, Card, CardBody, CardHeader, PageHeader, Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { listRules } from "@/server/services/statement-import";
import { actorContext, requireSession } from "@/server/session";
import { deleteRuleAction } from "./actions";

export const metadata: Metadata = { title: "Importar extrato" };

async function Content() {
  const s = await requireSession();
  const ctx = actorContext(s);
  const { accounts, rules } = await db.asUser(s.userId, async (q) => ({
    accounts: await q.query<{ id: string; name: string }>("select id, name from financial_accounts where workspace_id = $1 and archived_at is null order by name", [ctx.workspaceId]),
    rules: await listRules({ q, ctx }),
  }));
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Importar OFX ou CSV" description="Você confere a prévia antes de gravar. Reimportar o mesmo extrato ou um período sobreposto não duplica lançamentos." />
        <CardBody><StatementImportForm accounts={accounts} /></CardBody>
      </Card>
      <Card>
        <CardHeader title="Regras de categorização" description="Criadas quando você corrige a categoria de um lançamento marcando “lembrar”. Valem para importações e novos lançamentos sem categoria." />
        <CardBody>
          {rules.length ? (
            <ul className="divide-y divide-border text-sm">
              {rules.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-mono text-xs">“{r.pattern}”</span> → {r.category_name}
                    <Badge className="ml-2">{r.origin === "learned" ? "aprendida" : "manual"}</Badge>
                  </span>
                  <form action={deleteRuleAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="text-subtle hover:text-danger" aria-label={`Excluir regra ${r.pattern}`}><Trash2 className="size-4" /></button>
                  </form>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Nenhuma regra ainda. Corrija a categoria de um lançamento em Lançamentos e marque “lembrar”.</p>}
        </CardBody>
      </Card>
    </div>
  );
}

export default function ImportarPage() {
  return (
    <>
      <PageHeader title="Importar extrato" description="Sem senha bancária: você exporta o arquivo do seu banco e envia aqui." />
      <Suspense fallback={<Skeleton className="h-80" />}><Content /></Suspense>
    </>
  );
}
