import type { ReactNode } from "react";

interface Props {
  /** The screen's own title. Rendered as the page's single <h1>, so it must read as a name, not a sentence. */
  title: ReactNode;
  /**
   * Where this screen sits, in two or three words — "단기 프로젝트", "자산".
   *
   * 🔴 Optional on purpose. An eyebrow that merely repeats the title is noise, and a screen that is not part
   * of a larger group has nothing true to put here. Left out is better than filled in.
   */
  eyebrow?: string;
  /** One or two sentences saying what this screen is for. Sits under the title at reading width. */
  description?: ReactNode;
  /** The way back, when there is one. Rendered above the title because that is where a person looks for it. */
  onBack?: () => void;
  /** The words alone — the arrow is this component's, and putting one here would be announced aloud. */
  backLabel?: string;
  /** Buttons that act on the whole screen, not on one card inside it. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The band every screen opens with.
 *
 * Sixteen screens had already converged on the same five lines of markup — back button, then an <h1> carrying
 * the glow dot from §2.5 — by copy. Copies drift: five of them had drifted onto `text-slate-300`, which the
 * design system does not have. One component is how the next screen inherits the decision instead of the
 * paste.
 *
 * The frame is what is new: a hairline that catches the light along the top edge and one soft glow behind the
 * corner, so the title sits on a surface rather than on the page background. Both are decorative and both are
 * `aria-hidden` — nothing here is announced twice.
 */
export function ScreenHeader({ title, eyebrow, description, onBack, backLabel = "프로젝트로 돌아가기", actions, className = "" }: Props) {
  return (
    <header className={`relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-6 ${className}`}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/60 to-transparent"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-violet-500/10 blur-2xl"
      />
      <div className="relative space-y-1.5">
        {onBack && (
          /*
           * 🔴 The arrow is drawn here and is `aria-hidden`, so `backLabel` is the whole accessible name.
           *
           * It was briefly part of the label string instead, and that broke both ends at once: a screen
           * reader announced "left arrow 프로젝트 목록으로", and — because a caller could simply forget the
           * character — ten of the twenty-one screens silently lost the arrow. A decoration that every
           * caller has to remember is a decoration half of them will not.
           */
          <button type="button" className="text-xs text-slate-400 hover:text-slate-300" onClick={onBack}>
            <span aria-hidden="true">←</span> {backLabel}
          </button>
        )}
        {eyebrow && <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{eyebrow}</p>}
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
          <span
            aria-hidden="true"
            className="h-2 w-2 flex-shrink-0 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
          />
          {title}
        </h1>
        {description && <p className="max-w-2xl text-sm leading-relaxed text-slate-400">{description}</p>}
      </div>
      {actions && <div className="relative mt-4 flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
