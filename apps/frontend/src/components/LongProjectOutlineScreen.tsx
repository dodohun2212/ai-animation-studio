import { useEffect, useRef, useState } from "react";
import type { LongEpisodeOutline, LongProjectOutlinePromptPreview } from "@ai-animation-studio/shared";

import { approveLongProjectOutline, createLongProjectOutlinePreview, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { Spinner } from "./Spinner.js";

interface Props {
  projectId: string;
  onBack: () => void;
}

type DisplayError = { code: string; message: string; details?: Record<string, unknown> };

interface ApprovedState {
  promptSha256: string;
  modified: boolean;
  approvedAt: string;
  outlineStatus: "planned" | "outline_ready";
  episodes: LongEpisodeOutline[];
}

export function LongProjectOutlineScreen({ projectId, onBack }: Props) {
  const [preview, setPreview] = useState<LongProjectOutlinePromptPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<DisplayError | null>(null);

  const [promptText, setPromptText] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const [approvePending, setApprovePending] = useState(false);
  const [approveError, setApproveError] = useState<DisplayError | null>(null);
  const [approved, setApproved] = useState<ApprovedState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadRequest = useRef(0);
  const approveBusy = useRef(false);

  async function load() {
    const requestId = ++loadRequest.current;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const response = await createLongProjectOutlinePreview(projectId);
      if (requestId !== loadRequest.current) return;
      setPreview(response.preview);
      setPromptText(response.preview.prompt);
      setApproved(null);
      setApproveError(null);
      setValidationError(null);
      setConfirmOpen(false);
    } catch (caught) {
      if (requestId !== loadRequest.current) return;
      setPreviewError(toLongProjectDisplayError(caught));
    } finally {
      if (requestId === loadRequest.current) setPreviewLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  function restoreOriginal(): void {
    if (!preview || confirmOpen) return;
    setPromptText(preview.prompt);
    setValidationError(null);
  }

  /** Opens the second, explicit confirmation step. Never calls the network — only the final confirm step's button does. */
  function openConfirmation(): void {
    if (!preview) return;
    const trimmed = promptText.trim();
    if (!trimmed) {
      setValidationError("아웃라인 프롬프트를 입력해야 합니다.");
      return;
    }
    setValidationError(null);
    setApproveError(null);
    setConfirmOpen(true);
  }

  function cancelConfirmation(): void {
    if (approvePending) return;
    setConfirmOpen(false);
  }

  async function confirmApproval(): Promise<void> {
    if (approveBusy.current || !preview) return;
    const trimmed = promptText.trim();
    if (!trimmed) {
      setConfirmOpen(false);
      setValidationError("아웃라인 프롬프트를 입력해야 합니다.");
      return;
    }
    approveBusy.current = true;
    setApprovePending(true);
    setApproveError(null);
    try {
      const response = await approveLongProjectOutline(projectId, {
        promptSha256: preview.promptSha256,
        prompt: trimmed,
        approved: true,
      });
      setApproved({
        promptSha256: response.promptSha256,
        modified: response.modified,
        approvedAt: response.approvedAt,
        outlineStatus: response.project.outlineStatus,
        episodes: response.project.episodes,
      });
      setConfirmOpen(false);
    } catch (caught) {
      setApproveError(toLongProjectDisplayError(caught));
    } finally {
      approveBusy.current = false;
      setApprovePending(false);
    }
  }

  const isStale = approveError?.code === "LONG_OUTLINE_STALE";

  return (
    <section className="mt-8 space-y-4">
      <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300" onClick={onBack}>
        프로젝트로 돌아가기
      </button>
      <h2 className="text-xl font-semibold">아웃라인 프롬프트 확인</h2>

      {previewLoading && !preview && <Spinner label="미리보기를 불러오는 중..." />}
      {previewError && (
        <p role="alert" data-testid="preview-error" data-error-code={previewError.code} className="text-sm text-rose-400">
          {previewError.message}
        </p>
      )}

      {preview && (
        <>
          <p className="text-sm text-slate-400">Episode 수: {preview.episodeCount}</p>
          <label className="block text-sm text-slate-300" htmlFor="outline-prompt">
            아웃라인 프롬프트
            <textarea
              id="outline-prompt"
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-slate-100"
              rows={10}
              value={promptText}
              disabled={approvePending || confirmOpen}
              onChange={(event) => {
                setPromptText(event.target.value);
                setValidationError(null);
              }}
            />
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 disabled:opacity-50"
              onClick={restoreOriginal}
              disabled={approvePending || confirmOpen || promptText === preview.prompt}
            >
              원본으로 복원
            </button>
            <button
              type="button"
              className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              onClick={openConfirmation}
              disabled={approvePending || confirmOpen}
            >
              이 프롬프트로 승인
            </button>
            {isStale && (
              <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300" onClick={() => void load()}>
                새로고침
              </button>
            )}
          </div>
          {validationError && (
            <p role="alert" data-testid="validation-error" className="text-sm text-rose-400">
              {validationError}
            </p>
          )}
          {confirmOpen && (
            <div
              role="alertdialog"
              aria-label="아웃라인 승인 확인"
              data-testid="approve-confirm-panel"
              className="space-y-3 rounded-lg border border-amber-400/40 bg-slate-900 p-4"
            >
              <p className="text-sm font-semibold text-amber-300">아웃라인을 승인할까요?</p>
              <p className="text-sm text-slate-300">
                아직 승인되지 않았습니다. 확인을 누르면 위 프롬프트가 그대로 서버로 전송되어 승인 처리됩니다.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 disabled:opacity-50"
                  onClick={cancelConfirmation}
                  disabled={approvePending}
                >
                  돌아가기
                </button>
                <button
                  type="button"
                  className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={() => void confirmApproval()}
                  disabled={approvePending}
                >
                  {approvePending ? "전송 중..." : "네, 승인합니다"}
                </button>
              </div>
            </div>
          )}
          {approveError && (
            <p role="alert" data-testid="approve-error" data-error-code={approveError.code} className="text-sm text-rose-400">
              {approveError.message}
            </p>
          )}
          {approved && (
            <p data-testid="approved-message" className="text-sm text-emerald-400">
              승인되었습니다. ({approved.approvedAt})
            </p>
          )}
          {approved && (
            <div data-testid="episode-outline-list" className="space-y-2 rounded-lg border border-white/10 bg-slate-900 p-4">
              <p className="text-sm font-semibold text-slate-200">Episode 아웃라인 상태</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
                {approved.episodes.map((episode) => (
                  <li key={episode.episodeNumber} data-testid={`episode-outline-${episode.episodeNumber}`} data-status={episode.status}>
                    {episode.title} — {episode.status}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </section>
  );
}
