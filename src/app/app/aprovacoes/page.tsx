import type { Metadata } from "next";
import { Suspense } from "react";
import { refresh } from "next/cache";
import { z } from "zod";
import { ShieldCheck } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { AGENT_BY_KEY } from "@/server/ai/agents";
import { confirmExecution, rejectExecution } from "@/server/ai/executor";
import type { AgentKey } from "@/server/ai/tools";
import { googleGateway } from "@/server/runtime";
import { actorContext, requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Aprovações" };

const RISK = {
  1: { label: "Consulta", tone: "neutral" },
  2: { label: "Reversível", tone: "gold" },
  3: { label: "Sensível/externa", tone: "warning" },
  4: { label: "Crítica — bloqueada", tone: "danger" },
} as const;

const STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "gold" }> = {
  succeeded: { label: "Executada", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
  rejected: { label: "Rejeitada", tone: "neutral" },
  expired: { label: "Expirada", tone: "neutral" },
  cancelled: { label: "Cancelada", tone: "neutral" },
  blocked: { label: "Bloqueada", tone: "danger" },
  running: { label: "Executando", tone: "gold" },
};

async function decide(form: FormData) {
  "use server";
  const s = await requireSession();
  const id = z.string().uuid().parse(form.get("id"));
  const deps = { db, ctx: actorContext(s), google: googleGateway() };
  if (form.get("decision") === "approve") await confirmExecution(deps, id);
  else await rejectExecution(deps, id);
  refresh();
}

interface Row {
  id: string;
  tool_name: string;
  risk_level: 1 | 2 | 3 | 4;
  agent: AgentKey | null;
  status: string;
  approval_summary: string | null;
  result: { summary?: string; confirmation?: string } | null;
  error: string | null;
  created_at: Date;
  expires_at: Date | null;
  decided_at: Date | null;
}

async function Approvals() {
  const s = await requireSession();
  const ctx = actorContext(s);
  const rows = await db.asUser(s.userId, (q) =>
    q.query<Row>(
      `select id, tool_name, risk_level, agent, status, approval_summary, result, error, created_at, expires_at, decided_at
       from ai_tool_executions where workspace_id = $1 and actor_id = $2
         and (status = 'awaiting_confirmation' or requires_confirmation or risk_level >= 3)
       order by created_at desc limit 60`,
      [ctx.workspaceId, s.userId],
    ),
  );
  const now = ctx.now.getTime();
  const pending = rows.filter((r) => r.status === "awaiting_confirmation" && (!r.expires_at || new Date(r.expires_at).getTime() > now));
  const history = rows.filter((r) => !pending.includes(r));
  const agentLabel = (k: AgentKey | null) => (k ? AGENT_BY_KEY.get(k)?.title ?? k : "—");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={`Pendentes (${pending.length})`} description="A aprovação vale apenas para a operação exatamente como descrita. Se algo mudar, uma nova aprovação é pedida." />
        <CardBody>
          {pending.length ? (
            <ul className="space-y-3">
              {pending.map((r) => (
                <li key={r.id} className="rounded-lg border border-border bg-bg-elevated p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={RISK[r.risk_level].tone}>Risco {r.risk_level} · {RISK[r.risk_level].label}</Badge>
                    <span className="text-subtle">{agentLabel(r.agent)} · {r.tool_name}</span>
                    {r.expires_at ? <span className="text-subtle">expira {formatDateTime(r.expires_at, ctx.timezone)}</span> : null}
                  </div>
                  <p className="mt-2 text-sm">{r.approval_summary ?? r.result?.confirmation ?? r.tool_name}</p>
                  <div className="mt-3 flex gap-2">
                    <form action={decide}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /><Button size="sm">Aprovar e executar</Button></form>
                    <form action={decide}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" /><Button size="sm" variant="secondary">Rejeitar</Button></form>
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={<ShieldCheck />} title="Nada aguardando sua aprovação" description="Ações sensíveis pedidas ao assistente aparecem aqui antes de serem executadas." />}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Histórico" description="Decisões e ações sensíveis recentes (auditadas)." />
        {history.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-subtle"><tr className="border-b border-border"><th className="px-5 py-2 font-medium">Quando</th><th className="font-medium">Ação</th><th className="font-medium">Risco</th><th className="font-medium">Resultado</th></tr></thead>
              <tbody className="divide-y divide-border">
                {history.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-2.5 tabular-nums text-muted">{formatDateTime(r.decided_at ?? r.created_at, ctx.timezone)}</td>
                    <td className="py-2.5">{r.approval_summary ?? r.tool_name}<span className="block text-[11px] text-subtle">{r.result?.summary ?? r.error ?? ""}</span></td>
                    <td><Badge tone={RISK[r.risk_level].tone}>{r.risk_level}</Badge></td>
                    <td><Badge tone={STATUS[r.status]?.tone ?? (r.status === "awaiting_confirmation" ? "neutral" : "neutral")}>{STATUS[r.status]?.label ?? (r.status === "awaiting_confirmation" ? "Expirada" : r.status)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <CardBody><p className="text-sm text-muted">Sem histórico.</p></CardBody>}
      </Card>
    </div>
  );
}

export default function AprovacoesPage() {
  return (
    <>
      <PageHeader title="Central de aprovações" description="Pagamentos, transferências e investimentos nunca são executados pelo assistente." />
      <Suspense fallback={<Skeleton className="h-96" />}><Approvals /></Suspense>
    </>
  );
}
