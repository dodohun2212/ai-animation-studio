import { useEffect, useRef, useState } from "react";
import type { GenerationProgressResponse, SceneNumber, VideoReview } from "@ai-animation-studio/shared";

import {
  approveVideoReview,
  getVideoProgress,
  getVideoReview,
  regenerateAllVideoScenes,
  regenerateVideoScene,
  restartVideoGeneration,
  stopVideoGeneration,
  toVideoWorkflowDisplayError,
  videoReviewContentUrl,
} from "../api/videoWorkflowApi.js";

interface Props {
  projectId: string;
  jobId: string;
  onBack: () => void;
  onOpenMerge?: (projectId: string) => void;
}

type DisplayError = { code: string; message: string };

type ProgressLoadState =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; progress: GenerationProgressResponse };

type ReviewLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; reviews: VideoReview[] };

const SCENE_NUMBERS = [1, 2, 3, 4, 5, 6] as const satisfies readonly SceneNumber[];
const POLL_INTERVAL_MS = 400;

const STATUS_LABEL: Record<GenerationProgressResponse["status"], string> = {
  created: "생성 대기 중",
  running: "진행 중",
  succeeded: "완료",
  failed: "실패",
  interrupted: "중지됨",
};

function sceneStatus(
  sceneNumber: SceneNumber,
  progress: GenerationProgressResponse,
): "completed" | "running" | "failed" | "pending" {
  if (progress.completedSceneNumbers.includes(sceneNumber)) return "completed";
  if (progress.currentSceneNumber === sceneNumber) return "running";
  if (progress.failedSceneNumbers.includes(sceneNumber)) return "failed";
  return "pending";
}

