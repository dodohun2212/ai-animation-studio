import { useEffect, useRef, useState } from "react";
import type { GenerationProgressResponse, Scene, SceneNumber, VideoReview, SceneStaleness } from "@ai-animation-studio/shared";

import {
  approveVideoReview,
  getVideoProgress,
  getVideoReview,
  regenerateAllVideoScenes,
  regenerateVideoScene,
  restartVideoGeneration,
  sceneErrorMessage,
  sceneImageContentUrl,
  stopVideoGeneration,
  toVideoWorkflowDisplayError,
  videoReviewContentUrl,
} from "../api/videoWorkflowApi.js";
import { Spinner } from "./Spinner.js";
import { RetryCostNotice } from "./ui/RetryCostNotice.js";
import { StaleBadge } from "./ui/StaleBadge.js";
import { RegenerateInstructionField } from "./ui/RegenerateInstructionField.js";
import { StatusChip, type StatusTone } from "./ui/StatusChip.js";

type SceneStatus = "completed" | "running" | "failed" | "pending";

const SCENE_STATUS_LABEL: Record<SceneStatus, string> = {
  completed: "완료",
  running: "진행 중",
  failed: "실패",
  pending: "대기",
};

/** Status grammar per design system §2.1 — amber is "in progress", never violet. */
const SCENE_STATUS_TONE: Record<SceneStatus, StatusTone> = {
  completed: "success",
  running: "progress",
  failed: "danger",
  pending: "neutral",
};

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
  // `scenes` comes from the same response's `project` — it carries the source image path and the final
  // motion prompt each clip was generated from, both of which the review step must show.
  | { status: "ready"; reviews: VideoReview[]; scenes: Scene[]; staleness?: SceneStaleness };

const POLL_INTERVAL_MS = 400;

const STATUS_LABEL: Record<GenerationProgressResponse["status"], string> = {
  created: "생성 대기 중",
  running: "진행 중",
  succeeded: "완료",
  failed: "실패",
  interrupted: "중지됨",
};

const primaryButton =
  "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const dangerOutlineButton =
  "rounded-full border border-rose-400/30 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/10 disabled:opacity-50";
const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";
const smallOutlineButton =
  "rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50";
const smallApproveButton =
  "rounded-full border border-emerald-400/30 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50";
