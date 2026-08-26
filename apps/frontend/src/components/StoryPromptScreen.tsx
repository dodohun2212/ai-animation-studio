import { useEffect, useRef, useState } from "react";
import type { BudgetPreview, Scene, StoryPromptPreview } from "@ai-animation-studio/shared";
import { WorkflowState, STORY_ESTIMATED_COST_USD } from "@ai-animation-studio/shared";

import { approveStoryPrompt, createStoryPromptPreview, toStoryDisplayError } from "../api/storyPromptApi.js";
import { getProject } from "../api/projectsApi.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { Spinner } from "./Spinner.js";
import { BudgetLine } from "./ui/BudgetLine.js";

interface Props {
  projectId: string;
  onBack: () => void;
  /** The next pipeline step. Optional so the screen still renders standalone in tests that do not navigate. */
  onOpenMappingReview?: (projectId: string) => void;
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

export function StoryPromptScreen({ projectId, onBack, onOpenMappingReview }: Props) {
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

  /**
   * The scenes this project ALREADY has, loaded on entry.
   *
   * Without this the screen looked identical on a second visit: same prompt box, same 승인 button — except the
   * backend refuses. `StoryPromptService.approve` guards on `workflow_state !== WorkflowState.Ready`
   * (story-prompt.service.ts), and nothing in the codebase ever sets a project back to `Ready` after the
   * story runs. So on a project that already has a script, pressing 승인 could only ever produce an error.
   * `null` = not loaded or unreadable; the screen then behaves exactly as it did before rather than
   * blocking on a fetch that failed.
   */
  const [existing, setExisting] = useState<{ workflowState: WorkflowState; scenes: Scene[] } | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    getProject(projectId)
      .then((response) => {
        if (!cancelled) setExisting({ workflowState: response.project.workflowState, scenes: response.project.scenes });
      })
      // Deliberately silent: this only decides which of two wordings to show. A failure here must not
      // replace the screen with an error the user cannot act on.
      .catch(() => { if (!cancelled) setExisting(null); });
    return () => { cancelled = true; };
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
  /** Already ran, and cannot run again — see the `existing` comment above. */
  const alreadyGenerated = existing !== null && existing.workflowState !== WorkflowState.Ready
    && Array.isArray(existing.scenes) && existing.scenes.length > 0 && approved === null;

  /**
   * `Scene` is a claim, not a guarantee: `project.mapper.ts` hands the stored scene objects to the API with
   * `stored.scenes as unknown as Scene[]`, and the client's `isProject` only checks `Array.isArray(scenes)` —
   * no element is ever validated. So a scene saved before a field existed, or written by a different code
   * path, can arrive without `script`, and `scene.script.trim()` then throws during render and takes the
   * whole app down to a blank page. Read every field defensively; a missing one is a display problem, never
   * a crash. (`ProjectDetail` already guards `narration` with the same `typeof` check, for the same reason.)
   */
  function textOf(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  function SceneList({ scenes, testId }: { scenes: Scene[]; testId: string }) {
    return (
      <ol data-testid={testId} className="space-y-3">
        {scenes.map((scene, index) => {
          const number = typeof scene?.number === "number" ? scene.number : index + 1;
          const script = textOf(scene?.script);
          const narration = textOf(scene?.narration);
          return (
            <li key={number} data-testid={`generated-scene-${number}`} className="rounded-lg border border-white/5 bg-slate-900/50 p-3">
              <p className="text-xs font-semibold text-violet-300">{number}번 장면</p>
              {script.trim() ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{script}</p>
              ) : (
                <p className="mt-1 text-sm text-slate-500">이 장면에는 대본 문장이 비어 있습니다.</p>
              )}
              {narration.trim() && (
                <p className="mt-2 border-t border-white/5 pt-2 text-sm text-slate-400">
                  <span className="text-xs text-slate-500">읽어줄 문장 · </span>
                  {narration}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    );
  }

  function NextSteps({ testId }: { testId: string }) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-3">
        {onOpenMappingReview && (
          <button
            type="button"
            data-testid={testId}
            className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]"
            onClick={() => onOpenMappingReview(projectId)}
          >
            다음: 참고 이미지 연결
          </button>
        )}
        <button
          type="button"
          className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
          onClick={onBack}
        >
          프로젝트 화면으로
        </button>
      </div>
    );
  }

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

      {/* Second visit to a project whose script already exists. The prompt box and 승인 button are not shown at
          all here — not disabled, not hidden behind a warning: pressing them can only produce
          STORY_GENERATION_NOT_ALLOWED, so offering them is offering a dead end. What the person actually wants
          at this point is to read what was written and move on, so that is what the screen becomes. */}
      {alreadyGenerated && existing && (
        <div data-testid="story-already-generated" className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6">
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/[0.07] p-3.5">
            <p className="text-sm font-semibold text-amber-200">이 프로젝트는 대본이 이미 만들어졌습니다.</p>
            <p className="mt-1 text-sm text-slate-300">
              대본 생성은 프로젝트당 한 번만 됩니다. 같은 프로젝트에서 대본을 다시 만들 수는 없습니다 —
              내용을 바꾸려면 아래 장면을 <span className="text-slate-200">장면 편집</span>에서 직접 고치거나,
              설정을 바꿔 <span className="text-slate-200">새 프로젝트</span>를 만들어 주세요.
            </p>
            <p className="mt-1 text-xs text-slate-500">다시 만들 수 없으니 이 화면에서 비용이 나갈 일도 없습니다.</p>
          </div>
          <p className="text-sm font-semibold text-slate-200">지금 대본 · 장면 {existing.scenes.length}개</p>
          <SceneList scenes={existing.scenes} testId="existing-scene-list" />
          <NextSteps testId="existing-continue-to-mapping-review" />
        </div>
      )}

      {preview && !alreadyGenerated && (
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
          {/* This block used to list "1번 장면 … 6번 장면" and stop there. The approval response carries every
              scene's actual text, so the one question a person has at this moment — "what did it write?" —
              was answerable and went unanswered; the only way to read the script was to guess that 장면 편집
              on the project screen holds it. And there was no way forward at all: no next button, just the
              돌아가기 at the top of the page. Both are fixed here. */}
          {approved && approved.workflowState === WorkflowState.WaitingForAssetMappingReview && approved.scenes.length > 0 && (
            <div data-testid="generated-scenes" className="space-y-3 rounded-xl border border-white/10 bg-slate-950/60 p-4">
              <p className="text-sm font-semibold text-slate-200">대본에서 {approved.scenes.length}개 장면이 생성되었습니다.</p>
              <SceneList scenes={approved.scenes} testId="generated-scene-list" />
              <p className="text-xs text-slate-500">
                내용을 고치려면 프로젝트 화면의 <span className="text-slate-400">장면 편집</span>에서 장면마다 바꿀 수 있습니다.
              </p>
              <NextSteps testId="continue-to-mapping-review" />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
