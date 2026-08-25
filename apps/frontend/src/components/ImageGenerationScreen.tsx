import { useEffect, useRef, useState } from "react";
import type { BudgetPreview, ImageReview, Project, SceneNumber, StartImageGenerationResponse } from "@ai-animation-studio/shared";
import { IMAGE_ESTIMATED_COST_USD, WorkflowState, sceneNumbersFor } from "@ai-animation-studio/shared";

import { getProject, toDisplayError } from "../api/projectsApi.js";
import { startImageGeneration, toImageGenerationDisplayError } from "../api/imageGenerationApi.js";
import {
  approveImageReview,
  getImageReview,
  imageReviewContentUrl,
  regenerateImageReview,
  toImageReviewDisplayError,
} from "../api/imageReviewApi.js";
import { Spinner } from "./Spinner.js";
import { StatusChip } from "./ui/StatusChip.js";
import { RetryCostNotice } from "./ui/RetryCostNotice.js";
import { BudgetLine } from "./ui/BudgetLine.js";

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
  | { status: "ready"; reviews: ImageReview[]; budget?: BudgetPreview; retryEstimate?: { perSceneCostUsd: number; budget: BudgetPreview } };

const primaryButton =
  "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";
const smallOutlineButton =
  "rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50";
const smallApproveButton =
  "rounded-full border border-emerald-400/30 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50";
