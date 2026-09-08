export interface RibbonStep {
  /** Stable key — the caller's own step name. */
  key: string;
  label: string;
  /**
   * How far the PROJECT has got. Given per step rather than as one index because a photo card's reach is
   * counted differently from a story's, and the caller already knows which it is.
   */
  state?: "done" | "current" | "upcoming";
  /**
   * Whether this is the step being LOOKED AT, which is a different question from `state`.
   *
   * 🔴 Kept apart on purpose. The sidebar column this replaces once derived its filled dots from the screen
   * being viewed, so simply clicking a step "un-completed" everything after it — the bar answered "where am I
   * looking" while looking exactly like an answer to "how far have I got".
   */
  viewing?: boolean;
  /** A step with no handler renders as a plain marker rather than a button. */
  onSelect?: () => void;
}

interface Props {
  steps: RibbonStep[];
  /** Convenience for callers with one index instead of per-step states; ignored when a step sets its own. */
  currentIndex?: number;
  className?: string;
}

/**
 * The fixed pipeline, read left to right, with the current step lit.
 *
 * 🔴 This replaces reading the same information three ways. The pipeline was already on screen as a sidebar
 * column, a percentage bar and a resume button, and none of the three said "you are on step four of six" —
 * which is the one question someone opening a half-finished project asks first. The bar gives a percentage
 * with no names, the column gives names with no position, and the button gives the next step with no context.
 *
 * Steps before the current one are finished, so they are stated as finished (emerald) rather than merely
 * not-current: design system §2.1 fixes emerald to completion, and a person scanning this row is counting how
 * much is behind them.
 *
 * Deliberately not a `<nav>`: these are not links to elsewhere, they are positions in this project's own
 * progress, which is what `aria-current="step"` is for (§6).
 */
export function StepRibbon({ steps, currentIndex = -1, className = "" }: Props) {
  return (
    <ol className={`flex flex-wrap items-stretch gap-1.5 ${className}`.trim()} data-testid="step-ribbon">
      {steps.map((step, index) => {
        const state = step.state ?? (index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming");
        const done = state === "done";
        const current = state === "current";
        const tone = current
          ? "border-violet-400/50 bg-violet-500/15 text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]"
          : done
            ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
            : "border-white/10 bg-slate-950/40 text-slate-400";
        const body = (
          <>
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${
                current ? "bg-violet-500/30 text-white" : done ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-500"
              }`}
            >
              {index + 1}
            </span>
            {/*
              * 🔴 Its own testid because the badge beside it is `aria-hidden` but NOT text-hidden: it is in
              * `textContent`, so an assertion reading the button's text gets "1대본" rather than "대본". CLI
              * caught exactly that (App.test.tsx:406). Reading the label element is stable whether the badge
              * stays, goes, or grows — matching on the accessible name would only hold while it stays hidden.
              */}
            <span data-testid="step-ribbon-label" className="truncate text-xs font-semibold">{step.label}</span>
          </>
        );
        return (
          <li key={step.key} className="min-w-0 flex-1" aria-current={step.viewing ? "step" : undefined}>
            {step.onSelect ? (
              <button
                type="button"
                data-testid={`step-ribbon-${step.key}`}
                data-step-state={state}
                onClick={step.onSelect}
                className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors duration-150 hover:border-violet-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 ${tone} ${step.viewing ? "ring-2 ring-violet-500/30" : ""}`}
              >
                {body}
              </button>
            ) : (
              <span
                data-testid={`step-ribbon-${step.key}`}
                data-step-state={state}
                className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 ${tone} ${step.viewing ? "ring-2 ring-violet-500/30" : ""}`}
              >
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
