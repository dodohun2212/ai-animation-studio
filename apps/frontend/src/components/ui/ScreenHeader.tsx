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
  /**
   * A picture of the thing this screen is about, sat to the left of the title on anything wider than a phone.
   *
   * 🔴 Optional, and only ever a picture. A screen whose subject has no image leaves it out and the header
   * stacks exactly as before; passing a control here would put something pressable where the eye expects the
   * subject, which is what `actions` is for.
   */
  leading?: ReactNode;
  /**
   * Facts about the thing this screen is about — a MetaGrid, usually — sat under the description.
   *
   * 🔴 Separate from `actions` because they are a different kind of thing: `actions` is a row of controls and
   * gets a controls row's spacing, `meta` is read. The slot exists because LongProjectDetail needed it and the
   * alternative on offer was a second hand-written copy of this component's markup, which §3.8 exists to stop.
   */
  meta?: ReactNode;
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
 * 🔴 2026-09-19: **상자를 걷어냈습니다.** 이 머리글은 둥근 판 + 위쪽 하이라이트 + 구석의 빛무리로 되어
 * 있었는데, 그 판 안에 든 게 제목 한 줄과 돌아가기 링크뿐인 화면이 많아서 **화면 위쪽 6분의 1이 빈 상자**
 * 였습니다. 제목이 무언가 위에 얹혀 있다는 느낌은 판이 아니라 **밑줄 하나**로 충분합니다.
 *
 * 🟠 제목 앞의 빛나는 점도 뺐습니다. 이 앱에서 무지개를 쓰는 자리는 **두 군데뿐**입니다 — 워드마크 밑줄과
 * 진행 중 프레임의 수면선. 화면마다 하나씩 더 켜지면 그건 포인트가 아니라 팔레트가 된 것입니다.
 */
export function ScreenHeader({ title, eyebrow, description, onBack, backLabel = "프로젝트로 돌아가기", leading, meta, actions, className = "" }: Props) {
  return (
    <header className={`relative border-b border-line pb-5 ${className}`}>
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start">
        {leading}
        <div className="min-w-0 flex-1 space-y-1.5">
          {onBack && (
            /*
             * 🔴 The arrow is drawn here and is `aria-hidden`, so `backLabel` is the whole accessible name.
             *
             * It was briefly part of the label string instead, and that broke both ends at once: a screen
             * reader announced "left arrow 프로젝트 목록으로", and — because a caller could simply forget the
             * character — ten of the twenty-one screens silently lost the arrow. A decoration that every
             * caller has to remember is a decoration half of them will not.
             */
            <button type="button" className="text-xs text-bone-dim transition-colors hover:text-bone" onClick={onBack}>
              <span aria-hidden="true">←</span> {backLabel}
            </button>
          )}
          {eyebrow && <p className="type-index text-bone-faint">{eyebrow}</p>}
          <h1 className="text-2xl font-semibold tracking-[-0.015em] text-bone">{title}</h1>
          {description && <p className="max-w-2xl text-sm leading-relaxed text-bone-dim">{description}</p>}
          {meta && <div className="pt-1">{meta}</div>}
        </div>
      </div>
      {actions && <div className="relative mt-4 flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
