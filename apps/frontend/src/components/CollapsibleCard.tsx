import type { ReactNode } from "react";

/**
 * A section of 작품 기본 설정 that opens when you click its title.
 *
 * The screen was one column roughly six screens tall: every field of every section, always expanded, so
 * reaching 비밀·복선 meant scrolling past four things you were not editing. Nothing here is filled in more than
 * once in a while — a title, a protagonist, a world note — but all of it was permanently in the way.
 *
 * The summary is the part that makes collapsing honest. A closed section that shows only its name forces you to
 * open every one to find out what is set, which is the same scrolling with extra clicks. So each section says
 * its current value while closed — 주인공: 이배드, 세계관 3개 — and opens only when there is something to change.
 *
 * `<details>` rather than a state toggle: keyboard and screen readers already know it, it needs no JavaScript,
 * and the content stays in the DOM, so a test that fills a field does not have to open the section first.
 */
export function CollapsibleCard({ title, summary, defaultOpen = false, testId, children }: {
  title: string;
  /** What is set right now, shown while closed. Keep it to a few words. */
  summary: ReactNode;
  defaultOpen?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      data-testid={testId}
      className="group rounded-2xl border border-white/10 bg-slate-900/70 [&[open]]:pb-5"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl px-5 py-4 hover:bg-white/[0.03]">
        <span
          aria-hidden="true"
          className="text-xs text-slate-500 transition-transform group-open:rotate-90"
        >
          ▶
        </span>
        <span className="text-base font-semibold text-slate-100">{title}</span>
        {/* Hidden once open: the same words would then sit directly above the control that states them. */}
        <span className="ml-auto truncate text-sm text-slate-400 group-open:hidden">{summary}</span>
      </summary>
      <div className="space-y-3 px-5">{children}</div>
    </details>
  );
}
