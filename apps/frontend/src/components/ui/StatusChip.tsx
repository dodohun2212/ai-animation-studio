/**
 * The status chip from the design system (docs/05_DESIGN_SYSTEM.md §3.4).
 *
 * `tone` is the fixed status grammar from §2.1 and must not be reused for another meaning:
 * success = done, progress = running/attention, danger = failed, active = current/selected,
 * neutral = waiting or not-yet-started. The label is always rendered as text — status is never
 * conveyed by color alone (§6).
 */
export type StatusTone = "success" | "progress" | "danger" | "active" | "neutral";

const TONE_CLASSNAME: Record<StatusTone, string> = {
  success: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  progress: "border-amber-400/40 bg-amber-500/10 text-amber-300",
  danger: "border-rose-400/30 bg-rose-500/15 text-rose-400",
  active: "border-violet-400/50 bg-violet-500/15 text-violet-300",
  neutral: "border-white/10 text-slate-300",
};

interface StatusChipProps {
  tone: StatusTone;
  children: React.ReactNode;
  /** Set when the chip is the only label for an element that needs its own test hook. */
  "data-testid"?: string;
}

export function StatusChip({ tone, children, "data-testid": testId }: StatusChipProps) {
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASSNAME[tone]}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
