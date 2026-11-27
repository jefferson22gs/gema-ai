import { formatCents } from "@/lib/money";

/**
 * Gráficos SVG leves (sem dependência externa), acessíveis: cada gráfico tem título, descrição
 * textual e tabela de dados alternativa para leitores de tela.
 */
export function BalanceLineChart({ points, title, floorCents = 0 }: { points: { date: string; balanceCents: number }[]; title: string; floorCents?: number }) {
  if (points.length < 2) return <p className="text-sm text-muted">Dados insuficientes para o gráfico.</p>;
  const w = 640;
  const h = 180;
  const pad = 8;
  const values = points.map((p) => p.balanceCents);
  const min = Math.min(...values, floorCents);
  const max = Math.max(...values, floorCents + 1);
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - 2 * pad);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.balanceCents).toFixed(1)}`).join(" ");
  const lowest = points.reduce((a, b) => (b.balanceCents < a.balanceCents ? b : a));
  const li = points.indexOf(lowest);
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-44 w-full" role="img" aria-labelledby="bal-title bal-desc">
        <title id="bal-title">{title}</title>
        <desc id="bal-desc">
          Saldo de {formatCents(points[0].balanceCents)} em {points[0].date} a {formatCents(points[points.length - 1].balanceCents)} em {points[points.length - 1].date};
          menor saldo {formatCents(lowest.balanceCents)} em {lowest.date}.
        </desc>
        <line x1={pad} x2={w - pad} y1={y(floorCents)} y2={y(floorCents)} stroke="var(--border-strong)" strokeDasharray="4 4" />
        <path d={`${path} L${x(points.length - 1)},${h - pad} L${x(0)},${h - pad} Z`} fill="var(--gold-soft)" />
        <path d={path} fill="none" stroke="var(--gold)" strokeWidth="2" />
        <circle cx={x(li)} cy={y(lowest.balanceCents)} r="4" fill={lowest.balanceCents < floorCents ? "var(--danger)" : "var(--gold)"} />
      </svg>
    </figure>
  );
}

export function BarList({ items, total }: { items: { label: string; cents: number; hint?: string }[]; total?: number }) {
  const max = total ?? Math.max(1, ...items.map((i) => i.cents));
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex justify-between gap-2 text-sm">
            <span className="truncate">{i.label}</span>
            <span className="shrink-0 tabular-nums text-muted">{formatCents(i.cents)}{i.hint ? ` · ${i.hint}` : ""}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-2" role="presentation">
            <div className="h-2 rounded-full bg-gold" style={{ width: `${Math.min(100, (i.cents / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Progress({ pct, tone = "gold", label }: { pct: number; tone?: "gold" | "success" | "warning" | "danger"; label: string }) {
  const color = { gold: "bg-gold", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <div className="h-2 rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}
