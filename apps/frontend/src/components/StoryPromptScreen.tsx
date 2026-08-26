import { useEffect, useRef, useState } from "react";
import type { BudgetPreview, Scene, StoryPromptPreview } from "@ai-animation-studio/shared";
import { WorkflowState, STORY_ESTIMATED_COST_USD } from "@ai-animation-studio/shared";

import { approveStoryPrompt, createStoryPromptPreview, toStoryDisplayError } from "../api/storyPromptApi.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { Spinner } from "./Spinner.js";
import { BudgetLine } from "./ui/BudgetLine.js";

interface Props {
  projectId: string;
  onBack: () => void;
}

type DisplayError = { code: string; message: string; details?: Record<string, unknown> };

interface ApprovedState {
  prompt: string;
  promptSha256: string;
  modified: boolean;
  approvedAt: string;
  workflowState: WorkflowState;
  scenes: Scene[];
}

export function StoryPromptScreen({ projectId, onBack }: Props) {
  const [preview, setPreview] = useState<StoryPromptPreview | null>(null);
  /** Absent in the local fake execution mode, where the story call costs nothing. */
  const [budget, setBudget] = useState<BudgetPreview | undefined>(undefined);
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
      const response = await createStoryPromptPreview(projectId);
      if (requestId !== loadRequest.current) return;
      setPreview(response.preview);
      setBudget(response.budget);
      setPromptText(response.preview.originalPrompt);
      setApproved(null);
      setApproveError(null);
      setValidationError(null);
      setConfirmOpen(false);
    } catch (caught) {
      if (requestId !== loadRequest.current) return;
      setPreviewError(toStoryDisplayError(caught));
    } finally {
      if (requestId === loadRequest.current) setPreviewLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  function restoreOriginal(): void {
    if (!preview || confirmOpen) return;
    setPromptText(preview.originalPrompt);
    setValidationError(null);
  }

  /** Opens the second, explicit confirmation step. Never calls the network — only the final confirm step's button does. */
  function openConfirmation(): void {
    if (!preview) return;
    const trimmed = promptText.trim();
    if (!trimmed) {
      setValidationError("대본 지시문를 입력해야 합니다.");
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
      setValidationError("대본 지시문를 입력해야 합니다.");
      return;
    }
    approveBusy.current = true;
    setApprovePending(true);
    setApproveError(null);
    try {
      const response = await approveStoryPrompt(projectId, {
        originalPromptSha256: preview.originalPromptSha256,
        prompt: trimmed,
        approved: true,
      });
      setApproved({
        prompt: response.prompt,
        promptSha256: response.promptSha256,
        modified: response.modified,
        approvedAt: response.approvedAt,
        workflowState: response.project.workflowState,
        scenes: response.project.scenes,
      });
      setConfirmOpen(false);
    } catch (caught) {
      setApproveError(toStoryDisplayError(caught));
    } finally {
      approveBusy.current = false;
      setApprovePending(false);
    }
  }

  const isStale = approveError?.code === "STORY_PROMPT_STALE";

  return (
    <section className="mt-8 max-w-3xl space-y-5">
      <button
        type="button"
        className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
        onClick={onBack}
      >
        프로젝트로 돌아가기
      </button>
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        대본 지시문 확인
      </h1>

      {previewLoading && !preview && <Spinner label="미리보기를 불러오는 중..." />}
      {previewError && (
        <p role="alert" data-testid="preview-error" data-error-code={previewError.code} className="text-sm text-rose-400">
          {previewError.message}
        </p>
      )}

      {preview && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6">
          <p className="text-sm text-slate-400">
            글자 수: {preview.characterCount} · 장면 수: {preview.sceneCount}
          </p>
          <label className="block text-sm text-slate-300" htmlFor="story-prompt">
            대본 지시문
            <textarea
              id="story-prompt"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50"
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
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
              onClick={restoreOriginal}
              disabled={approvePending || confirmOpen || promptText === preview.originalPrompt}
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
                처음 내용으로 되돌리기
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
              aria-label="대본 지시문 전송 확인"
              data-testid="approve-confirm-panel"
              className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-950/60 p-4"
            >
              <p className="text-sm font-semibold text-amber-300">이 프롬프트로 대본을 만들까요?</p>
              <p className="text-sm text-slate-300">
                아직 전송되지 않았습니다. OpenAI 키가 연결되어 있으면 확인을 누르는 순간 실제 유료 요청이 전송되어 대본이
                만들어집니다. 키가 연결되어 있지 않으면 비용 없이 임시 대본으로 만들어집니다.
              </p>
              <p data-testid="story-cost-estimate" className="text-xs text-slate-300 tabular-nums">
                예상 비용: ${STORY_ESTIMATED_COST_USD.toFixed(2)} · 장면 수와 무관하게 프로젝트당 1회 · 키가 연결되어 있을 때만
                청구됩니다
              </p>
              <BudgetLine
                budget={budget}
                estimatedRequestCostUsd={STORY_ESTIMATED_COST_USD}
                data-testid="story-budget"
              />
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
                  {approvePending ? "전송 중..." : "네, 승인을 전송합니다"}
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
              승인되었습니다. (<span className="tabular-nums" title={approved.approvedAt}>{formatDateTime(approved.approvedAt)}</span>)
            </p>
          )}
          {approved && approved.workflowState === WorkflowState.WaitingForAssetMappingReview && approved.scenes.length > 0 && (
            <div data-testid="generated-scenes" className="space-y-2 rounded-xl border border-white/10 bg-slate-950/60 p-4">
              <p className="text-sm font-semibold text-slate-200">대본에서 {approved.scenes.length}개 장면이 생성되었습니다.</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
                {approved.scenes.map((scene) => (
                  <li key={scene.number} data-testid={`generated-scene-${scene.number}`}>
                    {scene.number}번 장면
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
