import { useEffect, useRef, useState } from "react";
import { LONG_OUTLINE_ESTIMATED_COST_USD } from "@ai-animation-studio/shared";
import type { LongEpisodeOutline, LongProjectOutlinePromptPreview } from "@ai-animation-studio/shared";

import { approveLongProjectOutline, createLongProjectOutlinePreview, getLongProject, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { longEpisodeStatusLabel } from "../utils/longEpisodeLabels.js";
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
  const [alreadyApproved, setAlreadyApproved] = useState(false);

  const loadRequest = useRef(0);
  const approveBusy = useRef(false);

  async function load() {
    const requestId = ++loadRequest.current;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      /**
       * Asked before the preview is shown: an outline that is already approved must not be offered for approval
       * again. A reload during a slow approval used to bring the screen back with the button armed, and pressing
       * it a second time reached the server — which is how one project was billed twice for the same outline
       * (D-023). The server refuses that now, but a screen that invites a refused action is still wrong.
       */
      const existing = await getLongProject(projectId).catch(() => null);
      if (requestId !== loadRequest.current) return;
      if (existing && existing.project.outlineStatus === "outline_ready") {
        setAlreadyApproved(true);
        setPreview(null);
        return;
      }
      setAlreadyApproved(false);
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
      setValidationError("스토리 개요 프롬프트를 입력해야 합니다.");
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
      setValidationError("스토리 개요 프롬프트를 입력해야 합니다.");
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
    <section className="mt-8 max-w-3xl space-y-5">
      <button
        type="button"
        className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
        onClick={onBack}
      >
        프로젝트로 돌아가기
      </button>
      <h2 className="flex items-center gap-2.5 text-lg font-semibold">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        회차 나누기 — AI에게 보낼 내용 확인
      </h2>
      {/* The two long-project text stores are easy to confuse and the screens never said how they differ.
          Stated as the question each one answers, since that is the only way to know which one to type into. */}
      <p className="text-sm text-slate-400">
        스토리 개요는 <strong className="text-slate-200">"몇 화에 무슨 일이 일어나는가"</strong>입니다 — 시간 순서를 따라가는 줄거리예요.
        등장인물이 어떻게 생겼는지, 어떤 배경·소품·비밀이 있는지는 여기가 아니라 <strong className="text-slate-200">등장인물·설정집</strong>에 적습니다.
      </p>

      {previewLoading && !preview && <Spinner label="미리보기를 불러오는 중..." />}
      {previewError && (
        <p role="alert" data-testid="preview-error" data-error-code={previewError.code} className="text-sm text-rose-400">
          {previewError.message}
        </p>
      )}
      {/* Sits outside the preview block on purpose: an already-approved outline has no preview to show, so a
          notice nested inside it would never render — which is how it was written the first time. */}
      {alreadyApproved && (
        <p data-testid="outline-already-approved" className="rounded-xl border border-emerald-400/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-200">
          이 작품의 스토리 개요는 이미 승인되었습니다. 회차 개요는 왼쪽 메뉴에서 볼 수 있습니다.
        </p>
      )}

      {preview && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <p className="text-sm text-slate-400">에피소드 수: {preview.episodeCount}</p>
          <label className="block text-sm text-slate-300" htmlFor="outline-prompt">
            스토리 개요 프롬프트
            <textarea
              id="outline-prompt"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50"
              rows={10}
              value={promptText}
              disabled={approvePending || confirmOpen}
              onChange={(event) => {
                setPromptText(event.target.value);
                setValidationError(null);
              }}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
              onClick={restoreOriginal}
              disabled={approvePending || confirmOpen || promptText === preview.prompt}
            >
              원본으로 복원
            </button>
            <button
              type="button"
              className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
              onClick={openConfirmation}
              disabled={approvePending || confirmOpen}
            >
              이 프롬프트로 승인
            </button>
            {isStale && (
              <button
                type="button"
                className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
                onClick={() => void load()}
              >
                새로고침
              </button>
            )}
          </div>
          {validationError && (
            <p role="alert" data-testid="validation-error" className="text-sm text-rose-400">
              {validationError}
            </p>
          )}
          {/* The wait is the defect this addresses. One project was billed for this outline twice, 22.9 seconds
              apart, and the ledger shows the two requests genuinely overlapped inside the server — so the second
              press happened while the first was still running. A button reading 전송 중… was the only sign, and
              after twenty seconds of an otherwise unchanged screen that is not enough to stop someone pressing
              again. The server now refuses the second attempt, but the person should not be put in the position
              of making it: say how long this takes, and say that pressing again cannot help. */}
          {approvePending && (
            <p data-testid="approve-in-progress" className="rounded-xl border border-violet-400/30 bg-violet-500/5 px-4 py-3 text-sm text-violet-200">
              AI가 회차 개요를 쓰는 중입니다. <span className="font-semibold">보통 20~30초쯤 걸립니다.</span>{" "}
              이 화면을 닫거나 다시 누르지 마세요 — 다시 눌러도 빨라지지 않고, 이미 보낸 요청은 그대로 진행됩니다.
            </p>
          )}
          {confirmOpen && (
            <div
              role="alertdialog"
              aria-label="스토리 개요 승인 확인"
              data-testid="approve-confirm-panel"
              className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4"
            >
              <p className="text-sm font-semibold text-amber-300">스토리 개요를 승인할까요?</p>
              <p className="text-sm text-slate-300">
                아직 승인되지 않았습니다. 확인을 누르면 위 프롬프트가 그대로 서버로 전송되어 승인 처리됩니다.{" "}
                {/* This notice used to read "비용이 들지 않습니다", on the stated grounds that LongProjectsService
                    was constructed with only a projects root. That has not been true since the Episode planner
                    was wired up: long-projects.module.ts injects ProviderSettingsService and OpenAiBudget, and
                    approve() calls callOpenAiEpisodePlannerApi and records LONG_OUTLINE_ESTIMATED_COST_USD
                    against the budget. So the screen was telling people a paid step was free — the exact harm
                    the original notice existed to prevent, pointed the other way.

                    The cost is read from the shared constant rather than typed here, so a rate change cannot
                    leave this sentence behind; and it is named as an estimate because the real per-request
                    charge grows with episodeCount and no Provider API discloses it before the call (see
                    LONG_OUTLINE_ESTIMATED_COST_USD's own doc comment). */}
                <span data-testid="approve-cost-notice" className="text-amber-300">
                  이 단계는 <span className="font-semibold">비용이 발생합니다</span> — AI가 {"에피소드 개요를 실제로 작성하며, 약 "}
                  {`$${LONG_OUTLINE_ESTIMATED_COST_USD.toFixed(2)}`}이 청구됩니다(회차 수가 많을수록 실제 금액은 커질 수 있는 추정치입니다).
                </span>
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
                  onClick={cancelConfirmation}
                  disabled={approvePending}
                >
                  돌아가기
                </button>
                <button
                  type="button"
                  className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
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
            <p data-testid="approved-message" className="text-sm font-semibold text-emerald-400">
              승인되었습니다. (<span className="tabular-nums" title={approved.approvedAt}>{formatDateTime(approved.approvedAt)}</span>)
            </p>
          )}
          {approved && (
            <div data-testid="episode-outline-list" className="space-y-2 rounded-xl border border-white/10 bg-slate-950/40 p-4">
              <p className="text-sm font-semibold text-slate-200">회차별 개요 상태</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
                {approved.episodes.map((episode) => (
                  <li key={episode.episodeNumber} data-testid={`episode-outline-${episode.episodeNumber}`} data-status={episode.status}>
                    {episode.title} — {longEpisodeStatusLabel(episode.status)}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
