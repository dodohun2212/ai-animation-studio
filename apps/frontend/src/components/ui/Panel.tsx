import type { ReactNode } from "react";

/**
 * §2.1's meanings, not a colour picker. `warning` is amber, `danger` rose, `success` emerald, `accent` violet —
 * a panel takes a tone because of what it says, never because the screen wanted variety.
 */
/*
 * 🔴 Every colour here is on §7's list. The first draft reached for `teal-300` and `orange-300` to make the
 * two-stop bars prettier, and neither is on it — §7 names `teal` in its refusals. A tone that means one
 * thing does not need two hues to say it, so each bar is now one hue light-to-dark. Violet→fuchsia stays
 * because that pair IS the brand gradient, and both are on the list.
 */
export type PanelTone = "default" | "accent" | "success" | "warning" | "danger";

const TONE: Record<PanelTone, { border: string; surface: string; bar: string }> = {
  default: { border: "border-white/10", surface: "bg-gradient-to-b from-slate-900/80 to-slate-900/55", bar: "from-violet-400 to-fuchsia-400" },
  accent: { border: "border-violet-400/25", surface: "bg-violet-500/[0.07]", bar: "from-violet-400 to-fuchsia-400" },
  success: { border: "border-emerald-400/30", surface: "bg-emerald-500/[0.05]", bar: "from-emerald-400 to-emerald-300" },
  warning: { border: "border-amber-400/30", surface: "bg-amber-500/[0.05]", bar: "from-amber-400 to-amber-300" },
  danger: { border: "border-rose-400/30", surface: "bg-rose-500/[0.05]", bar: "from-rose-400 to-rose-300" },
};

interface Props {
  /** The card's own heading. Omit for a card that is a single self-explaining control. */
  title?: ReactNode;
  /** A short line under the heading. Not a place for instructions — those belong in the body. */
  description?: ReactNode;
  tone?: PanelTone;
  /** Controls belonging to this card, sat on the heading row so the title keeps the left edge. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * One card of a screen.
 *
 * 🔴 The heading takes an accent bar rather than a second glow dot. §2.5 allows exactly three glows and the
 * screen title already spends one; a screen with nine glowing cards is a screen where the glow has stopped
 * meaning "this is the title".
 */
export function Panel({ title, description, tone = "default", actions, children, className = "", ...rest }: Props) {
  const t = TONE[tone];
  return (
    <section
      data-testid={rest["data-testid"]}
      className={`space-y-4 rounded-2xl border ${t.border} ${t.surface} p-5 ${className}`}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {title && (
              <h2 className="flex items-center gap-2.5 text-lg font-semibold text-slate-100">
                <span aria-hidden="true" className={`h-4 w-1 flex-shrink-0 rounded-full bg-gradient-to-b ${t.bar}`} />
                {title}
              </h2>
            )}
            {description && <p className="text-sm leading-relaxed text-slate-400">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
