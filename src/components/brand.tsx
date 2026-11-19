import Link from "next/link";
import { cn } from "@/lib/utils";

/** Monograma geométrico (gema lapidada) — desenhado no próprio projeto. */
export function GemaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <path d="M16 3 28 12 16 29 4 12Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M4 12h24M11 12l5-9 5 9-5 17-5-17Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity=".7" />
    </svg>
  );
}

export function Logo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 text-gold" aria-label="GEMA AI — início">
      <GemaMark />
      {compact ? null : (
        <span className="text-[15px] font-semibold tracking-[0.18em] text-fg">
          GEMA <span className="text-gold">AI</span>
        </span>
      )}
    </Link>
  );
}
