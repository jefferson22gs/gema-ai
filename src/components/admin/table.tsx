import type { ReactNode } from "react";
import { Card, EmptyState } from "@/components/ui/primitives";

export function AdminTable({ headers, rows, empty = "Sem registros." }: { headers: string[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <Card>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-border text-left text-xs text-subtle">{headers.map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="px-4 py-2.5 text-muted">{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : <EmptyState title={empty} />}
    </Card>
  );
}

export function Metric({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" | "warning" }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-2 text-xl font-semibold tabular-nums ${tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : ""}`}>{value}</p>
    </Card>
  );
}