export function VideoWorkflowScreen({ projectId, jobId, onBack, onOpenMerge }: Props) {
  const [progressState, setProgressState] = useState<ProgressLoadState>({ status: "loading" });
  const [reviewState, setReviewState] = useState<ReviewLoadState>({ status: "idle" });

  const [stopPending, setStopPending] = useState(false);
  const [stopError, setStopError] = useState<DisplayError | null>(null);
  const [restartPending, setRestartPending] = useState(false);
  const [restartError, setRestartError] = useState<DisplayError | null>(null);

  const [approvePendingScenes, setApprovePendingScenes] = useState<Set<SceneNumber>>(new Set());
  const [approveErrors, setApproveErrors] = useState<Partial<Record<SceneNumber, DisplayError>>>({});

  const [regenerateConfirmScene, setRegenerateConfirmScene] = useState<SceneNumber | null>(null);
  const [regeneratePendingScenes, setRegeneratePendingScenes] = useState<Set<SceneNumber>>(new Set());
  const [regenerateErrors, setRegenerateErrors] = useState<Partial<Record<SceneNumber, DisplayError>>>({});

  const [regenerateAllConfirmOpen, setRegenerateAllConfirmOpen] = useState(false);
  const [regenerateAllPending, setRegenerateAllPending] = useState(false);
  const [regenerateAllError, setRegenerateAllError] = useState<DisplayError | null>(null);

  const progressRequest = useRef(0);
  const reviewRequest = useRef(0);
  const stopBusy = useRef(false);
  const restartBusy = useRef(false);
  const approveBusy = useRef<Set<SceneNumber>>(new Set());
  const regenerateBusy = useRef<Set<SceneNumber>>(new Set());
  const regenerateAllBusy = useRef(false);

  async function fetchProgress(showLoading: boolean): Promise<void> {
    const requestId = ++progressRequest.current;
    if (showLoading) setProgressState({ status: "loading" });
    try {
      const progress = await getVideoProgress(projectId, jobId);
      if (requestId !== progressRequest.current) return;
      setProgressState({ status: "ready", progress });
    } catch (caught) {
      if (requestId !== progressRequest.current) return;
      setProgressState({ status: "error", error: toVideoWorkflowDisplayError(caught) });
    }
  }

  useEffect(() => {
    setReviewState({ status: "idle" });
    setStopError(null);
    setRestartError(null);
    setApproveErrors({});
    setRegenerateConfirmScene(null);
    setRegenerateErrors({});
    setRegenerateAllConfirmOpen(false);
    setRegenerateAllError(null);
    void fetchProgress(true);
  }, [projectId, jobId]);

  // Local-only sequential polling: re-checks persisted progress while a scene is still being
  // written, and stops itself as soon as the job reaches a terminal status.
  useEffect(() => {
    if (progressState.status !== "ready") return;
    if (progressState.progress.status !== "created" && progressState.progress.status !== "running") return;
    const timer = setTimeout(() => {
      void fetchProgress(false);
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [progressState]);

  const succeeded = progressState.status === "ready" && progressState.progress.status === "succeeded";

  useEffect(() => {
    if (!succeeded || reviewState.status !== "idle") return;
    const requestId = ++reviewRequest.current;
    setReviewState({ status: "loading" });
    getVideoReview(projectId, jobId)
      .then((response) => {
        if (requestId !== reviewRequest.current) return;
        setReviewState({ status: "ready", reviews: response.reviews });
      })
      .catch((caught: unknown) => {
        if (requestId !== reviewRequest.current) return;
        setReviewState({ status: "error", error: toVideoWorkflowDisplayError(caught) });
      });
  }, [succeeded, reviewState.status, projectId, jobId]);

  async function stop(): Promise<void> {
    if (stopBusy.current) return;
    stopBusy.current = true;
    setStopPending(true);
    setStopError(null);
    try {
      const progress = await stopVideoGeneration(projectId, jobId);
      setProgressState({ status: "ready", progress });
    } catch (caught) {
      setStopError(toVideoWorkflowDisplayError(caught));
      void fetchProgress(false);
    } finally {
      stopBusy.current = false;
      setStopPending(false);
    }
  }

  async function restart(): Promise<void> {
    if (restartBusy.current) return;
    restartBusy.current = true;
    setRestartPending(true);
    setRestartError(null);
    try {
      const progress = await restartVideoGeneration(projectId, jobId);
      setProgressState({ status: "ready", progress });
    } catch (caught) {
      setRestartError(toVideoWorkflowDisplayError(caught));
      void fetchProgress(false);
    } finally {
      restartBusy.current = false;
      setRestartPending(false);
    }
  }

  async function approve(sceneNumber: SceneNumber): Promise<void> {
    if (approveBusy.current.has(sceneNumber)) return;
    approveBusy.current.add(sceneNumber);
    setApprovePendingScenes(new Set(approveBusy.current));
    try {
      const response = await approveVideoReview(projectId, jobId, sceneNumber);
      setReviewState({ status: "ready", reviews: response.reviews });
      setApproveErrors((current) => {
        if (!(sceneNumber in current)) return current;
        const next = { ...current };
        delete next[sceneNumber];
        return next;
      });
    } catch (caught) {
      setApproveErrors((current) => ({ ...current, [sceneNumber]: toVideoWorkflowDisplayError(caught) }));
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
      const response = await regenerateVideoScene(projectId, jobId, sceneNumber);
      setProgressState({ status: "ready", progress: response });
      setReviewState({ status: "idle" });
      setRegenerateConfirmScene(null);
      setRegenerateErrors((current) => {
        if (!(sceneNumber in current)) return current;
        const next = { ...current };
        delete next[sceneNumber];
        return next;
      });
    } catch (caught) {
      setRegenerateErrors((current) => ({ ...current, [sceneNumber]: toVideoWorkflowDisplayError(caught) }));
      void fetchProgress(false);
    } finally {
      regenerateBusy.current.delete(sceneNumber);
      setRegeneratePendingScenes(new Set(regenerateBusy.current));
    }
  }

  function openRegenerateAllConfirmation(): void {
    if (regenerateAllBusy.current) return;
    setRegenerateAllError(null);
    setRegenerateAllConfirmOpen(true);
  }

  function cancelRegenerateAllConfirmation(): void {
    if (regenerateAllBusy.current) return;
    setRegenerateAllConfirmOpen(false);
  }

  async function confirmRegenerateAll(): Promise<void> {
    if (regenerateAllBusy.current) return;
    regenerateAllBusy.current = true;
    setRegenerateAllPending(true);
    setRegenerateAllError(null);
    try {
      const response = await regenerateAllVideoScenes(projectId, jobId);
      setProgressState({ status: "ready", progress: response });
      setReviewState({ status: "idle" });
      setRegenerateAllConfirmOpen(false);
    } catch (caught) {
      setRegenerateAllError(toVideoWorkflowDisplayError(caught));
      void fetchProgress(false);
    } finally {
      regenerateAllBusy.current = false;
      setRegenerateAllPending(false);
    }
  }

  const progress = progressState.status === "ready" ? progressState.progress : null;
  const canStop = progress?.status === "created" || progress?.status === "running";
  const canRestart = progress?.status === "interrupted";
  const reviewable = progress?.status === "succeeded";
  const allApproved = reviewState.status === "ready" && reviewState.reviews.every((review) => review.status === "approved");

  return (
    <section className="mt-8 space-y-4">
      <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300" onClick={onBack}>
        프로젝트로 돌아가기
      </button>
      <h2 className="text-xl font-semibold">영상 생성 진행 상황</h2>
      <p className="text-sm text-amber-300" data-testid="no-provider-notice">
        실제 유료 Runway API와 영상 병합 프로그램을 호출하지 않습니다. 로컬 가짜(local fake) 어댑터가 장면 영상을 순서대로 만듭니다.
      </p>

      {progressState.status === "loading" && <p className="text-slate-400">진행 상황을 불러오는 중...</p>}
      {progressState.status === "error" && (
        <div className="space-y-2">
          <p role="alert" data-testid="progress-error" data-error-code={progressState.error.code} className="text-sm text-rose-400">
            {progressState.error.message}
          </p>
          <button
            type="button"
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300"
            onClick={() => void fetchProgress(true)}
          >
            다시 시도
          </button>
        </div>
      )}

      {progress && (
        <>
          <p className="text-sm font-semibold text-slate-200" data-testid="workflow-status">
            상태: {STATUS_LABEL[progress.status]}
            {progress.status === "running" && progress.currentSceneNumber
              ? ` · 현재 ${progress.currentSceneNumber}번 장면`
              : ""}
          </p>

          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300" data-testid="scene-progress-list">
            {SCENE_NUMBERS.map((number) => (
              <li key={number} data-testid={`scene-progress-${number}`} data-status={sceneStatus(number, progress)}>
                {number}번 장면 ·{" "}
                {
                  { completed: "완료", running: "진행 중", failed: "실패", pending: "대기" }[
                    sceneStatus(number, progress)
                  ]
                }
              </li>
            ))}
          </ol>

          {progress.status === "interrupted" && (
            <p className="text-sm text-amber-300" data-testid="interrupted-notice">
              중지되었습니다. 완료된 장면은 보존되며, 이후 장면은 재개하기 전까지 생성되지 않습니다.
            </p>
          )}

          {progress.status === "failed" && (
            <div className="space-y-3 rounded-lg border border-rose-400/40 p-4" data-testid="failed-scenes-section">
              <p className="text-sm font-semibold text-rose-300">
                일부 장면 생성에 실패했습니다. 아래에서 실패한 장면을 다시 시도할 수 있습니다.
              </p>
              <ul className="space-y-2" data-testid="failed-scenes-list">
                {progress.failedSceneNumbers.map((sceneNumber) => {
                  const regeneratePending = regeneratePendingScenes.has(sceneNumber);
                  const regenerateError = regenerateErrors[sceneNumber];
                  const regenerateConfirmOpen = regenerateConfirmScene === sceneNumber;
                  return (
                    <li key={sceneNumber} data-testid={`failed-scene-${sceneNumber}`} className="space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-slate-300">{sceneNumber}번 장면</span>
                        <button
                          type="button"
                          data-testid={`failed-scene-retry-${sceneNumber}`}
                          className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200 disabled:opacity-50"
                          onClick={() => openRegenerateConfirmation(sceneNumber)}
                          disabled={regeneratePending || regenerateConfirmOpen}
                        >
                          {regeneratePending ? "다시 시도 중..." : "다시 시도"}
                        </button>
                      </div>
                      {regenerateConfirmOpen && (
                        <div
                          role="alertdialog"
                          aria-label={`${sceneNumber}번 장면 다시 시도 확인`}
                          data-testid={`failed-scene-retry-confirm-${sceneNumber}`}
                          className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900 p-3"
                        >
                          <p className="text-sm font-semibold text-amber-300">{sceneNumber}번 장면을 다시 시도할까요?</p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 disabled:opacity-50"
                              onClick={() => cancelRegenerateConfirmation(sceneNumber)}
                              disabled={regeneratePending}
                            >
                              취소
                            </button>
                            <button
                              type="button"
                              className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                              onClick={() => void confirmRegenerate(sceneNumber)}
                              disabled={regeneratePending}
                            >
                              {regeneratePending ? "다시 시도 중..." : "예, 다시 시도합니다"}
                            </button>
                          </div>
                        </div>
                      )}
                      {regenerateError && (
                        <p
                          role="alert"
                          data-testid={`failed-scene-retry-error-${sceneNumber}`}
                          data-error-code={regenerateError.code}
                          className="text-sm text-rose-400"
                        >
                          {regenerateError.message}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {canStop && (
            <div className="space-y-1">
              <p className="text-xs text-slate-400">중지하면 현재 장면 이후의 새 장면은 생성되지 않습니다.</p>
              <button
                type="button"
                className="rounded-full border border-rose-400/40 px-4 py-2 text-sm text-rose-300 disabled:opacity-50"
                data-testid="stop-button"
                onClick={() => void stop()}
                disabled={stopPending}
              >
                {stopPending ? "중지 중..." : "생성 중지"}
              </button>
            </div>
          )}
          {stopError && (
            <p role="alert" data-testid="stop-error" data-error-code={stopError.code} className="text-sm text-rose-400">
              {stopError.message}
            </p>
          )}

          {canRestart && (
            <button
              type="button"
              className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              data-testid="restart-button"
              onClick={() => void restart()}
              disabled={restartPending}
            >
              {restartPending ? "재개 중..." : "이어서 생성"}
            </button>
          )}
          {restartError && (
            <p role="alert" data-testid="restart-error" data-error-code={restartError.code} className="text-sm text-rose-400">
              {restartError.message}
            </p>
          )}

          {reviewable && (
            <div className="space-y-3 rounded-lg border border-white/10 p-4" data-testid="video-review-section">
              <h3 className="text-lg font-semibold">영상 검토</h3>
              <p className="text-sm text-slate-300">각 장면의 영상을 확인하고 개별적으로 승인해 주세요.</p>
              <p className="text-xs text-amber-300" data-testid="no-provider-regenerate-notice">
                재생성은 실제 유료 Provider를 호출하지 않는 로컬 가짜 어댑터만 사용하며, 이전 영상은 history로 보존됩니다.
              </p>

              {reviewState.status === "loading" && <p className="text-slate-400">검토 상태를 불러오는 중...</p>}
              {reviewState.status === "error" && (
                <p role="alert" data-testid="review-load-error" data-error-code={reviewState.error.code} className="text-sm text-rose-400">
                  {reviewState.error.message}
                </p>
              )}

              {reviewState.status === "ready" && (
                <>
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200 disabled:opacity-50"
                      data-testid="regenerate-all-button"
                      onClick={openRegenerateAllConfirmation}
                      disabled={regenerateAllPending || regenerateAllConfirmOpen}
                    >
                      {regenerateAllPending ? "전체 재생성 중..." : "전체 재생성"}
                    </button>
                  </div>

                  {regenerateAllConfirmOpen && (
                    <div
                      role="alertdialog"
                      aria-label="전체 장면 재생성 확인"
                      data-testid="regenerate-all-confirm-panel"
                      className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900 p-3"
                    >
                      <p className="text-sm font-semibold text-amber-300">6개 장면 영상을 모두 다시 생성할까요?</p>
                      <p className="text-xs text-slate-300">
                        아직 재생성이 시작되지 않았습니다. 확인을 누르면 로컬 가짜 어댑터가 6개 장면 영상을 모두 다시
                        생성하며, 실제 유료 요청은 전송되지 않습니다. 기존 승인 상태는 초기화됩니다.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 disabled:opacity-50"
                          onClick={cancelRegenerateAllConfirmation}
                          disabled={regenerateAllPending}
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                          onClick={() => void confirmRegenerateAll()}
                          disabled={regenerateAllPending}
                        >
                          {regenerateAllPending ? "재생성 중..." : "예, 로컬로 전체 재생성합니다"}
                        </button>
                      </div>
                    </div>
                  )}
                  {regenerateAllError && (
                    <p role="alert" data-testid="regenerate-all-error" data-error-code={regenerateAllError.code} className="text-sm text-rose-400">
                      {regenerateAllError.message}
                    </p>
                  )}

                  <ul className="space-y-2" data-testid="video-review-list">
                    {reviewState.reviews.map((review) => {
                      const pending = approvePendingScenes.has(review.sceneNumber);
                      const approveError = approveErrors[review.sceneNumber];
                      const regeneratePending = regeneratePendingScenes.has(review.sceneNumber);
                      const regenerateError = regenerateErrors[review.sceneNumber];
                      const regenerateConfirmOpen = regenerateConfirmScene === review.sceneNumber;
                      return (
                        <li
                          key={review.sceneNumber}
                          data-testid={`video-review-${review.sceneNumber}`}
                          data-status={review.status}
                          className="flex gap-3"
                        >
                          <video
                            src={videoReviewContentUrl(projectId, review.sceneNumber, review.updatedAt)}
                            data-testid={`video-review-clip-${review.sceneNumber}`}
                            className="h-24 w-24 flex-shrink-0 rounded-md border border-white/10 bg-slate-800 object-cover"
                            controls
                            muted
                            preload="metadata"
                          />
                          <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm text-slate-300">
                              {review.sceneNumber}번 장면 · {review.status === "approved" ? "승인됨" : "검토 대기"}
                            </span>
                            <button
                              type="button"
                              className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                              onClick={() => void approve(review.sceneNumber)}
                              disabled={review.status === "approved" || pending}
                            >
                              {review.status === "approved" ? "승인 완료" : pending ? "승인 중..." : "승인"}
                            </button>
                          </div>
                          {approveError && (
                            <p
                              role="alert"
                              data-testid={`video-review-approve-error-${review.sceneNumber}`}
                              data-error-code={approveError.code}
                              className="text-sm text-rose-400"
                            >
                              {approveError.message}
                            </p>
                          )}

                          <div className="flex items-center justify-end gap-3">
                            <button
                              type="button"
                              data-testid={`video-review-regenerate-${review.sceneNumber}`}
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
                              data-testid={`video-regenerate-confirm-panel-${review.sceneNumber}`}
                              className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900 p-3"
                            >
                              <p className="text-sm font-semibold text-amber-300">
                                {review.sceneNumber}번 장면 영상을 다시 생성할까요?
                              </p>
                              <p className="text-xs text-slate-300">
                                아직 재생성이 시작되지 않았습니다. 확인을 누르면 로컬 가짜 어댑터가 이 장면 영상만 다시
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
                              data-testid={`video-review-regenerate-error-${review.sceneNumber}`}
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

                  {allApproved && (
                    <div className="space-y-3">
                      <p data-testid="all-scenes-approved" className="text-sm font-semibold text-emerald-400">
                        6개 장면 영상이 모두 승인되었습니다.
                      </p>
                      <button
                        type="button"
                        className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white"
                        data-testid="open-video-merge-button"
                        onClick={() => onOpenMerge?.(projectId)}
                      >
                        최종 영상으로 병합하기
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
