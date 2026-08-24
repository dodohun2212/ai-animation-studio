import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LongEpisodeAssetMappingReview, LongEpisodeAutomaticReferenceSummary, LongEpisodeDetail } from "@ai-animation-studio/shared";

import {
  approveLongEpisodeAssetMappingReview,
  beginLongEpisodeAssetMappingReview,
  getLongEpisode,
  getLongEpisodeAutomaticReferenceSummary,
  getLongEpisodeAssetMappingReview,
  rerunLongEpisodeAssetMatching,
  toLongProjectDisplayError,
  updateLongEpisodeAssetMapping,
} from "../api/longProjectsApi.js";
import { Spinner } from "./Spinner.js";

interface Props { projectId: string; episodeNumber: number; onBack: () => void; onOpenImageGeneration?: (projectId: string, episodeNumber: number) => void; }
type DisplayError = { code: string; message: string };

const sourceLabel = { basic: "Global style", characters: "Character", locations: "Location", props: "Prop" } as const;

const outlineButton = "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const violetOutlineButton = "rounded-full border border-violet-400/40 px-4 py-2 text-sm text-violet-200 hover:bg-violet-500/10 disabled:opacity-50";
const amberOutlineButton = "rounded-full border border-amber-400/40 px-4 py-2 text-sm text-amber-200 hover:bg-amber-500/10 disabled:opacity-50";
const primaryButton = "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const smallAddButton = "rounded-full border border-emerald-400/30 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50";
const smallRemoveButton = "rounded-full border border-rose-400/30 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50";
const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="flex items-center gap-2.5 text-base font-semibold"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]" />{children}</h3>;
}

