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

interface Props { projectId: string; episodeNumber: number; onBack: () => void; onOpenVideoWorkflow?: (projectId: string, episodeNumber: number) => void; }
type DisplayError = { code: string; message: string };
type ReviewState = { status: "idle" | "loading" } | { status: "error"; error: DisplayError } | { status: "ready"; reviews: LongEpisodeImageReview[] };
const SCENES: SceneNumber[] = [1, 2, 3, 4, 5, 6];

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

  return <section className="mt-8 space-y-5">
    <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300" onClick={onBack}>Asset mapping review</button>
    <header><h2 className="text-xl font-semibold">Episode {episodeNumber} image generation</h2><p data-testid="episode-image-local-notice" className="mt-1 text-sm text-amber-300">This uses only the local fake image adapter. No paid provider request is sent.</p></header>
    {loading && <p className="text-slate-400">Loading Episode image state...</p>}
    {episode && <p data-testid="episode-image-status" className="text-sm text-slate-400">Episode status: {episode.status}</p>}
    {continuityReferenceLoading && <p data-testid="episode-image-continuity-loading" className="text-sm text-slate-400">Checking prior Episode continuity reference...</p>}
    {!continuityReferenceLoading && continuityReference?.available && <p data-testid="episode-image-continuity-available" className="text-sm text-violet-200">Episode {continuityReference.previousEpisodeNumber} Scene 6 will guide this Episode Scene 1.</p>}
    {!continuityReferenceLoading && !continuityReference?.available && <p data-testid="episode-image-continuity-unavailable" className="text-sm text-slate-400">No prior Episode Scene 6 continuity reference is available for this Episode.</p>}
    {episode && !eligible && !reviewable && <p data-testid="episode-image-not-eligible" className="text-sm text-amber-300">Approve Asset mapping before starting Episode image generation.</p>}
    <ol data-testid="episode-image-scenes" className="list-decimal space-y-1 pl-5 text-sm text-slate-300">{SCENES.map((sceneNumber) => <li key={sceneNumber} data-testid={`episode-image-scene-${sceneNumber}`} data-status={reviewFor(sceneNumber)?.status ?? (generation ? "generated" : "waiting")}>Scene {sceneNumber}: {reviewFor(sceneNumber)?.status ?? (generation ? "generated" : "waiting")}</li>)}</ol>
    {eligible && !generation && <button type="button" disabled={confirmingGeneration} className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => setConfirmingGeneration(true)}>Start image generation</button>}
    {confirmingGeneration && <div role="alertdialog" data-testid="episode-image-generate-confirm" className="space-y-3 rounded-lg border border-amber-400/40 bg-slate-900 p-4"><p className="text-sm text-amber-200">Generate six local fake images for this Episode? Opening this confirmation did not make a request.</p><div className="flex gap-3"><button type="button" disabled={generationPending} onClick={() => setConfirmingGeneration(false)}>Back</button><button type="button" disabled={generationPending} onClick={() => void confirmGeneration()}>{generationPending ? "Generating..." : "Generate local images"}</button></div></div>}
    {generation && <p data-testid="episode-image-generation-summary" className="text-sm text-emerald-400">Generated {generation.generatedSceneNumbers.length}, reused {generation.reusedSceneNumbers.length} scene images.</p>}
    {reviewState.status === "loading" && <p className="text-slate-400">Loading image reviews...</p>}
    {reviewState.status === "ready" && <section data-testid="episode-image-review-section" className="space-y-3 rounded-lg border border-white/10 bg-slate-900 p-4"><h3 className="font-semibold">Image review</h3>{SCENES.map((sceneNumber) => { const review = reviewFor(sceneNumber); if (!review) return null; const approving = approvePending.has(sceneNumber); const regenerating = regeneratePending.has(sceneNumber); const confirming = regenerateConfirm === sceneNumber; return <div key={sceneNumber} data-testid={`episode-image-review-${sceneNumber}`} data-status={review.status} className="space-y-2 border-t border-white/10 pt-3"><p>Scene {sceneNumber}: {review.status}</p><div className="flex gap-3"><button type="button" disabled={review.status === "approved" || approving} onClick={() => void approveScene(sceneNumber)}>{approving ? "Approving..." : review.status === "approved" ? "Approved" : "Approve"}</button><button type="button" disabled={regenerating || confirming} onClick={() => setRegenerateConfirm(sceneNumber)}>{regenerating ? "Regenerating..." : "Regenerate"}</button></div>{confirming && <div role="alertdialog" data-testid={`episode-image-regenerate-confirm-${sceneNumber}`} className="space-y-2 rounded border border-amber-400/40 p-3"><p className="text-sm text-amber-200">Regenerate only Scene {sceneNumber} with the local fake adapter?</p><button type="button" disabled={regenerating} onClick={() => setRegenerateConfirm(null)}>Cancel</button><button type="button" disabled={regenerating} onClick={() => void confirmRegenerate(sceneNumber)}>Regenerate scene</button></div>}</div>; })}</section>}
    {episode?.status === "waiting_for_video_confirmation" && <div className="space-y-2"><p data-testid="episode-video-confirmation-transition" className="text-sm text-emerald-400">All six Episode images are approved. Continue to the separate video-confirmation step.</p>{onOpenVideoWorkflow && <button type="button" data-testid="episode-open-video-workflow" onClick={() => onOpenVideoWorkflow(projectId, episodeNumber)}>Open Episode video workflow</button>}</div>}
    {error && <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>}
  </section>;
}