const smallAmberButton =
  "rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-400 disabled:opacity-50";

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
  /** One-off direction for the open single-scene confirmation; cleared whenever that panel opens or closes. */
  const [regenerateInstruction, setRegenerateInstruction] = useState("");
  /** Kept separate from the per-scene one: regenerate-all applies its direction to every scene at once. */
  const [regenerateAllInstruction, setRegenerateAllInstruction] = useState("");
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
        setReviewState({ status: "ready", reviews: response.reviews, scenes: response.project.scenes, staleness: response.staleness });
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
      setReviewState((current) => ({ status: "ready", reviews: response.reviews, scenes: response.project.scenes, staleness: current.status === "ready" ? current.staleness : undefined }));
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
    setRegenerateInstruction("");
    setRegenerateConfirmScene(sceneNumber);
  }

  function cancelRegenerateConfirmation(sceneNumber: SceneNumber): void {
    if (regenerateBusy.current.has(sceneNumber)) return;
    setRegenerateInstruction("");
    setRegenerateConfirmScene((current) => (current === sceneNumber ? null : current));
  }

  async function confirmRegenerate(sceneNumber: SceneNumber): Promise<void> {
    if (regenerateBusy.current.has(sceneNumber)) return;
    regenerateBusy.current.add(sceneNumber);
    setRegeneratePendingScenes(new Set(regenerateBusy.current));
    try {
      const response = await regenerateVideoScene(projectId, jobId, sceneNumber, regenerateInstruction);
      setProgressState({ status: "ready", progress: response });
      setReviewState({ status: "idle" });
      setRegenerateConfirmScene(null);
      setRegenerateInstruction("");
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
    setRegenerateAllInstruction("");
    setRegenerateAllConfirmOpen(true);
  }

  function cancelRegenerateAllConfirmation(): void {
    if (regenerateAllBusy.current) return;
    setRegenerateAllInstruction("");
    setRegenerateAllConfirmOpen(false);
  }

  async function confirmRegenerateAll(): Promise<void> {
    if (regenerateAllBusy.current) return;
    regenerateAllBusy.current = true;
    setRegenerateAllPending(true);
    setRegenerateAllError(null);
    try {
      const response = await regenerateAllVideoScenes(projectId, jobId, regenerateAllInstruction);
      setProgressState({ status: "ready", progress: response });
      setReviewState({ status: "idle" });
      setRegenerateAllConfirmOpen(false);
      setRegenerateAllInstruction("");
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
  const totalScenes = progress?.sceneNumbers.length ?? 0;

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
        영상 생성 진행 상황
      </h1>
      <p className="text-sm text-amber-300" data-testid="provider-mode-notice">
        {progress?.retryEstimate
          ? "이 작업은 실제 유료 Runway API를 호출합니다. 장면마다 비용이 발생하며, 재생성하면 그만큼 다시 청구됩니다."
          : "Runway 키가 연결되어 있지 않아 비용 없이 임시 영상으로 만들어집니다. 키를 연결하면 실제 유료 요청이 전송됩니다."}
      </p>

      {progressState.status === "loading" && <Spinner label="진행 상황을 불러오는 중..." />}
      {progressState.status === "error" && (
        <div className="space-y-2">
          <p role="alert" data-testid="progress-error" data-error-code={progressState.error.code} className="text-sm text-rose-400">
            {progressState.error.message}
          </p>
          <button type="button" className={outlineButton} onClick={() => void fetchProgress(true)}>
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

          {/* Design system §4.2: scenes are always a 9:16 thumbnail grid, so the sequence reads as the
              vertical Reel it will become — not as a flat text list. */}
          <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="scene-progress-list">
            {progress.sceneNumbers.map((number) => {
              const status = sceneStatus(number, progress);
              const tone = SCENE_STATUS_TONE[status];
              return (
                <li
                  key={number}
                  data-testid={`scene-progress-${number}`}
                  data-status={status}
                  className={`space-y-2 rounded-xl border bg-slate-950/40 p-3 ${
                    status === "running" ? "border-amber-400/40" : status === "failed" ? "border-rose-400/30" : "border-white/10"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-100">{number}번 장면</span>
                    <StatusChip tone={tone}>{SCENE_STATUS_LABEL[status]}</StatusChip>
                  </div>
                  <img
                    src={sceneImageContentUrl(projectId, number)}
                    alt=""
                    aria-hidden="true"
                    className={`aspect-[9/16] w-full rounded-xl border border-white/10 bg-slate-800 object-cover ${
                      status === "pending" ? "opacity-40" : ""
                    }`}
                  />
                </li>
              );
            })}
          </ol>

          {progress.status === "interrupted" && (
            <p className="text-sm text-amber-300" data-testid="interrupted-notice">
              중지되었습니다. 완료된 장면은 보존되며, 이후 장면은 재개하기 전까지 생성되지 않습니다.
            </p>
          )}

          {progress.status === "failed" && (
            <div className="space-y-3 rounded-2xl border border-rose-400/30 bg-rose-950/10 p-5" data-testid="failed-scenes-section">
              <p className="text-sm font-semibold text-rose-300">
                일부 장면 생성에 실패했습니다. 아래에서 실패한 장면을 다시 시도할 수 있습니다.
              </p>
              <ul className="space-y-2" data-testid="failed-scenes-list">
                {progress.failedSceneNumbers.map((sceneNumber) => {
                  const regeneratePending = regeneratePendingScenes.has(sceneNumber);
                  const regenerateError = regenerateErrors[sceneNumber];
                  const regenerateConfirmOpen = regenerateConfirmScene === sceneNumber;
                  return (
                    <li key={sceneNumber} data-testid={`failed-scene-${sceneNumber}`} className="space-y-1.5 rounded-xl border border-white/10 bg-slate-950/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-slate-300">{sceneNumber}번 장면</span>
                        <button
                          type="button"
                          data-testid={`failed-scene-retry-${sceneNumber}`}
                          className={smallOutlineButton}
                          onClick={() => openRegenerateConfirmation(sceneNumber)}
                          disabled={regeneratePending || regenerateConfirmOpen}
                        >
                          {regeneratePending ? "다시 시도 중..." : "다시 시도"}
                        </button>
                      </div>
                      <p data-testid={`failed-scene-reason-${sceneNumber}`} className="text-xs text-rose-300">
                        {sceneErrorMessage(progress.sceneErrors?.[sceneNumber])}
                      </p>
                      {regenerateConfirmOpen && (
                        <div
                          role="alertdialog"
                          aria-label={`${sceneNumber}번 장면 다시 시도 확인`}
                          data-testid={`failed-scene-retry-confirm-${sceneNumber}`}
                          className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3"
                        >
                          <p className="text-sm font-semibold text-amber-300">{sceneNumber}번 장면을 다시 시도할까요?</p>
                          <RetryCostNotice
                            estimate={progress.retryEstimate}
                            sceneCount={1}
                            data-testid={`failed-scene-retry-cost-${sceneNumber}`}
                          />
                          {/* Same endpoint as a review regeneration, so the same one-off direction applies —
                              useful when the scene failed on its content rather than on a transient error. */}
                          <RegenerateInstructionField
                            id={`failed-scene-retry-instruction-${sceneNumber}`}
                            value={regenerateInstruction}
                            onChange={setRegenerateInstruction}
                            disabled={regeneratePending}
                            subject="움직임"
                            placeholder="예: 움직임을 단순하게"
                            data-testid={`failed-scene-retry-instruction-${sceneNumber}`}
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className={smallOutlineButton}
                              onClick={() => cancelRegenerateConfirmation(sceneNumber)}
                              disabled={regeneratePending}
                            >
                              취소
                            </button>
                            <button
                              type="button"
                              className={smallAmberButton}
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
            <div className="space-y-1.5">
              <p className="text-xs text-slate-400">중지하면 현재 장면 이후의 새 장면은 생성되지 않습니다.</p>
              <button type="button" className={dangerOutlineButton} data-testid="stop-button" onClick={() => void stop()} disabled={stopPending}>
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
            <button type="button" className={primaryButton} data-testid="restart-button" onClick={() => void restart()} disabled={restartPending}>
              {restartPending ? "재개 중..." : "이어서 생성"}
            </button>
          )}
          {restartError && (
            <p role="alert" data-testid="restart-error" data-error-code={restartError.code} className="text-sm text-rose-400">
              {restartError.message}
            </p>
          )}

          {reviewable && (
            <div className={cardSection} data-testid="video-review-section">
              <h3 className="flex items-center gap-2.5 text-base font-semibold">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
                />
                영상 검토
              </h3>
              <p className="text-sm text-slate-300">각 장면의 영상을 확인하고 개별적으로 승인해 주세요.</p>
              <p className="text-xs text-amber-300" data-testid="regenerate-cost-notice">
                재생성은 장면 1개당 한 번 더 청구됩니다(Runway 키가 연결된 경우). 이전 영상은 history로 보존됩니다.
              </p>

              {reviewState.status === "loading" && <Spinner label="검토 상태를 불러오는 중..." />}
              {reviewState.status === "error" && (
                <p role="alert" data-testid="review-load-error" data-error-code={reviewState.error.code} className="text-sm text-rose-400">
                  {reviewState.error.message}
                </p>
              )}

              {reviewState.status === "ready" && (
                <>
                  {/* Design system §4.3: the review step always states overall confirmation progress up front. */}
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-slate-300 tabular-nums" data-testid="review-progress-summary">
                      {totalScenes}장면 중 {reviewState.reviews.filter((review) => review.status === "approved").length}장면 확정
                      {reviewState.reviews.some((review) => review.costUsd !== undefined) && (
                        <>
                          {" · 이 작업에 쓴 비용 합계: $"}
                          {reviewState.reviews.reduce((sum, review) => sum + (review.costUsd ?? 0), 0).toFixed(2)}
                        </>
                      )}
                    </p>
                    <button
                      type="button"
                      className={smallOutlineButton}
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
                      className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3"
                    >
                      <p className="text-sm font-semibold text-amber-300">{totalScenes}개 장면 영상을 모두 다시 생성할까요?</p>
                      <p className="text-xs text-slate-300">
                        아직 재생성이 시작되지 않았습니다. 확인을 누르면 {totalScenes}개 장면 영상을 모두 다시 생성합니다 —
                        Runway 키가 연결되어 있으면 {totalScenes}장면분이 실제로 청구됩니다. 기존 승인 상태는 초기화됩니다.
                      </p>
                      {/* Regenerating every scene is the most expensive action on this screen — the total is
                          spelled out before the confirm button, not only the per-scene rate. */}
                      <RetryCostNotice
                        estimate={progress?.retryEstimate}
                        sceneCount={totalScenes}
                        data-testid="regenerate-all-cost"
                      />
                      <RegenerateInstructionField
                        id="video-regenerate-all-instruction"
                        value={regenerateAllInstruction}
                        onChange={setRegenerateAllInstruction}
                        disabled={regenerateAllPending}
                        subject="움직임"
                        placeholder="예: 카메라를 더 천천히 (모든 장면에 적용)"
                        data-testid="regenerate-all-instruction"
                      />
                      <div className="flex gap-2">
                        <button type="button" className={smallOutlineButton} onClick={cancelRegenerateAllConfirmation} disabled={regenerateAllPending}>
                          취소
                        </button>
                        <button type="button" className={smallAmberButton} onClick={() => void confirmRegenerateAll()} disabled={regenerateAllPending}>
                          {regenerateAllPending ? "재생성 중..." : "예, 전체 재생성합니다"}
                        </button>
                      </div>
                    </div>
                  )}
                  {regenerateAllError && (
                    <p role="alert" data-testid="regenerate-all-error" data-error-code={regenerateAllError.code} className="text-sm text-rose-400">
                      {regenerateAllError.message}
                    </p>
                  )}

                  <ul className="grid gap-3 sm:grid-cols-2" data-testid="video-review-list">
                    {reviewState.reviews.map((review) => {
                      const pending = approvePendingScenes.has(review.sceneNumber);
                      const approveError = approveErrors[review.sceneNumber];
                      const regeneratePending = regeneratePendingScenes.has(review.sceneNumber);
                      const regenerateError = regenerateErrors[review.sceneNumber];
                      const regenerateConfirmOpen = regenerateConfirmScene === review.sceneNumber;
                      const scene = reviewState.scenes.find((item) => item.number === review.sceneNumber);
                      return (
                        <li
                          key={review.sceneNumber}
                          data-testid={`video-review-${review.sceneNumber}`}
                          data-status={review.status}
                          // §4.3: confirmation state is carried by the card border.
                          className={`space-y-2 rounded-xl border bg-slate-950/40 p-3 ${
                            review.status === "approved" ? "border-emerald-400/30" : "border-white/10"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-slate-100">{review.sceneNumber}번 장면</span>
                            <span className="flex flex-wrap items-center gap-2">
                              <StaleBadge
                                staleSceneNumbers={reviewState.status === "ready" ? reviewState.staleness?.videoStale : undefined}
                                sceneNumber={review.sceneNumber}
                                kind="video"
                                data-testid={`video-review-stale-${review.sceneNumber}`}
                              />
                              <StatusChip tone={review.status === "approved" ? "success" : "neutral"}>
                                {review.status === "approved" ? "확정됨" : "검토 대기"}
                              </StatusChip>
                            </span>
                          </div>
                          {/* §4.3: the source still and the result sit side by side in one card, so the
                              generated motion can be judged against the image it came from. */}
                          <div className="flex gap-2">
                            {scene?.generatedImagePath && (
                              <figure className="w-1/3 space-y-1">
                                <img
                                  src={sceneImageContentUrl(projectId, review.sceneNumber)}
                                  alt={`${review.sceneNumber}번 장면 원본 이미지`}
                                  data-testid={`video-review-source-image-${review.sceneNumber}`}
                                  className="aspect-[9/16] w-full rounded-xl border border-white/10 bg-slate-800 object-cover"
                                />
                                <figcaption className="text-xs text-slate-400">원본 이미지</figcaption>
                              </figure>
                            )}
                            <figure className="flex-1 space-y-1">
                              <video
                                src={videoReviewContentUrl(projectId, review.sceneNumber, review.updatedAt)}
                                data-testid={`video-review-clip-${review.sceneNumber}`}
                                className="aspect-[9/16] w-full rounded-xl border border-white/10 bg-slate-800 object-cover"
                                controls
                                muted
                                preload="metadata"
                              />
                              <figcaption className="text-xs text-slate-400">생성된 영상</figcaption>
                            </figure>
                          </div>
                          {/* Cost actually charged for this scene, regenerations included (spec: "비용 기록").
                              Omitted when nothing was charged — e.g. the local fake adapter. */}
                          {review.costUsd !== undefined && (
                            <p className="text-xs text-slate-400 tabular-nums" data-testid={`video-review-cost-${review.sceneNumber}`}>
                              이 장면에 쓴 비용: ${review.costUsd.toFixed(2)}
                            </p>
                          )}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-end gap-3">
                              {/* Once approved the chip above already says 확정됨; a greyed-out button repeating
                                  it invites a click that does nothing. */}
                              {review.status !== "approved" && (
                              <button
                                type="button"
                                className={smallApproveButton}
                                onClick={() => void approve(review.sceneNumber)}
                                disabled={pending}
                              >
                                {pending ? "확정 중..." : "이 영상으로 확정"}
                              </button>
                              )}
                            </div>
                            {scene?.motionPrompt && (
                              <details data-testid={`video-review-prompt-${review.sceneNumber}`} className="text-xs text-slate-400">
                                <summary className="cursor-pointer text-slate-300">이 영상을 만든 프롬프트 보기</summary>
                                <p className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-slate-900/60 p-2 text-slate-300">
                                  {scene.motionPrompt}
                                </p>
                              </details>
                            )}
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
                                data-testid={`video-regenerate-confirm-panel-${review.sceneNumber}`}
                                className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3"
                              >
                                <p className="text-sm font-semibold text-amber-300">
                                  {review.sceneNumber}번 장면 영상을 다시 생성할까요?
                                </p>
                                <p className="text-xs text-slate-300">
                                  아직 재생성이 시작되지 않았습니다. 확인을 누르면 이 장면 영상만 다시 생성합니다 — Runway
                                  키가 연결되어 있으면 이번 재생성분이 실제로 청구됩니다.
                                </p>
                                <RetryCostNotice
                                  estimate={progress?.retryEstimate}
                                  sceneCount={1}
                                  data-testid={`video-regenerate-cost-${review.sceneNumber}`}
                                />
                                <RegenerateInstructionField
                                  id={`video-regenerate-instruction-${review.sceneNumber}`}
                                  value={regenerateInstruction}
                                  onChange={setRegenerateInstruction}
                                  disabled={regeneratePending}
                                  subject="움직임"
                                  placeholder="예: 카메라를 더 천천히, 표정 변화를 크게"
                                  data-testid={`video-regenerate-instruction-${review.sceneNumber}`}
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
                        {totalScenes}개 장면 영상이 모두 승인되었습니다.
                      </p>
                      <button type="button" className={primaryButton} data-testid="open-video-merge-button" onClick={() => onOpenMerge?.(projectId)}>
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
