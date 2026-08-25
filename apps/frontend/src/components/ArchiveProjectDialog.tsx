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
        message: "프로젝트를 보관하지 못했습니다. 다시 시도해 주세요.",
      });
      setPending(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-rose-400/30 bg-rose-950/20 p-5" aria-label={`${projectKind === "short" ? "단편" : "장기"} 프로젝트 보관 확인`}>
      <h3 className="font-semibold text-rose-200">프로젝트 보관하기</h3>
      <p className="mt-2 text-sm text-slate-300">
        이 프로젝트를 보관함으로 옮깁니다(나중에 다시 꺼낼 수 있어요). 계속하려면 정확한 {projectKind === "short" ? "주제" : "제목"}을 입력하세요:
        <span className="ml-1 font-semibold text-slate-100">{confirmationText}</span>
      </p>
      <label className="mt-3 block text-sm text-slate-200" htmlFor="archive-confirmation">
        위 내용 그대로 입력
      </label>
      <input
        id="archive-confirmation"
        className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 text-slate-100 focus:border-rose-400/50 focus:outline-none focus:ring-2 focus:ring-rose-500/30 disabled:opacity-50"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        disabled={pending}
      />
      {error && <p className="mt-3 text-sm text-rose-300" role="alert" data-error-code={error.code}>{error.message}</p>}
      <div className="mt-4 flex gap-3">
        <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50" onClick={onCancel} disabled={pending}>취소</button>
        <button type="button" className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(225,29,72,0.3)] disabled:opacity-50" onClick={() => { void submit(); }} disabled={!matches || pending}>
          {pending ? "보관하는 중…" : "보관하기"}
        </button>
      </div>
    </section>
  );
}
