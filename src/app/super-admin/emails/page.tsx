import { AdminTable } from "@/components/admin/table";
import { env } from "@/lib/env";
import { auditAdminView, emailStats } from "@/server/admin/queries";
import { requirePlatformAdmin } from "@/server/session";

export default async function Emails() {
  const s = await requirePlatformAdmin();
  await auditAdminView(s.userId, "emails");
  const rows = await emailStats();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Primário: <strong className="text-fg">{env.emailPrimaryProvider()}</strong> (EMAIL_PRIMARY_PROVIDER). Fallback só quando o primário recusa comprovadamente; resultado ambíguo não gera reenvio.
      </p>
      <AdminTable headers={["Provedor", "Status", "Mensagens (30 dias)"]} rows={rows.map((r) => [r.provider ?? "—", r.status, r.n])} />
    </div>
  );
}
