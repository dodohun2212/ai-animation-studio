import { useEffect, useRef, useState } from "react";
import type { LongEpisodeContinuityReference, LongEpisodeDetail, LongEpisodeImageReview, SceneNumber, StartLongEpisodeImageGenerationResponse } from "@ai-animation-studio/shared";

import {
  approveLongEpisodeImageReview,
  getLongEpisode,
  getLongEpisodeContinuityReference,
  getLongEpisodeImageReview,
  regenerateLongEpisodeImageReview,
  startLongEpisodeImageGeneration,
  toLongProjectDisplayError,
} from "../api/longProjectsApi.js";
import { longEpisodeStatusLabel } from "../utils/longEpisodeLabels.js";
import { Spinner } from "./Spinner.js";
import { StatusChip } from "./ui/StatusChip.js";

interface Props { projectId: string; episodeNumber: number; onBack: () => void; onOpenVideoWorkflow?: (projectId: string, episodeNumber: number) => void; }
type DisplayError = { code: string; message: string };
type ReviewState = { status: "idle" | "loading" } | { status: "error"; error: DisplayError } | { status: "ready"; reviews: LongEpisodeImageReview[] };
const SCENES: SceneNumber[] = [1, 2, 3, 4, 5, 6];
const SCENE_SLOT_LABEL: Record<string, string> = { generated: "생성됨", waiting: "대기 중", pending: "검토 대기", approved: "승인됨" };
const sceneSlotLabel = (status: string) => SCENE_SLOT_LABEL[status] ?? status;

const outlineButton = "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const primaryButton = "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const smallOutlineButton = "rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50";
const smallAmberButton = "rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_12px_rgba(245,158,11,0.35)] disabled:opacity-50";
const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

