import { useEffect, useRef, useState } from "react";
import type { BudgetPreview, ImageReview, Project, SceneNumber, SceneStaleness, StartImageGenerationResponse } from "@ai-animation-studio/shared";
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
import { workflowStateLabel } from "../utils/workflowStateLabels.js";
import { StatusChip } from "./ui/StatusChip.js";
import { RetryCostNotice } from "./ui/RetryCostNotice.js";
import { BudgetLine } from "./ui/BudgetLine.js";
import { StaleBadge } from "./ui/StaleBadge.js";
import { RegenerateInstructionField } from "./ui/RegenerateInstructionField.js";

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
  | { status: "ready"; reviews: ImageReview[]; budget?: BudgetPreview; retryEstimate?: { perSceneCostUsd: number; budget: BudgetPreview }; staleness?: SceneStaleness };

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
  /** One-off direction for the scene whose confirmation is open; cleared whenever the panel opens or closes. */
  const [regenerateInstruction, setRegenerateInstruction] = useState("");
  const [regeneratePendingScenes, setRegeneratePendingScenes] = useState<Set<SceneNumber>>(new Set());
  const [regenerateErrors, setRegenerateErrors] = useState<Partial<Record<SceneNumber, DisplayError>>>({});
  /**
   * Live progress while the generation request is in flight.
   *
   * `startImageGeneration` is one blocking POST that returns only when every scene is done — several minutes
   * with a real key — and until it returned, this screen showed six rows all reading 대기 and a button reading
   * 생성 중. Nothing said whether anything was happening at all.
   *
   * The backend does save the project after every single scene (`local-image-generation.service.ts`), so
   * progress is readable by polling. `elapsedSeconds` is the honest floor: it needs nothing from the server
   * and proves the app is alive. `completedScenes` fills in per scene as soon as the API actually reports it
   * — see the note on `sceneStatus`.
   */
  const [completedScenes, setCompletedScenes] = useState<Set<number>>(new Set());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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
  /**
   * Scenes that already have an image. `generate()` skips these for free — it compares the recorded path with
   * the file it would write and reuses a valid one — so quoting the full six-scene price on a project that has
   * five of them already is wrong in the direction that makes people hesitate.
   *
   * The flip side matters just as much and is why the panel says it out loud: reuse means pressing this again
   * does NOT redraw anything that exists. Someone who just connected a reference image and expects new
   * pictures needs the per-scene 재생성 below instead.
   */
  const alreadyMadeCount = (currentProject?.scenes ?? []).filter(
    (scene) => typeof scene?.generatedImagePath === "string" && scene.generatedImagePath.length > 0,
  ).length;
  const toMakeCount = Math.max(0, (currentProject?.scenes.length ?? 0) - alreadyMadeCount);
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
        setReviewState({ status: "ready", reviews: response.reviews, budget: response.budget, staleness: response.staleness });
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
        staleness: current.status === "ready" ? current.staleness : undefined,
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
      const response = await regenerateImageReview(projectId, sceneNumber, regenerateInstruction);
      setReviewState((current) => ({
        status: "ready",
        reviews: response.reviews,
        budget: response.retryEstimate?.budget,
        retryEstimate: response.retryEstimate,
        // Regenerating this scene brings it back in line with the current text, so it is no longer stale.
        staleness:
          current.status === "ready" && current.staleness
            ? { ...current.staleness, imageStale: current.staleness.imageStale.filter((number) => number !== sceneNumber) }
            : undefined,
      }));
      setProjectOverride(response.project);
      setRegenerateConfirmScene(null);
      setRegenerateInstruction("");
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

  useEffect(() => {
    if (!generatePending) return;
    const started = Date.now();
    const ticker = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    // Polled, not streamed: there is no progress endpoint, and the project is the only thing that changes
    // while the run is in flight. A read every 3s is cheap next to an image call that takes tens of seconds.
    const poll = setInterval(() => {
      void getProject(projectId)
        .then((response) => {
          const done = response.project.scenes
            .filter((scene) => typeof scene.generatedImagePath === "string" && scene.generatedImagePath)
            .map((scene) => scene.number as number);
          setCompletedScenes(new Set(done));
        })
        // Silent: this is a progress hint. A failed poll must never replace the run's own error handling.
        .catch(() => undefined);
    }, 3000);
    return () => { clearInterval(ticker); clearInterval(poll); };
  }, [generatePending, projectId]);

  /**
   * `generatedImagePath` is the only per-scene signal the API exposes for "this one is done". The backend
   * currently keeps finished images in a parallel `generated_images` array that `toApiProject` does not map
   * onto the scenes, so this reads false for every scene even after a successful run — which is why the rows
   * below stayed 대기 forever. The moment that mapping exists, both the finished state and the live count
   * light up with no change here; until then the elapsed clock carries the screen.
   */
  function sceneStatus(number: number): "completed" | "pending" {
    if (completedScenes.has(number)) return "completed";
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
    setCompletedScenes(new Set());
    setElapsedSeconds(0);
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
              이미지 생성은 참고 이미지 연결이 승인된 프로젝트에서만 가능합니다. 현재 상태: {workflowStateLabel(currentProject.workflowState)}
            </p>
          )}

          {generatePending && (
            <div data-testid="generation-progress" role="status" className="space-y-1.5 rounded-xl border border-violet-400/30 bg-violet-500/[0.07] p-3.5">
              <p className="text-sm font-semibold text-violet-200">
                이미지를 만드는 중입니다 — {completedScenes.size}/{totalScenes}장 완료
              </p>
              <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400 transition-[width] duration-500"
                  style={{ width: `${totalScenes ? Math.round((completedScenes.size / totalScenes) * 100) : 0}%` }}
                />
              </div>
              <p className="text-xs text-slate-400 tabular-nums">
                {Math.floor(elapsedSeconds / 60)}분 {elapsedSeconds % 60}초째 진행 중 · 한 장에 보통 십수 초에서 1분쯤 걸립니다.
              </p>
              <p className="text-xs text-slate-500">
                이 화면을 벗어나거나 새로고침해도 서버에서 만드는 것은 계속됩니다. 다만 진행 상황은 다시 들어와야 보입니다.
              </p>
            </div>
          )}

          <ol className="grid gap-2 sm:grid-cols-2" data-testid="scene-results">
            {sceneNumbers.map((number) => {
              const done = sceneStatus(number) === "completed";
              // While a run is in flight, a row that is not finished is not "waiting" in any useful sense —
              // it is either being worked on now or is next. Saying 대기 next to a spinning button was the
              // part that read as "nothing is happening".
              const label = done ? "완료" : generatePending ? "만드는 중" : "대기";
              return (
                <li
                  key={number}
                  data-testid={`scene-${number}`}
                  data-status={sceneStatus(number)}
                  className={`rounded-lg border p-2.5 text-sm ${
                    done ? "border-emerald-400/30 text-emerald-300" : generatePending ? "border-violet-400/25 text-violet-200" : "border-white/10 text-slate-300"
                  }`}
                >
                  {number}번 장면 · {label}
                </li>
              );
            })}
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
              <p className="text-sm font-semibold text-amber-300">
                {alreadyMadeCount > 0 ? `남은 장면 이미지 ${toMakeCount}장을 생성할까요?` : `장면 이미지 ${totalScenes}장을 생성할까요?`}
              </p>
              <p className="text-sm text-slate-300">
                아직 생성이 시작되지 않았습니다. OpenAI 키가 연결되어 있으면 확인을 누르는 순간 이미지 {toMakeCount}장에 대한
                실제 유료 요청이 전송됩니다. 키가 연결되어 있지 않으면 비용 없이 임시 이미지로 생성됩니다.
              </p>
              {alreadyMadeCount > 0 && (
                <p data-testid="reuse-notice" className="text-sm text-slate-300">
                  이미 만들어진 <strong className="text-slate-100">{alreadyMadeCount}장</strong>은 그대로 두고 다시 만들지 않습니다 —
                  비용도 안 듭니다. 이미 있는 그림을 <strong className="text-slate-100">새로 뽑고 싶다면</strong> 이 버튼이 아니라
                  아래 목록에서 장면마다 <span className="text-slate-100">재생성</span>을 눌러 주세요.
                </p>
              )}
              <p data-testid="generate-cost-estimate" className="text-xs text-slate-300 tabular-nums">
                예상 비용: ${(toMakeCount * IMAGE_ESTIMATED_COST_USD).toFixed(2)} ({toMakeCount}장 × $
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
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-100">{review.sceneNumber}번 장면</span>
                          <span className="flex flex-wrap items-center gap-2">
                            <StaleBadge
                              staleSceneNumbers={reviewState.status === "ready" ? reviewState.staleness?.imageStale : undefined}
                              sceneNumber={review.sceneNumber}
                              kind="image"
                              data-testid={`review-stale-${review.sceneNumber}`}
                            />
                            <StatusChip tone={review.status === "approved" ? "success" : "neutral"}>
                              {review.status === "approved" ? "확정됨" : "검토 대기"}
                            </StatusChip>
                          </span>
                        </div>
                        {/* The box takes the project's own shape rather than assuming portrait: a 16:9 project
                            really does produce landscape images now, and cropping one into a portrait box showed
                            the reviewer a tall slice of a picture that is not tall — a paid approve/regenerate
                            decision made against something the model never produced. */}
                        <img
                          src={imageReviewContentUrl(projectId, review.sceneNumber, review.updatedAt)}
                          alt={`${review.sceneNumber}번 장면 이미지`}
                          data-testid={`review-image-${review.sceneNumber}`}
                          data-aspect={currentProject?.aspectRatio ?? "9:16"}
                          className={`${currentProject?.aspectRatio === "16:9" ? "aspect-video" : "aspect-[9/16]"} w-full rounded-xl border border-white/10 bg-slate-800 object-cover`}
                        />
                        {/* Silence unless it happened: the Backend sends both counts only when its own reference
                            cap actually dropped something, and sends the used count too so this sentence never has
                            to hardcode that cap. */}
                        {typeof review.referencesOmittedCount === "number" && review.referencesOmittedCount > 0 && (
                          <p
                            data-testid={`review-references-omitted-${review.sceneNumber}`}
                            className="text-xs text-amber-300"
                          >
                            연결한 참고 이미지 중 {(review.referencesUsedCount ?? 0) + review.referencesOmittedCount}장 가운데
                            {" "}{review.referencesUsedCount ?? 0}장만 사용됐습니다. 연결을 줄이면 남은 것이 반영됩니다.
                          </p>
                        )}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-end gap-3">
                            {/* Once approved the chip above already says 확정됨; a greyed-out button repeating it
                                invites a click that does nothing. */}
                            {review.status !== "approved" && (
                            <button
                              type="button"
                              className={smallApproveButton}
                              onClick={() => void approveScene(review.sceneNumber)}
                              disabled={pending}
                            >
                              {pending ? "확정 중..." : "이 이미지로 확정"}
                            </button>
                            )}
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
                              <RegenerateInstructionField
                                id={`image-regenerate-instruction-${review.sceneNumber}`}
                                value={regenerateInstruction}
                                onChange={setRegenerateInstruction}
                                disabled={regeneratePending}
                                subject="그림"
                                placeholder="예: 더 어둡게, 인물을 더 멀리서"
                                data-testid={`regenerate-instruction-${review.sceneNumber}`}
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
