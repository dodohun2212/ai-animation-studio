import { useEffect, useRef, useState } from "react";
import type { ImageReview, Project, SceneNumber, StartImageGenerationResponse } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";

import { getProject, toDisplayError } from "../api/projectsApi.js";
import { startImageGeneration, toImageGenerationDisplayError } from "../api/imageGenerationApi.js";
import {
  approveImageReview,
  getImageReview,
  imageReviewContentUrl,
  regenerateImageReview,
  toImageReviewDisplayError,
} from "../api/imageReviewApi.js";

interface Props {
  projectId: string;
  onBack: () => void;
}

type DisplayError = { code: string; message: string };

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "success"; project: Project };

type ReviewLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; reviews: ImageReview[] };

const SCENE_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

export function ImageGenerationScreen({ projectId, onBack }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [generatePending, setGeneratePending] = useState(false);
  const [generateError, setGenerateError] = useState<DisplayError | null>(null);
  const [result, setResult] = useState<StartImageGenerationResponse | null>(null);
  const [projectOverride, setProjectOverride] = useState<Project | null>(null);
  const [reviewState, setReviewState] = useState<ReviewLoadState>({ status: "idle" });
  const [approvePendingScenes, setApprovePendingScenes] = useState<Set<SceneNumber>>(new Set());
  const [approveErrors, setApproveErrors] = useState<Partial<Record<SceneNumber, DisplayError>>>({});
  const [regenerateConfirmScene, setRegenerateConfirmScene] = useState<SceneNumber | null>(null);
  const [regeneratePendingScenes, setRegeneratePendingScenes] = useState<Set<SceneNumber>>(new Set());
  const [regenerateErrors, setRegenerateErrors] = useState<Partial<Record<SceneNumber, DisplayError>>>({});
  const generateBusy = useRef(false);
  const approveBusy = useRef<Set<SceneNumber>>(new Set());
  const regenerateBusy = useRef<Set<SceneNumber>>(new Set());
  const reviewLoadRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setResult(null);
    setProjectOverride(null);
    setGenerateError(null);
    setConfirmOpen(false);
    setReviewState({ status: "idle" });
    setApproveErrors({});
    setRegenerateConfirmScene(null);
    setRegenerateErrors({});
    getProject(projectId)
      .then((response) => {
        if (!cancelled) setState({ status: "success", project: response.project });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", error: toDisplayError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const currentProject = projectOverride ?? result?.project ?? (state.status === "success" ? state.project : null);
  const allowed = currentProject?.workflowState === WorkflowState.AssetMappingApproved;
  const reviewable = currentProject?.workflowState === WorkflowState.ImagesReview;
  const videoConfirmationReached = currentProject?.workflowState === WorkflowState.WaitingForVideoConfirmation;

  useEffect(() => {
    if (!reviewable && !videoConfirmationReached) return;
    // Skip once review data is already loaded (e.g. after an in-place approve/regenerate
    // response) so a workflow-state change alone never triggers a redundant refetch.
    if (reviewState.status !== "idle") return;
    const requestId = ++reviewLoadRequest.current;
    setReviewState({ status: "loading" });
    getImageReview(projectId)
      .then((response) => {
        if (requestId !== reviewLoadRequest.current) return;
        setReviewState({ status: "ready", reviews: response.reviews });
      })
      .catch((error: unknown) => {
        if (requestId !== reviewLoadRequest.current) return;
        setReviewState({ status: "error", error: toImageReviewDisplayError(error) });
      });
  }, [projectId, reviewable, videoConfirmationReached, reviewState.status]);

  async function approveScene(sceneNumber: SceneNumber): Promise<void> {
    if (approveBusy.current.has(sceneNumber)) return;
    approveBusy.current.add(sceneNumber);
    setApprovePendingScenes(new Set(approveBusy.current));
    try {
      const response = await approveImageReview(projectId, sceneNumber);
      setReviewState({ status: "ready", reviews: response.reviews });
      setProjectOverride(response.project);
      setApproveErrors((current) => {
        if (!(sceneNumber in current)) return current;
        const next = { ...current };
        delete next[sceneNumber];
        return next;
      });
    } catch (caught) {
      setApproveErrors((current) => ({ ...current, [sceneNumber]: toImageReviewDisplayError(caught) }));
    } finally {
      approveBusy.current.delete(sceneNumber);
      setApprovePendingScenes(new Set(approveBusy.current));
    }
  }

  /** Opens the explicit per-scene confirmation panel. Never calls the network by itself. */
  function openRegenerateConfirmation(sceneNumber: SceneNumber): void {
    if (regenerateBusy.current.has(sceneNumber)) return;
    setRegenerateConfirmScene(sceneNumber);
  }

  function cancelRegenerateConfirmation(sceneNumber: SceneNumber): void {
    if (regenerateBusy.current.has(sceneNumber)) return;
    setRegenerateConfirmScene((current) => (current === sceneNumber ? null : current));
  }

  async function confirmRegenerate(sceneNumber: SceneNumber): Promise<void> {
    if (regenerateBusy.current.has(sceneNumber)) return;
    regenerateBusy.current.add(sceneNumber);
    setRegeneratePendingScenes(new Set(regenerateBusy.current));
    try {
      const response = await regenerateImageReview(projectId, sceneNumber);
      setReviewState({ status: "ready", reviews: response.reviews });
      setProjectOverride(response.project);
      setRegenerateConfirmScene(null);
      setRegenerateErrors((current) => {
        if (!(sceneNumber in current)) return current;
        const next = { ...current };
        delete next[sceneNumber];
        return next;
      });
    } catch (caught) {
      setRegenerateErrors((current) => ({ ...current, [sceneNumber]: toImageReviewDisplayError(caught) }));
    } finally {
      regenerateBusy.current.delete(sceneNumber);
      setRegeneratePendingScenes(new Set(regenerateBusy.current));
    }
  }

  function sceneStatus(number: number): "completed" | "pending" {
    const scene = currentProject?.scenes.find((item) => item.number === number);
    return scene?.generatedImagePath ? "completed" : "pending";
  }

  /** Opens the explicit confirmation panel. Never calls the network — only the final confirm button does. */
  function openConfirmation(): void {
    if (!allowed) return;
    setGenerateError(null);
    setConfirmOpen(true);
  }

  function cancelConfirmation(): void {
    if (generatePending) return;
    setConfirmOpen(false);
  }

  async function confirmGeneration(): Promise<void> {
    if (generateBusy.current) return;
    generateBusy.current = true;
    setGeneratePending(true);
    setGenerateError(null);
    try {
      const response = await startImageGeneration(projectId);
      setResult(response);
      setProjectOverride(response.project);
      setConfirmOpen(false);
    } catch (caught) {
      setGenerateError(toImageGenerationDisplayError(caught));
    } finally {
      generateBusy.current = false;
      setGeneratePending(false);
    }
  }

  return (
    <section className="mt-8 space-y-4">
      <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300" onClick={onBack}>
        프로젝트로 돌아가기
      </button>
      <h2 className="text-xl font-semibold">장면 이미지 생성</h2>

      {state.status === "loading" && <p className="text-slate-400">불러오는 중...</p>}
      {state.status === "error" && (
        <p role="alert" data-testid="load-error" data-error-code={state.error.code} className="text-sm text-rose-400">
          {state.error.message}
        </p>
      )}

      {currentProject && (
        <>
          <p className="text-sm text-amber-300" data-testid="no-paid-notice">
            실제 유료 OpenAI 이미지 API를 호출하지 않습니다. 로컬 가짜(local fake) 어댑터로 장면 이미지 6장을 생성합니다.
          </p>

          {!allowed && !reviewable && !videoConfirmationReached && !result && (
            <p className="text-sm text-slate-400" data-testid="not-allowed">
              이미지 생성은 Asset Mapping이 승인된 프로젝트에서만 가능합니다. 현재 상태: {currentProject.workflowState}
            </p>
          )}

          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300" data-testid="scene-results">
            {SCENE_NUMBERS.map((number) => (
              <li key={number} data-testid={`scene-${number}`} data-status={sceneStatus(number)}>
                {number}번 장면 · {sceneStatus(number) === "completed" ? "완료" : "대기"}
              </li>
            ))}
          </ol>

          {allowed && !result && (
            <button
              type="button"
              className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              onClick={openConfirmation}
              disabled={confirmOpen}
            >
              이미지 생성 시작
            </button>
          )}

          {confirmOpen && (
            <div
              role="alertdialog"
              aria-label="장면 이미지 생성 확인"
              data-testid="generate-confirm-panel"
              className="space-y-3 rounded-lg border border-amber-400/40 bg-slate-900 p-4"
            >
              <p className="text-sm font-semibold text-amber-300">장면 이미지 6장을 생성할까요?</p>
              <p className="text-sm text-slate-300">
                아직 생성이 시작되지 않았습니다. 확인을 누르면 로컬 가짜 어댑터가 이미지 6장을 생성하며, 실제 유료 요청은
                전송되지 않습니다.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 disabled:opacity-50"
                  onClick={cancelConfirmation}
                  disabled={generatePending}
                >
                  돌아가기
                </button>
                <button
                  type="button"
                  className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={() => void confirmGeneration()}
                  disabled={generatePending}
                >
                  {generatePending ? "생성 중..." : "예, 로컬 이미지 생성을 시작합니다"}
                </button>
              </div>
            </div>
          )}

          {generateError && (
            <p role="alert" data-testid="generate-error" data-error-code={generateError.code} className="text-sm text-rose-400">
              {generateError.message}
            </p>
          )}

          {result && (
            <p data-testid="generation-summary" className="text-sm text-emerald-400">
              생성 완료 · 새로 생성 {result.generatedSceneNumbers.length}장 · 기존 이미지 재사용{" "}
              {result.reusedSceneNumbers.length}장
            </p>
          )}

          {(reviewable || videoConfirmationReached) && (
            <div className="space-y-3 rounded-lg border border-white/10 p-4" data-testid="image-review-section">
              <h3 className="text-lg font-semibold">이미지 검토</h3>
              <p className="text-sm text-slate-300">각 장면의 이미지를 확인하고 개별적으로 승인해 주세요.</p>
              <p className="text-xs text-amber-300" data-testid="no-paid-regenerate-notice">
                재생성은 실제 유료 Provider를 호출하지 않는 로컬 가짜 어댑터만 사용하며, 이전 이미지는 버전 기록으로
                보존됩니다.
              </p>

              {reviewState.status === "loading" && <p className="text-slate-400">검토 상태를 불러오는 중...</p>}
              {reviewState.status === "error" && (
                <p role="alert" data-testid="review-load-error" data-error-code={reviewState.error.code} className="text-sm text-rose-400">
                  {reviewState.error.message}
                </p>
              )}

              {reviewState.status === "ready" && (
                <ul className="space-y-2" data-testid="review-list">
                  {reviewState.reviews.map((review) => {
                    const pending = approvePendingScenes.has(review.sceneNumber);
                    const approveError = approveErrors[review.sceneNumber];
                    const regeneratePending = regeneratePendingScenes.has(review.sceneNumber);
                    const regenerateError = regenerateErrors[review.sceneNumber];
                    const regenerateConfirmOpen = regenerateConfirmScene === review.sceneNumber;
                    return (
                      <li
                        key={review.sceneNumber}
                        data-testid={`review-${review.sceneNumber}`}
                        data-status={review.status}
                        className="flex gap-3"
                      >
                        <img
                          src={imageReviewContentUrl(projectId, review.sceneNumber, review.updatedAt)}
                          alt={`${review.sceneNumber}번 장면 이미지`}
                          data-testid={`review-image-${review.sceneNumber}`}
                          className="h-24 w-24 flex-shrink-0 rounded-md border border-white/10 bg-slate-800 object-cover"
                        />
                        <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-slate-300">
                            {review.sceneNumber}번 장면 · {review.status === "approved" ? "승인됨" : "검토 대기"}
                          </span>
                          <button
                            type="button"
                            className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                            onClick={() => void approveScene(review.sceneNumber)}
                            disabled={review.status === "approved" || pending}
                          >
                            {review.status === "approved" ? "승인 완료" : pending ? "승인 중..." : "승인"}
                          </button>
                        </div>
                        {approveError && (
                          <p
                            role="alert"
                            data-testid={`review-approve-error-${review.sceneNumber}`}
                            data-error-code={approveError.code}
                            className="text-sm text-rose-400"
                          >
                            {approveError.message}
                          </p>
                        )}

                        <div className="flex items-center justify-end gap-3">
                          <button
                            type="button"
                            data-testid={`review-regenerate-${review.sceneNumber}`}
                            className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200 disabled:opacity-50"
                            onClick={() => openRegenerateConfirmation(review.sceneNumber)}
                            disabled={regeneratePending || regenerateConfirmOpen}
                          >
                            {regeneratePending ? "재생성 중..." : "재생성"}
                          </button>
                        </div>

                        {regenerateConfirmOpen && (
                          <div
                            role="alertdialog"
                            aria-label={`${review.sceneNumber}번 장면 재생성 확인`}
                            data-testid={`regenerate-confirm-panel-${review.sceneNumber}`}
                            className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900 p-3"
                          >
                            <p className="text-sm font-semibold text-amber-300">
                              {review.sceneNumber}번 장면 이미지를 다시 생성할까요?
                            </p>
                            <p className="text-xs text-slate-300">
                              아직 재생성이 시작되지 않았습니다. 확인을 누르면 로컬 가짜 어댑터가 이 장면 이미지만 다시
                              생성하며, 실제 유료 요청은 전송되지 않습니다.
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 disabled:opacity-50"
                                onClick={() => cancelRegenerateConfirmation(review.sceneNumber)}
                                disabled={regeneratePending}
                              >
                                취소
                              </button>
                              <button
                                type="button"
                                className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                                onClick={() => void confirmRegenerate(review.sceneNumber)}
                                disabled={regeneratePending}
                              >
                                {regeneratePending ? "재생성 중..." : "예, 로컬로 재생성합니다"}
                              </button>
                            </div>
                          </div>
                        )}

                        {regenerateError && (
                          <p
                            role="alert"
                            data-testid={`review-regenerate-error-${review.sceneNumber}`}
                            data-error-code={regenerateError.code}
                            className="text-sm text-rose-400"
                          >
                            {regenerateError.message}
                          </p>
                        )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {videoConfirmationReached && (
            <p data-testid="video-confirmation-transition" className="text-sm text-emerald-400">
              장면 이미지 6장이 모두 승인되어 영상 생성 확인 단계로 이동했습니다.
            </p>
          )}
        </>
      )}
    </section>
  );
}
