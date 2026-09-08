import type { ReactNode } from "react";

export interface MetaItem {
  label: string;
  value: ReactNode;
  /** Long values (an id, a path) get the full width so they are not truncated into uselessness. */
  wide?: boolean;
}

/**
 * Labelled facts about the thing on screen, laid out as a grid instead of stacked sentences.
 *
 * The screens that show these facts — a project's id and timestamps, a card's source, an episode's counts —
 * were each writing their own two-column arrangement, and they disagreed about label size, gap and order of
 * label-then-value. One grid so a person reads them the same way on every screen.
 *
 * `dl` rather than a table: these are name/value pairs, not rows of a dataset, and a screen reader should
 * announce them as such (§6).
 */
export function MetaGrid({ items, columns = 2, className = "" }: { items: MetaItem[]; columns?: 2 | 3 | 4; className?: string }) {
  const cols = columns === 4 ? "sm:grid-cols-4" : columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <dl className={`grid gap-x-6 gap-y-3 ${cols} ${className}`.trim()}>
      {items.map((item) => (
        <div key={item.label} className={item.wide ? "sm:col-span-full" : undefined}>
          <dt className="text-xs text-slate-400">{item.label}</dt>
          <dd className="mt-0.5 text-sm text-slate-100">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface StatItem {
  label: string;
  value: ReactNode;
  /** Draws the number in a state colour when it is the one that needs attention. */
  tone?: "default" | "progress" | "success";
}

/**
 * The counts panel — how many of a thing there are, and how many are waiting.
 *
 * Numbers get `tabular-nums` (§2.2) because these sit in a column and a person compares them vertically; a
 * proportional 1 makes two rows look mismatched when they are not.
 */
export function SummaryPanel({ title, stats, className = "" }: { title: string; stats: StatItem[]; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-5 ${className}`.trim()} aria-label={title}>
      <h2 className="flex items-center gap-2.5 text-lg font-semibold text-slate-100">
        <span aria-hidden="true" className="h-4 w-1 flex-shrink-0 rounded-full bg-gradient-to-b from-violet-400 to-fuchsia-400" />
        {title}
      </h2>
      <dl className="mt-3 space-y-2.5">
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-xs text-slate-400">{stat.label}</dt>
            <dd
              className={`text-sm font-semibold tabular-nums ${
                stat.tone === "progress" ? "text-amber-300" : stat.tone === "success" ? "text-emerald-300" : "text-slate-100"
              }`}
            >
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
