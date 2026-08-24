interface SpinnerProps {
  label: string;
  className?: string;
}

/** A small inline loading indicator — same visible text as before, with a spinning ring in front of it. */
export function Spinner({ label, className = "" }: SpinnerProps) {
  return (
    <p role="status" className={`flex items-center gap-2 text-sm text-slate-400 ${className}`.trim()}>
      <span
        aria-hidden="true"
        className="h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-slate-700 border-t-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.55)]"
      />
      {label}
    </p>
  );
}