const smallAmberButton =
  "rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-400 disabled:opacity-50";

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
  // The scene grid/count follows the project's own scenes array (2-12, see docs/02_MIGRATION_PLAN.md) rather than
  // an assumed fixed six.
  const sceneNumbers = currentProject ? sceneNumbersFor(currentProject.scenes.length) : [];
  const totalScenes = sceneNumbers.length;
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
        setReviewState({ status: "ready", reviews: response.reviews, budget: response.budget });
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
      setReviewState((current) => ({
        status: "ready",
        reviews: response.reviews,
        budget: current.status === "ready" ? current.budget : undefined,
        retryEstimate: current.status === "ready" ? current.retryEstimate : undefined,
      }));
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
      setReviewState({ status: "ready", reviews: response.reviews, budget: response.retryEstimate?.budget, retryEstimate: response.retryEstimate });
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
    <section className="mt-8 max-w-3xl space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>
        프로젝트로 돌아가기
      </button>
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        장면 이미지 생성
      </h1>

      {state.status === "loading" && <Spinner label="불러오는 중..." />}
      {state.status === "error" && (
        <p role="alert" data-testid="load-error" data-error-code={state.error.code} className="text-sm text-rose-400">
          {state.error.message}
        </p>
      )}

      {currentProject && (
        <>
          <p className="text-sm text-amber-300" data-testid="provider-mode-notice">
            OpenAI 키가 연결되어 있으면 장면 이미지 {totalScenes}장에 대해 실제 유료 요청이 전송됩니다. 연결되어 있지 않으면
            비용 없이 임시 이미지로 생성됩니다.
          </p>

          {!allowed && !reviewable && !videoConfirmationReached && !result && (
            <p className="text-sm text-slate-400" data-testid="not-allowed">
              이미지 생성은 Asset Mapping이 승인된 프로젝트에서만 가능합니다. 현재 상태: {currentProject.workflowState}
            </p>
          )}

          <ol className="grid gap-2 sm:grid-cols-2" data-testid="scene-results">
            {sceneNumbers.map((number) => (
              <li
                key={number}
                data-testid={`scene-${number}`}
                data-status={sceneStatus(number)}
                className={`rounded-lg border p-2.5 text-sm ${
                  sceneStatus(number) === "completed" ? "border-emerald-400/30 text-emerald-300" : "border-white/10 text-slate-300"
                }`}
              >
                {number}번 장면 · {sceneStatus(number) === "completed" ? "완료" : "대기"}
              </li>
            ))}
          </ol>

          {allowed && !result && (
            <button type="button" className={primaryButton} onClick={openConfirmation} disabled={confirmOpen}>
              이미지 생성 시작
            </button>
          )}

          {confirmOpen && (
            <div
              role="alertdialog"
              aria-label="장면 이미지 생성 확인"
              data-testid="generate-confirm-panel"
              className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4"
            >
              <p className="text-sm font-semibold text-amber-300">장면 이미지 {totalScenes}장을 생성할까요?</p>
              <p className="text-sm text-slate-300">
                아직 생성이 시작되지 않았습니다. OpenAI 키가 연결되어 있으면 확인을 누르는 순간 이미지 {totalScenes}장에 대한
                실제 유료 요청이 전송됩니다. 키가 연결되어 있지 않으면 비용 없이 임시 이미지로 생성됩니다.
              </p>
              <p data-testid="generate-cost-estimate" className="text-xs text-slate-300 tabular-nums">
                예상 비용: ${(totalScenes * IMAGE_ESTIMATED_COST_USD).toFixed(2)} ({totalScenes}장 × $
                {IMAGE_ESTIMATED_COST_USD.toFixed(2)}) · 키가 연결되어 있을 때만 청구됩니다
              </p>
              <div className="flex gap-3">
                <button type="button" className={outlineButton} onClick={cancelConfirmation} disabled={generatePending}>
                  돌아가기
                </button>
                <button type="button" className={primaryButton} onClick={() => void confirmGeneration()} disabled={generatePending}>
                  {generatePending ? "생성 중..." : "예, 이미지 생성을 시작합니다"}
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
            <div className="space-y-1.5">
              <p data-testid="generation-summary" className="text-sm font-semibold text-emerald-400">
                생성 완료 · 새로 생성 {result.generatedSceneNumbers.length}장 · 기존 이미지 재사용{" "}
                {result.reusedSceneNumbers.length}장
              </p>
              <BudgetLine budget={result.budget} data-testid="generation-budget" />
            </div>
          )}

          {(reviewable || videoConfirmationReached) && (
            <div className={cardSection} data-testid="image-review-section">
              <h3 className="flex items-center gap-2.5 text-base font-semibold">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
                />
                이미지 검토
              </h3>
              <p className="text-sm text-slate-300">각 장면의 이미지를 확인하고 개별적으로 승인해 주세요.</p>
              <p className="text-xs text-amber-300" data-testid="regenerate-cost-notice">
                재생성은 장면 1개당 한 번 더 청구됩니다(OpenAI 키가 연결된 경우). 이전 이미지는 버전 기록으로 보존됩니다.
              </p>
              {reviewState.status === "ready" && (
                <BudgetLine budget={reviewState.budget} data-testid="review-budget" />
              )}

              {reviewState.status === "loading" && <Spinner label="검토 상태를 불러오는 중..." />}
              {reviewState.status === "error" && (
                <p role="alert" data-testid="review-load-error" data-error-code={reviewState.error.code} className="text-sm text-rose-400">
                  {reviewState.error.message}
                </p>
              )}

              {reviewState.status === "ready" && (
                <>
                  {/* §4.3: overall confirmation progress is stated before the grid. */}
                  <p className="text-sm text-slate-300 tabular-nums" data-testid="image-review-progress-summary">
                    {reviewState.reviews.length}장면 중{" "}
                    {reviewState.reviews.filter((review) => review.status === "approved").length}장면 확정
                  </p>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="review-list">
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
                        className={`space-y-2 rounded-xl border bg-slate-950/40 p-3 ${
                          review.status === "approved" ? "border-emerald-400/30" : "border-white/10"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-100">{review.sceneNumber}번 장면</span>
                          <StatusChip tone={review.status === "approved" ? "success" : "neutral"}>
                            {review.status === "approved" ? "확정됨" : "검토 대기"}
                          </StatusChip>
                        </div>
                        {/* 9:16 keeps the thumbnail in the aspect ratio the Reel is actually produced in (§4.2). */}
                        <img
                          src={imageReviewContentUrl(projectId, review.sceneNumber, review.updatedAt)}
                          alt={`${review.sceneNumber}번 장면 이미지`}
                          data-testid={`review-image-${review.sceneNumber}`}
                          className="aspect-[9/16] w-full rounded-xl border border-white/10 bg-slate-800 object-cover"
                        />
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              type="button"
                              className={smallApproveButton}
                              onClick={() => void approveScene(review.sceneNumber)}
                              disabled={review.status === "approved" || pending}
                            >
                              {review.status === "approved" ? "확정 완료" : pending ? "확정 중..." : "이 이미지로 확정"}
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
                              className={smallOutlineButton}
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
                              className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3"
                            >
                              <p className="text-sm font-semibold text-amber-300">
                                {review.sceneNumber}번 장면 이미지를 다시 생성할까요?
                              </p>
                              <p className="text-xs text-slate-300">
                                아직 재생성이 시작되지 않았습니다. 확인을 누르면 이 장면 이미지만 다시 생성합니다 — OpenAI
                                키가 연결되어 있으면 이번 재생성분이 실제로 청구됩니다.
                              </p>
                              <RetryCostNotice
                                estimate={reviewState.status === "ready" ? reviewState.retryEstimate : undefined}
                                sceneCount={1}
                                data-testid={`regenerate-cost-${review.sceneNumber}`}
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  className={smallOutlineButton}
                                  onClick={() => cancelRegenerateConfirmation(review.sceneNumber)}
                                  disabled={regeneratePending}
                                >
                                  취소
                                </button>
                                <button
                                  type="button"
                                  className={smallAmberButton}
                                  onClick={() => void confirmRegenerate(review.sceneNumber)}
                                  disabled={regeneratePending}
                                >
                                  {regeneratePending ? "재생성 중..." : "예, 다시 생성합니다"}
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
                </>
              )}
            </div>
          )}

          {videoConfirmationReached && (
            <p data-testid="video-confirmation-transition" className="text-sm font-semibold text-emerald-400">
              장면 이미지 {totalScenes}장이 모두 승인되어 영상 생성 확인 단계로 이동했습니다.
            </p>
          )}
        </>
      )}
    </section>
  );
}
