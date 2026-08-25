import { useEffect, useRef, useState } from "react";
import type { BudgetPreview, SceneNumber, StartVideoGenerationResponse, VideoPromptPreview } from "@ai-animation-studio/shared";

import { getVideoPromptPreview, toVideoPreviewDisplayError } from "../api/videoPreviewApi.js";
import { startVideoSubmission, toVideoSubmissionDisplayError } from "../api/videoSubmissionApi.js";
import { Spinner } from "./Spinner.js";

interface Props {
  projectId: string;
  onBack: () => void;
  onSubmitted?: (projectId: string, jobId: string) => void;
}

type DisplayError = { code: string; message: string };

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; previews: VideoPromptPreview[]; confirmationId?: string; maximumProviderCalls?: number; budget?: BudgetPreview };

const PROMPT_UTF16_LIMIT = 1000;
const outlineButton = "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";

/** JavaScript string length already counts UTF-16 code units, matching the Backend's limit. */
function utf16Length(value: string): number {
  return value.length;
}

export function VideoPromptPreviewScreen({ projectId, onBack, onSubmitted = () => {} }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [editedPrompts, setEditedPrompts] = useState<Partial<Record<SceneNumber, string>>>({});

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [userRequestId, setUserRequestId] = useState<string | null>(null);
  const [submitPending, setSubmitPending] = useState(false);
  const [submitError, setSubmitError] = useState<DisplayError | null>(null);
  const [submitted, setSubmitted] = useState<StartVideoGenerationResponse | null>(null);

  const loadRequest = useRef(0);
  const submitBusy = useRef(false);

  async function load(): Promise<void> {
    const requestId = ++loadRequest.current;
    setState({ status: "loading" });
    try {
      const response = await getVideoPromptPreview(projectId);
      if (requestId !== loadRequest.current) return;
      setState({
        status: "ready",
        previews: response.previews,
        confirmationId: response.confirmationId,
        maximumProviderCalls: response.maximumProviderCalls,
        budget: response.budget,
      });
      setEditedPrompts(Object.fromEntries(response.previews.map((preview) => [preview.sceneNumber, preview.prompt])));
      setConfirmOpen(false);
      setUserRequestId(null);
      setSubmitError(null);
      setSubmitted(null);
    } catch (caught) {
      if (requestId !== loadRequest.current) return;
      setState({ status: "error", error: toVideoPreviewDisplayError(caught) });
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  function promptFor(preview: VideoPromptPreview): string {
    return editedPrompts[preview.sceneNumber] ?? preview.prompt;
  }

  /** Edits stay in local component state only — never sent to the Backend or persisted. */
  function updatePrompt(sceneNumber: SceneNumber, value: string): void {
    setEditedPrompts((current) => ({ ...current, [sceneNumber]: value }));
  }

  const previews = state.status === "ready" ? state.previews : [];
  const totalCostUsd = previews.reduce((sum, preview) => sum + preview.estimatedCostUsd, 0);
  const confirmationId = state.status === "ready" ? state.confirmationId : undefined;
  const budget = state.status === "ready" ? state.budget : undefined;
  const maximumProviderCalls = state.status === "ready" ? state.maximumProviderCalls : undefined;
  // Compared against our own per-scene sum rather than the response's `estimatedRequestCostUsd`, so the
  // number the user is warned about is exactly the number shown above it.
  const overBudget = budget ? totalCostUsd > budget.remainingUsd || !budget.canSpend : false;
  const hasBlockingPromptError = previews.some((preview) => {
    const text = promptFor(preview);
    return !text.trim() || utf16Length(text) > PROMPT_UTF16_LIMIT;
  });

  /** Opens the second, explicit confirmation step. Never calls the network — only the final confirm step's button does. */
  function openConfirmation(): void {
    if (state.status !== "ready" || !confirmationId || hasBlockingPromptError || submitted) return;
    setSubmitError(null);
    setUserRequestId(crypto.randomUUID());
    setConfirmOpen(true);
  }

  function cancelConfirmation(): void {
    if (submitPending) return;
    setConfirmOpen(false);
  }

  async function confirmSubmission(): Promise<void> {
    if (submitBusy.current || state.status !== "ready" || !confirmationId || !userRequestId) return;
    submitBusy.current = true;
    setSubmitPending(true);
    setSubmitError(null);
    try {
      const response = await startVideoSubmission(projectId, {
        confirmationId,
        userRequestId,
        approved: true,
        prompts: previews.map((preview) => ({ sceneNumber: preview.sceneNumber, prompt: promptFor(preview) })),
      });
      setSubmitted(response);
      setConfirmOpen(false);
    } catch (caught) {
      setSubmitError(toVideoSubmissionDisplayError(caught));
    } finally {
      submitBusy.current = false;
      setSubmitPending(false);
    }
  }

  const isStale = submitError?.code === "VIDEO_CONFIRMATION_STALE";

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
        영상 프롬프트 및 비용 확인
      </h2>
      <p className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300" data-testid="no-provider-notice">
        실제 유료 Runway API를 호출하지 않습니다. 아래 수정 내용은 이 화면에만 유지되며 저장되지 않습니다.
      </p>

      {state.status === "loading" && <Spinner label="미리보기를 불러오는 중..." />}
      {state.status === "error" && (
        <div className="space-y-2">
          <p role="alert" data-testid="preview-error" data-error-code={state.error.code} className="text-sm text-rose-400">
            {state.error.message}
          </p>
          <button type="button" className={outlineButton} onClick={() => void load()}>
            다시 시도
          </button>
        </div>
      )}

      {state.status === "ready" && previews.length > 0 && (
        <>
          <p className="text-sm text-slate-400" data-testid="preview-summary">
            모델: {previews[0]!.model} · 비율: {previews[0]!.ratio} · 장면당 길이: {previews[0]!.durationSeconds}초
          </p>
          <ul className="space-y-4" data-testid="preview-list">
            {previews.map((preview) => {
              const promptText = promptFor(preview);
              const length = utf16Length(promptText);
              const overLimit = length > PROMPT_UTF16_LIMIT;
              return (
                <li
                  key={preview.sceneNumber}
                  data-testid={`preview-${preview.sceneNumber}`}
                  className="space-y-1.5 rounded-2xl border border-white/10 bg-slate-900/70 p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-200">{preview.sceneNumber}번 장면</span>
                    <span className="text-xs text-slate-400" data-testid={`cost-${preview.sceneNumber}`}>
                      예상 비용: ${preview.estimatedCostUsd.toFixed(2)}
                    </span>
                  </div>
                  <label className="block text-sm text-slate-300" htmlFor={`prompt-${preview.sceneNumber}`}>
                    Runway 프롬프트
                    <textarea
                      id={`prompt-${preview.sceneNumber}`}
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50"
                      rows={6}
                      value={promptText}
                      disabled={confirmOpen || submitPending || Boolean(submitted)}
                      onChange={(event) => updatePrompt(preview.sceneNumber, event.target.value)}
                    />
                  </label>
                  <p
                    className={overLimit ? "text-xs text-rose-400" : "text-xs text-slate-400"}
                    data-testid={`prompt-length-${preview.sceneNumber}`}
                  >
                    {length} / {PROMPT_UTF16_LIMIT}
                  </p>
                  {overLimit && (
                    <p
                      role="alert"
                      data-testid={`prompt-limit-error-${preview.sceneNumber}`}
                      className="text-xs text-rose-400"
                    >
                      프롬프트가 최대 글자 수({PROMPT_UTF16_LIMIT}자)를 초과했습니다.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <section
            aria-label="비용 및 예산 확인"
            className={`space-y-1.5 rounded-2xl border p-4 ${overBudget ? "border-rose-400/40 bg-rose-950/20" : "border-white/10 bg-slate-900/70"}`}
          >
            <p className="text-sm font-semibold text-slate-200" data-testid="total-cost">
              총 예상 비용: ${totalCostUsd.toFixed(2)}
            </p>
            {maximumProviderCalls !== undefined && (
              <p className="text-sm text-slate-300" data-testid="max-provider-calls">
                최대 호출 수: {maximumProviderCalls}회
              </p>
            )}
            {budget && (
              <p className="text-sm text-slate-300" data-testid="budget-summary">
                이번 달 남은 예산: ${budget.remainingUsd.toFixed(2)} (월 한도 ${budget.monthlyLimitUsd.toFixed(2)} 중 $
                {budget.spentUsd.toFixed(2)} 사용)
              </p>
            )}
            {overBudget && (
              <p role="alert" data-testid="budget-exceeded-warning" className="text-sm font-semibold text-rose-300">
                이번 요청의 예상 비용이 남은 월 예산을 초과합니다. 그대로 전송하면 예산 한도에 막혀 실패할 수 있습니다.
              </p>
            )}
          </section>

          {!submitted && (
            <div className="flex gap-3">
              <button
                type="button"
                className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
                data-testid="open-confirm-button"
                onClick={openConfirmation}
                disabled={confirmOpen || submitPending || hasBlockingPromptError || !confirmationId}
              >
                이 프롬프트로 전송 승인
              </button>
              {isStale && (
                <button type="button" className={outlineButton} onClick={() => void load()}>
                  새로고침
                </button>
              )}
            </div>
          )}

          {confirmOpen && (
            <div
              role="alertdialog"
              aria-label="영상 생성 요청 전송 확인"
              data-testid="submit-confirm-panel"
              className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4"
            >
              <p className="text-sm font-semibold text-amber-300">이 프롬프트로 영상 생성 요청을 전송할까요?</p>
              <p className="text-sm text-slate-300">
                아직 전송되지 않았습니다. 확인을 누르면 위 {previews.length}개 프롬프트가 그대로 로컬 승인 요청으로 전송됩니다.
                실제 유료 Runway 요청은 전송되지 않으며, 로컬 가짜 처리로만 기록됩니다.
              </p>
              {/* The spec requires the full preflight to be visible at the moment of approval, not only
                  further up the page where it may be scrolled out of view. */}
              <dl data-testid="confirm-preflight" className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-300">
                <dt className="text-slate-400">모델</dt>
                <dd>{previews[0]!.model}</dd>
                <dt className="text-slate-400">해상도 / 비율</dt>
                <dd>{previews[0]!.ratio}</dd>
                <dt className="text-slate-400">장면 수 / 길이</dt>
                <dd>
                  {previews.length}개 · 장면당 {previews[0]!.durationSeconds}초
                </dd>
                {maximumProviderCalls !== undefined && (
                  <>
                    <dt className="text-slate-400">최대 호출 수</dt>
                    <dd>{maximumProviderCalls}회</dd>
                  </>
                )}
                <dt className="text-slate-400">총 예상 비용</dt>
                <dd className="font-semibold text-slate-100">${totalCostUsd.toFixed(2)}</dd>
                {budget && (
                  <>
                    <dt className="text-slate-400">남은 월 예산</dt>
                    <dd className={overBudget ? "font-semibold text-rose-300" : undefined}>
                      ${budget.remainingUsd.toFixed(2)} / ${budget.monthlyLimitUsd.toFixed(2)}
                    </dd>
                  </>
                )}
              </dl>
              {overBudget && (
                <p role="alert" data-testid="confirm-budget-warning" className="text-sm font-semibold text-rose-300">
                  예상 비용이 남은 월 예산을 초과합니다.
                </p>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  className={outlineButton}
                  data-testid="cancel-submit-button"
                  onClick={cancelConfirmation}
                  disabled={submitPending}
                >
                  돌아가기
                </button>
                <button
                  type="button"
                  className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
                  data-testid="confirm-submit-button"
                  onClick={() => void confirmSubmission()}
                  disabled={submitPending}
                >
                  {submitPending ? "전송 중..." : "네, 로컬 승인 요청을 전송합니다"}
                </button>
              </div>
            </div>
          )}

          {submitError && (
            <p role="alert" data-testid="submit-error" data-error-code={submitError.code} className="text-sm text-rose-400">
              {submitError.message}
            </p>
          )}

          {submitted && (
            <div data-testid="submit-success" className="space-y-2 rounded-2xl border border-emerald-400/30 bg-slate-900/70 p-4">
              <p className="text-sm font-semibold text-emerald-400">
                로컬 가짜 영상 생성 작업이 접수되었습니다. 실제 유료 Runway 요청은 전송되지 않았습니다.
              </p>
              <p className="text-sm text-slate-300" data-testid="job-id">
                작업 ID: {submitted.jobId}
              </p>
              <p className="text-sm text-slate-300" data-testid="accepted-scenes">
                접수된 장면: {submitted.acceptedSceneNumbers.join(", ")}
              </p>
              <button
                type="button"
                className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(16,185,129,0.35)]"
                data-testid="view-progress-button"
                onClick={() => onSubmitted(projectId, submitted.jobId)}
              >
                진행 상황 보기
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
