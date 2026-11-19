import type { Metadata } from "next";
import { Suspense } from "react";
import { FileText } from "lucide-react";
import { DocumentActions, UploadDocument } from "@/components/app/documents-client";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { isConfigured } from "@/lib/env";
import { formatDateTime } from "@/lib/time";
import { listDocuments } from "@/server/services/documents";
import { actorContext, requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Documentos" };

const KIND = { receipt: "Comprovante", invoice: "Boleto/fatura", contract: "Contrato", id: "Pessoal", other: "Outro" } as Record<string, string>;
const STATUS = { uploaded: "Enviado", extracting: "Extraindo", extracted: "Revisar extração", reviewed: "Revisado", failed: "Falha na extração" } as Record<string, string>;

async function Docs() {
  const s = await requireSession();
  const ctx = actorContext(s);
  const docs = await db.asUser(s.userId, (q) => listDocuments({ q, ctx }));
  const storageReady = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const extractReady = isConfigured("gemini");
  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <Card>
        <CardHeader title="Seus documentos" description="Armazenamento privado. Links de acesso expiram em 60 segundos." />
        <CardBody>
          {docs.length ? (
            <ul className="divide-y divide-border">
              {docs.map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.file_name}</p>
                    <p className="text-xs text-muted">{(d.size_bytes / 1024).toFixed(0)} KB · {formatDateTime(d.created_at, ctx.timezone)}</p>
                    <div className="mt-1 flex gap-1"><Badge>{KIND[d.kind] ?? d.kind}</Badge><Badge tone={d.status === "failed" ? "danger" : d.status === "extracted" ? "warning" : "neutral"}>{STATUS[d.status] ?? d.status}</Badge></div>
                  </div>
                  <DocumentActions id={d.id} canExtract={extractReady && d.mime_type !== "text/plain"} canDelete={d.owner_id === s.userId} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<FileText />} title="Nenhum documento" description="Envie comprovantes e boletos; a extração propõe valores e datas para você revisar." />
          )}
        </CardBody>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Enviar documento" />
        <CardBody className="space-y-3">
          {!storageReady ? <Alert tone="warning" title="Armazenamento: Não configurado">Defina SUPABASE_SERVICE_ROLE_KEY no servidor.</Alert> : null}
          <UploadDocument />
          <p className="text-[11px] text-subtle">Varredura antivírus não está ativa nesta versão; arquivos são validados por tipo e assinatura de conteúdo.</p>
        </CardBody>
      </Card>
    </div>
  );
}

export default function DocumentosPage() {
  return (
    <>
      <PageHeader title="Documentos" />
      <Suspense fallback={<Skeleton className="h-80" />}><Docs /></Suspense>
    </>
  );
}