export function LongEpisodeMappingReviewScreen({ projectId, episodeNumber, onBack, onOpenImageGeneration }: Props) {
  const [episode, setEpisode] = useState<LongEpisodeDetail | null>(null);
  const [review, setReview] = useState<LongEpisodeAssetMappingReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [textOnlyConfirmed, setTextOnlyConfirmed] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [automaticSummary, setAutomaticSummary] = useState<LongEpisodeAutomaticReferenceSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [rerunOpen, setRerunOpen] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getLongEpisode(projectId, episodeNumber), getLongEpisodeAssetMappingReview(projectId, episodeNumber)])
      .then(([episodeResponse, reviewResponse]) => {
        if (cancelled) return;
        setEpisode(episodeResponse.episode);
        setReview(reviewResponse.review);
        setTextOnlyConfirmed(reviewResponse.review.textOnlyConfirmed);
      })
      .catch((caught: unknown) => { if (!cancelled) setError(toLongProjectDisplayError(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, episodeNumber]);

  async function run(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try { await action(); } catch (caught) { setError(toLongProjectDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }

  async function loadAutomaticSummary(): Promise<void> {
    setSummaryLoading(true);
    try {
      const response = await getLongEpisodeAutomaticReferenceSummary(projectId, episodeNumber);
      setAutomaticSummary(response.summary);
    } catch (caught) { setError(toLongProjectDisplayError(caught)); }
    finally { setSummaryLoading(false); }
  }

  const isEligible = episode?.status === "script_approved" || episode?.status === "waiting_for_asset_mapping_review" || episode?.status === "asset_mapping_approved";
  const candidateCount = review?.candidates.length ?? 0;
  const reviewStarted = (review?.mappingRevision ?? 0) > 0;
  const requiresTextOnly = reviewStarted && candidateCount === 0;
  const canStart = Boolean(isEligible && review && !pending && (!reviewStarted || (requiresTextOnly && textOnlyConfirmed && !review.textOnlyConfirmed)));
  const canFinalize = Boolean(review && reviewStarted && review.status === "waiting" && !pending && (!requiresTextOnly || review.textOnlyConfirmed));

  return (
    <section className="mt-8 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className={outlineButton} onClick={onBack}>Episode script</button>
      </div>
      <header className="space-y-1">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]" />{`Episode ${episodeNumber} Asset mapping review`}</h2>
        <p className="text-sm text-slate-400">Reviewing candidates never starts image generation.</p>
      </header>
      {loading && <Spinner label="Loading mapping review…" />}
      {episode && <p data-testid="episode-mapping-status" className="text-sm text-slate-400">Episode: {episode.status} · Script revision {episode.scriptRevision}</p>}
      {episode && !isEligible && <p role="alert" data-testid="episode-mapping-not-eligible" className="text-sm text-amber-300">Approve this Episode script before opening Asset mapping review.</p>}
      {review && (
        <section aria-label="Mapping review state" className={`${cardSection} text-sm`}>
          <p>Mapping revision: {review.mappingRevision}</p>
          <p>Script revision: {review.scriptRevision}</p>
          <p className="break-all">Script fingerprint: {review.scriptFingerprint}</p>
          <p>Status: {review.status}</p>
          {requiresTextOnly && !review.textOnlyConfirmed && (
            <label className="flex items-start gap-2 text-amber-200">
              <input type="checkbox" className="mt-1" checked={textOnlyConfirmed} disabled={pending} onChange={(event) => setTextOnlyConfirmed(event.target.checked)} />
              I confirm that this Episode will continue with text only because no scoped Bible Assets are available.
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" className={violetOutlineButton} disabled={!canStart || review.status === "approved"} onClick={() => void run(async () => {
              const response = await beginLongEpisodeAssetMappingReview(projectId, episodeNumber, reviewStarted ? { textOnlyConfirmed: true } : {});
              setReview(response.review);
              setTextOnlyConfirmed(response.review.textOnlyConfirmed);
              const summaryResponse = await getLongEpisodeAutomaticReferenceSummary(projectId, episodeNumber);
              setAutomaticSummary(summaryResponse.summary);
            })}>{reviewStarted ? "Confirm text-only review" : "Start review"}</button>
            <button type="button" className={violetOutlineButton} disabled={!reviewStarted || pending || summaryLoading} onClick={() => void loadAutomaticSummary()}>{summaryLoading ? "Loading preview..." : "Refresh automatic preview"}</button>
            <button type="button" className={amberOutlineButton} disabled={!reviewStarted || pending} onClick={() => setRerunOpen(true)}>Re-run automatic matching</button>
            <button type="button" className={amberOutlineButton} disabled={!canFinalize} onClick={() => setApprovalOpen(true)}>Final approval</button>
          </div>
        </section>
      )}
      {review && candidateCount === 0 && <p data-testid="episode-mapping-empty" className="text-sm text-slate-400">No scoped Bible Asset candidates were found.</p>}
      {review && candidateCount > 0 && <ul aria-label="Scoped Bible Asset candidates" className="space-y-3">
        {review.candidates.map((candidate) => (
          <li key={candidate.mappingId} className="space-y-2 rounded-xl border border-white/10 bg-slate-900/70 p-4 text-sm">
            <p className="font-semibold">{sourceLabel[candidate.sourceCollection]}: {candidate.sourceItemId}</p>
            <p className="text-slate-300">Asset: {candidate.assetId} · {candidate.usageRole}</p>
            <p className="text-slate-300">Scope: {candidate.episodeScope.mode === "all" ? "All episodes" : `Episode ${candidate.episodeScope.episode}`} · {candidate.versionPolicy}{candidate.pinnedVersion === null ? "" : ` v${candidate.pinnedVersion}`}</p>
            <p className="text-slate-300">Status: {candidate.status}{candidate.userConfirmed ? " (user confirmed)" : ""}</p>
            <div className="flex gap-2">
              <button type="button" className={smallAddButton} disabled={!reviewStarted || pending || review.status !== "waiting"} onClick={() => void run(async () => { const response = await updateLongEpisodeAssetMapping(projectId, episodeNumber, candidate.mappingId, { decision: "confirm" }); setReview(response.review); })}>Confirm</button>
              <button type="button" className={smallRemoveButton} disabled={!reviewStarted || pending || review.status !== "waiting"} onClick={() => void run(async () => { const response = await updateLongEpisodeAssetMapping(projectId, episodeNumber, candidate.mappingId, { decision: "exclude" }); setReview(response.review); })}>Exclude</button>
            </div>
          </li>
        ))}
      </ul>}
      {automaticSummary && <section data-testid="episode-automatic-reference-preview" aria-label="Automatic scene Asset preview" className="space-y-3 rounded-2xl border border-violet-400/30 bg-slate-900/70 p-5 text-sm">
        <SectionHeading>Automatic scene Asset preview</SectionHeading>
        <p className="text-slate-300">Candidate Assets: {automaticSummary.candidateAssetIds.length} · Estimated image API calls: {automaticSummary.estimatedImageApiCalls}</p>
        <ol className="list-decimal space-y-1 pl-5 text-slate-300">{([1, 2, 3, 4, 5, 6] as const).map((sceneNumber) => <li key={sceneNumber} data-testid={`episode-automatic-reference-scene-${sceneNumber}`}>Scene {sceneNumber}: {automaticSummary.selectedAssetIdsByScene[sceneNumber].length ? automaticSummary.selectedAssetIdsByScene[sceneNumber].join(", ") : "No automatic Asset selection"}</li>)}</ol>
        <p className="text-slate-400">This preview only shows local deterministic selections. It does not generate images or send a provider request.</p>
      </section>}
      {rerunOpen && (
        <div role="alertdialog" data-testid="episode-asset-matching-rerun-confirm" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
          <p className="text-sm text-amber-200">Re-run automatic matching for this Episode? This only rebuilds local scene selections and returns the Episode to review. It does not generate images.</p>
          <div className="flex gap-3">
            <button type="button" className={outlineButton} disabled={pending} onClick={() => setRerunOpen(false)}>Back</button>
            <button type="button" className={primaryButton} disabled={pending} onClick={() => void run(async () => { const response = await rerunLongEpisodeAssetMatching(projectId, episodeNumber); setReview(response.review); setEpisode(response.episode); setAutomaticSummary(null); setRerunOpen(false); })}>Re-run matching</button>
          </div>
        </div>
      )}
      {approvalOpen && review && (
        <div role="alertdialog" data-testid="episode-mapping-approval-confirm" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
          <p className="text-sm text-amber-200">Approve this reviewed Asset mapping? This only records the mapping decision; it does not generate images.</p>
          <div className="flex gap-3">
            <button type="button" className={outlineButton} disabled={pending} onClick={() => setApprovalOpen(false)}>Back</button>
            <button type="button" className={primaryButton} disabled={pending} onClick={() => void run(async () => { const response = await approveLongEpisodeAssetMappingReview(projectId, episodeNumber, { approved: true, scriptFingerprint: review.scriptFingerprint }); setReview(response.review); setEpisode(response.episode); setApprovalOpen(false); })}>Approve mapping</button>
          </div>
        </div>
      )}
      {review?.status === "approved" && (
        <div className="space-y-2">
          <p className="text-sm text-emerald-400">Asset mapping is approved. Image generation remains a separate later step.</p>
          {onOpenImageGeneration && <button type="button" className={violetOutlineButton} onClick={() => onOpenImageGeneration(projectId, episodeNumber)}>Open image generation</button>}
        </div>
      )}
      {error && <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>}
    </section>
  );
}
