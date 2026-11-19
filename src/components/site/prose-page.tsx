import type { ReactNode } from "react";

export function ProsePage({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{eyebrow}</p>
      <h1 className="text-balance mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      {intro ? <p className="mt-4 text-lg leading-relaxed text-muted">{intro}</p> : null}
      <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-muted [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
        {children}
      </div>
    </article>
  );
}
