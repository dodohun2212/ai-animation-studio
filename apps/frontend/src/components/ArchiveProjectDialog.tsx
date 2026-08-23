import { useState } from "react";

interface ArchiveProjectDialogProps {
  confirmationText: string;
  projectKind: "short" | "long";
  onCancel: () => void;
  onConfirm: (confirmation: string) => Promise<void>;
}

/** Opening this dialog is local UI state only; archiving needs an exact second confirmation. */
export function ArchiveProjectDialog({ confirmationText, projectKind, onCancel, onConfirm }: ArchiveProjectDialogProps) {
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const matches = confirmation === confirmationText;

  async function submit(): Promise<void> {
    if (!matches || pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm(confirmation);
    } catch (caught: unknown) {
      const display = caught as { code?: unknown; message?: unknown };
      setError({
        code: typeof display.code === "string" ? display.code : "CLIENT_UNKNOWN_ERROR",
        message: "Archiving the project failed. Please try again.",
      });
      setPending(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-rose-400/40 bg-rose-950/20 p-4" aria-label={`${projectKind} project archive confirmation`}>
      <h3 className="font-semibold text-rose-200">Archive project</h3>
      <p className="mt-2 text-sm text-slate-300">
        This recoverably archives the project. Type the exact {projectKind === "short" ? "topic" : "title"} to continue:
        <span className="ml-1 font-semibold text-slate-100">{confirmationText}</span>
      </p>
      <label className="mt-3 block text-sm text-slate-200" htmlFor="archive-confirmation">
        Exact confirmation
      </label>
      <input
        id="archive-confirmation"
        className="mt-1 w-full rounded border border-white/20 bg-slate-900 px-3 py-2 text-slate-100"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        disabled={pending}
      />
      {error && <p className="mt-3 text-sm text-rose-300" role="alert" data-error-code={error.code}>{error.message}</p>}
      <div className="mt-4 flex gap-3">
        <button type="button" className="rounded-full border border-white/20 px-4 py-2 text-sm text-slate-200" onClick={onCancel} disabled={pending}>Cancel</button>
        <button type="button" className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => { void submit(); }} disabled={!matches || pending}>
          {pending ? "Archiving…" : "Confirm archive"}
        </button>
      </div>
    </section>
  );
}