export function LongEpisodeImageGenerationScreen({ projectId, episodeNumber, onBack, onOpenVideoWorkflow }: Props) {
  const [episode, setEpisode] = useState<LongEpisodeDetail | null>(null);
  const [continuityReference, setContinuityReference] = useState<LongEpisodeContinuityReference | null>(null);
  const [continuityReferenceLoading, setContinuityReferenceLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DisplayError | null>(null);
  const [confirmingGeneration, setConfirmingGeneration] = useState(false);
  const [generationPending, setGenerationPending] = useState(false);
  const [generation, setGeneration] = useState<StartLongEpisodeImageGenerationResponse | null>(null);
  const [reviewState, setReviewState] = useState<ReviewState>({ status: "idle" });
  const [approvePending, setApprovePending] = useState<Set<SceneNumber>>(new Set());
  const [regenerateConfirm, setRegenerateConfirm] = useState<SceneNumber | null>(null);
  const [regeneratePending, setRegeneratePending] = useState<Set<SceneNumber>>(new Set());
  const generationBusy = useRef(false);
  const approvalBusy = useRef(new Set<SceneNumber>());
  const regenerationBusy = useRef(new Set<SceneNumber>());

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setGeneration(null); setReviewState({ status: "idle" }); setConfirmingGeneration(false);
    getLongEpisode(projectId, episodeNumber)
      .then((response) => { if (!cancelled) setEpisode(response.episode); })
      .catch((caught: unknown) => { if (!cancelled) setError(toLongProjectDisplayError(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    getLongEpisodeContinuityReference(projectId, episodeNumber)
      .then((response) => { if (!cancelled) setContinuityReference(response.reference); })
      .catch(() => { if (!cancelled) setContinuityReference(null); })
      .finally(() => { if (!cancelled) setContinuityReferenceLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, episodeNumber]);

  const reviewable = episode?.status === "images_review" || episode?.status === "waiting_for_video_confirmation";
  useEffect(() => {
    if (!reviewable || reviewState.status !== "idle") return;
    let cancelled = false;
    setReviewState({ status: "loading" });
    getLongEpisodeImageReview(projectId, episodeNumber)
      .then((response) => { if (!cancelled) { setEpisode(response.episode); setReviewState({ status: "ready", reviews: response.reviews }); } })
      .catch((caught: unknown) => { if (!cancelled) setReviewState({ status: "error", error: toLongProjectDisplayError(caught) }); });
    return () => { cancelled = true; };
    // reviewState.status is intentionally excluded: it is set inside this effect as a start-once guard,
    // and including it would re-run the effect (and its cleanup) before the in-flight fetch resolves,
    // permanently discarding the response via the `cancelled` flag and leaving the screen stuck loading.
  }, [episodeNumber, projectId, reviewable]);

  const eligible = episode?.status === "asset_mapping_approved";
  async function confirmGeneration(): Promise<void> {
    if (generationBusy.current) return;
    generationBusy.current = true; setGenerationPending(true); setError(null);
    try {
      const response = await startLongEpisodeImageGeneration(projectId, episodeNumber);
      setGeneration(response); setEpisode(response.episode); setConfirmingGeneration(false);
    } catch (caught) { setError(toLongProjectDisplayError(caught)); }
    finally { generationBusy.current = false; setGenerationPending(false); }
  }

  async function approveScene(sceneNumber: SceneNumber): Promise<void> {
    if (approvalBusy.current.has(sceneNumber)) return;
    approvalBusy.current.add(sceneNumber); setApprovePending(new Set(approvalBusy.current)); setError(null);
    try {
      const response = await approveLongEpisodeImageReview(projectId, episodeNumber, sceneNumber);
      setEpisode(response.episode); setReviewState({ status: "ready", reviews: response.reviews });
    } catch (caught) { setError(toLongProjectDisplayError(caught)); }
    finally { approvalBusy.current.delete(sceneNumber); setApprovePending(new Set(approvalBusy.current)); }
  }

  async function confirmRegenerate(sceneNumber: SceneNumber): Promise<void> {
    if (regenerationBusy.current.has(sceneNumber)) return;
    regenerationBusy.current.add(sceneNumber); setRegeneratePending(new Set(regenerationBusy.current)); setError(null);
    try {
      const response = await regenerateLongEpisodeImageReview(projectId, episodeNumber, sceneNumber);
      setEpisode(response.episode); setReviewState({ status: "ready", reviews: response.reviews }); setRegenerateConfirm(null);
    } catch (caught) { setError(toLongProjectDisplayError(caught)); }
    finally { regenerationBusy.current.delete(sceneNumber); setRegeneratePending(new Set(regenerationBusy.current)); }
  }

  const reviewFor = (sceneNumber: SceneNumber) => reviewState.status === "ready" ? reviewState.reviews.find((item) => item.sceneNumber === sceneNumber) : undefined;

  return (
    <section className="mt-8 space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>Asset Mapping 검토로</button>
      <header className="space-y-1">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]" />{`에피소드 ${episodeNumber} 이미지 생성`}</h2>
        <p data-testid="episode-image-local-notice" className="text-sm text-amber-300">지금은 로컬 가짜 이미지 어댑터만 사용합니다. 유료 Provider 요청은 보내지 않습니다.</p>
      </header>
      {loading && <Spinner label="에피소드 이미지 상태를 불러오는 중..." />}
      {episode && <p data-testid="episode-image-status" className="text-sm text-slate-400">에피소드 상태: {longEpisodeStatusLabel(episode.status)}</p>}
      {continuityReferenceLoading && <p data-testid="episode-image-continuity-loading" className="text-sm text-slate-400">이전 에피소드 연속성 참고 자료를 확인하는 중...</p>}
      {!continuityReferenceLoading && continuityReference?.available && <p data-testid="episode-image-continuity-available" className="text-sm text-violet-200">에피소드 {continuityReference.previousEpisodeNumber}의 6번 장면이 이 에피소드 1번 장면의 기준이 됩니다.</p>}
      {!continuityReferenceLoading && !continuityReference?.available && <p data-testid="episode-image-continuity-unavailable" className="text-sm text-slate-400">이 에피소드에 사용할 이전 에피소드 6번 장면 연속성 참고 자료가 없습니다.</p>}
      {episode && !eligible && !reviewable && <p data-testid="episode-image-not-eligible" className="text-sm text-amber-300">에피소드 이미지 생성을 시작하려면 먼저 Asset Mapping을 승인하세요.</p>}
      <ol data-testid="episode-image-scenes" className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
        {SCENES.map((sceneNumber) => <li key={sceneNumber} data-testid={`episode-image-scene-${sceneNumber}`} data-status={reviewFor(sceneNumber)?.status ?? (generation ? "generated" : "waiting")}>장면 {sceneNumber}: {sceneSlotLabel(reviewFor(sceneNumber)?.status ?? (generation ? "generated" : "waiting"))}</li>)}
      </ol>
      {eligible && !generation && <button type="button" disabled={confirmingGeneration} className={primaryButton} onClick={() => setConfirmingGeneration(true)}>이미지 생성 시작</button>}
      {confirmingGeneration && (
        <div role="alertdialog" data-testid="episode-image-generate-confirm" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
          <p className="text-sm text-amber-200">이 에피소드의 로컬 가짜 이미지 6장을 생성할까요? 이 확인창을 연 것만으로는 아직 요청이 가지 않았습니다.</p>
          <div className="flex gap-3">
            <button type="button" className={outlineButton} disabled={generationPending} onClick={() => setConfirmingGeneration(false)}>돌아가기</button>
            <button type="button" className={primaryButton} disabled={generationPending} onClick={() => void confirmGeneration()}>{generationPending ? "생성하는 중..." : "로컬 이미지 생성"}</button>
          </div>
        </div>
      )}
      {generation && <p data-testid="episode-image-generation-summary" className="text-sm text-emerald-400">{generation.generatedSceneNumbers.length}개 생성, {generation.reusedSceneNumbers.length}개 재사용됨.</p>}
      {reviewState.status === "loading" && <Spinner label="이미지 검토 내용을 불러오는 중..." />}
      {reviewState.status === "ready" && (
        <section data-testid="episode-image-review-section" className={cardSection}>
          <h3 className="flex items-center gap-2.5 text-base font-semibold"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]" />이미지 검토</h3>
          {/* Design system §4.3: overall confirmation progress before the per-scene cards. */}
          <p className="text-sm text-slate-300 tabular-nums" data-testid="episode-image-review-summary">
            {SCENES.length}장면 중 {SCENES.filter((sceneNumber) => reviewFor(sceneNumber)?.status === "approved").length}장면 확정
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {SCENES.map((sceneNumber) => {
            const review = reviewFor(sceneNumber);
            if (!review) return null;
            const approving = approvePending.has(sceneNumber);
            const regenerating = regeneratePending.has(sceneNumber);
            const confirming = regenerateConfirm === sceneNumber;
            return (
              <div
                key={sceneNumber}
                data-testid={`episode-image-review-${sceneNumber}`}
                data-status={review.status}
                className={`space-y-2 rounded-xl border bg-slate-950/40 p-3 ${review.status === "approved" ? "border-emerald-400/30" : "border-white/10"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-100">{sceneNumber}번 장면</span>
                  <StatusChip tone={review.status === "approved" ? "success" : "neutral"}>{sceneSlotLabel(review.status)}</StatusChip>
                </div>
                <div className="flex flex-wrap justify-end gap-3">
                  <button type="button" className={smallOutlineButton} disabled={review.status === "approved" || approving} onClick={() => void approveScene(sceneNumber)}>{approving ? "확정하는 중..." : review.status === "approved" ? "확정 완료" : "이 이미지로 확정"}</button>
                  <button type="button" className={smallOutlineButton} disabled={regenerating || confirming} onClick={() => setRegenerateConfirm(sceneNumber)}>{regenerating ? "다시 만드는 중..." : "다시 만들기"}</button>
                </div>
                {confirming && (
                  <div role="alertdialog" data-testid={`episode-image-regenerate-confirm-${sceneNumber}`} className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3">
                    <p className="text-sm text-amber-200">{sceneNumber}번 장면만 로컬 가짜 어댑터로 다시 만들까요?</p>
                    <div className="flex gap-2">
                      <button type="button" className={smallOutlineButton} disabled={regenerating} onClick={() => setRegenerateConfirm(null)}>취소</button>
                      <button type="button" className={smallAmberButton} disabled={regenerating} onClick={() => void confirmRegenerate(sceneNumber)}>이 장면 다시 만들기</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </section>
      )}
      {episode?.status === "waiting_for_video_confirmation" && (
        <div className="space-y-2">
          <p data-testid="episode-video-confirmation-transition" className="text-sm text-emerald-400">6개 장면 이미지가 모두 승인되었습니다. 별도의 영상 확인 단계로 이어서 진행하세요.</p>
          {onOpenVideoWorkflow && <button type="button" data-testid="episode-open-video-workflow" className={outlineButton} onClick={() => onOpenVideoWorkflow(projectId, episodeNumber)}>에피소드 영상 작업 열기</button>}
        </div>
      )}
      {error && <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>}
    </section>
  );
}
