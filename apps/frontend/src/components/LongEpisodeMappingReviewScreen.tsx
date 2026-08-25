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
import { assetMappingStatusLabel, longEpisodeStatusLabel, MAPPING_REVIEW_STATUS_LABEL } from "../utils/longEpisodeLabels.js";
import { Spinner } from "./Spinner.js";

interface Props { projectId: string; episodeNumber: number; onBack: () => void; onOpenImageGeneration?: (projectId: string, episodeNumber: number) => void; }
type DisplayError = { code: string; message: string };

const sourceLabel = { basic: "전체 스타일", characters: "캐릭터", locations: "장소", props: "소품" } as const;

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
  /**
   * Not-eligible has two opposite causes, and one message for both was telling finished Episodes to go do
   * something they had already done. Before the mapping stage the script really does need approving; after it
   * (image generation onward, including a job that was interrupted or failed) the mapping is long since
   * approved and this screen is just a read-only record.
   */
  const beforeMappingStage = episode?.status === "planned" || episode?.status === "outline_ready" || episode?.status === "script_review";
  const candidateCount = review?.candidates.length ?? 0;
  const reviewStarted = (review?.mappingRevision ?? 0) > 0;
  const requiresTextOnly = reviewStarted && candidateCount === 0;
  const canStart = Boolean(isEligible && review && !pending && (!reviewStarted || (requiresTextOnly && textOnlyConfirmed && !review.textOnlyConfirmed)));
  const canFinalize = Boolean(review && reviewStarted && review.status === "waiting" && !pending && (!requiresTextOnly || review.textOnlyConfirmed));

  return (
    <section className="mt-8 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className={outlineButton} onClick={onBack}>에피소드 대본으로</button>
      </div>
      <header className="space-y-1">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]" />{`에피소드 ${episodeNumber} Asset Mapping 검토`}</h2>
        <p className="text-sm text-slate-400">후보를 검토하는 것만으로는 이미지 생성이 시작되지 않습니다.</p>
      </header>
      {loading && <Spinner label="매핑 검토 내용을 불러오는 중…" />}
      {episode && <p data-testid="episode-mapping-status" className="text-sm text-slate-400">에피소드 상태: {longEpisodeStatusLabel(episode.status)} · 대본 리비전 {episode.scriptRevision}</p>}
      {episode && !isEligible && beforeMappingStage && <p role="alert" data-testid="episode-mapping-not-eligible" className="text-sm text-amber-300">Asset Mapping 검토를 열려면 먼저 이 에피소드의 대본을 승인해야 합니다.</p>}
      {episode && !isEligible && !beforeMappingStage && <p data-testid="episode-mapping-already-done" className="text-sm text-slate-400">이 에피소드는 Asset Mapping을 이미 마치고 다음 단계로 넘어갔습니다. 여기서는 결과만 볼 수 있습니다.</p>}
      {review && (
        <section aria-label="매핑 검토 상태" className={`${cardSection} text-sm`}>
          <p>매핑 리비전: {review.mappingRevision}</p>
          <p>대본 리비전: {review.scriptRevision}</p>
          <p className="break-all">대본 지문(fingerprint): {review.scriptFingerprint}</p>
          <p>상태: {MAPPING_REVIEW_STATUS_LABEL[review.status]}</p>
          {requiresTextOnly && !review.textOnlyConfirmed && (
            <label className="flex items-start gap-2 text-amber-200">
              <input type="checkbox" className="mt-1" checked={textOnlyConfirmed} disabled={pending} onChange={(event) => setTextOnlyConfirmed(event.target.checked)} />
              범위에 해당하는 Bible Asset이 없어 이 에피소드는 텍스트만으로 계속 진행함을 확인합니다.
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" className={violetOutlineButton} disabled={!canStart || review.status === "approved"} onClick={() => void run(async () => {
              const response = await beginLongEpisodeAssetMappingReview(projectId, episodeNumber, reviewStarted ? { textOnlyConfirmed: true } : {});
              setReview(response.review);
              setTextOnlyConfirmed(response.review.textOnlyConfirmed);
              const summaryResponse = await getLongEpisodeAutomaticReferenceSummary(projectId, episodeNumber);
              setAutomaticSummary(summaryResponse.summary);
            })}>{reviewStarted ? "텍스트만 진행 확인" : "검토 시작"}</button>
            <button type="button" className={violetOutlineButton} disabled={!reviewStarted || pending || summaryLoading} onClick={() => void loadAutomaticSummary()}>{summaryLoading ? "미리보기 불러오는 중..." : "자동 미리보기 새로고침"}</button>
            <button type="button" className={amberOutlineButton} disabled={!reviewStarted || pending} onClick={() => setRerunOpen(true)}>자동 매칭 다시 실행</button>
            <button type="button" className={amberOutlineButton} disabled={!canFinalize} onClick={() => setApprovalOpen(true)}>최종 승인</button>
          </div>
        </section>
      )}
      {review && candidateCount === 0 && <p data-testid="episode-mapping-empty" className="text-sm text-slate-400">범위에 해당하는 Bible Asset 후보가 없습니다.</p>}
      {review && candidateCount > 0 && <ul aria-label="범위 지정된 Bible Asset 후보" className="space-y-3">
        {review.candidates.map((candidate) => (
          <li key={candidate.mappingId} className="space-y-2 rounded-xl border border-white/10 bg-slate-900/70 p-4 text-sm">
            <p className="font-semibold">{sourceLabel[candidate.sourceCollection]}: {candidate.sourceItemId}</p>
            <p className="text-slate-300">Asset: {candidate.assetId} · {candidate.usageRole}</p>
            <p className="text-slate-300">적용 범위: {candidate.episodeScope.mode === "all" ? "모든 에피소드" : `에피소드 ${candidate.episodeScope.episode}`} · {candidate.versionPolicy}{candidate.pinnedVersion === null ? "" : ` v${candidate.pinnedVersion}`}</p>
            <p className="text-slate-300">상태: {assetMappingStatusLabel(candidate.status)}{candidate.userConfirmed ? " (사용자 확인됨)" : ""}</p>
            <div className="flex gap-2">
              <button type="button" className={smallAddButton} disabled={!reviewStarted || pending || review.status !== "waiting"} onClick={() => void run(async () => { const response = await updateLongEpisodeAssetMapping(projectId, episodeNumber, candidate.mappingId, { decision: "confirm" }); setReview(response.review); })}>확정</button>
              <button type="button" className={smallRemoveButton} disabled={!reviewStarted || pending || review.status !== "waiting"} onClick={() => void run(async () => { const response = await updateLongEpisodeAssetMapping(projectId, episodeNumber, candidate.mappingId, { decision: "exclude" }); setReview(response.review); })}>제외</button>
            </div>
          </li>
        ))}
      </ul>}
      {automaticSummary && <section data-testid="episode-automatic-reference-preview" aria-label="장면별 자동 Asset 미리보기" className="space-y-3 rounded-2xl border border-violet-400/30 bg-slate-900/70 p-5 text-sm">
        <SectionHeading>장면별 자동 Asset 미리보기</SectionHeading>
        <p className="text-slate-300">후보 Asset: {automaticSummary.candidateAssetIds.length}개 · 예상 이미지 API 호출 수: {automaticSummary.estimatedImageApiCalls}</p>
        <ol className="list-decimal space-y-1 pl-5 text-slate-300">{([1, 2, 3, 4, 5, 6] as const).map((sceneNumber) => <li key={sceneNumber} data-testid={`episode-automatic-reference-scene-${sceneNumber}`}>장면 {sceneNumber}: {automaticSummary.selectedAssetIdsByScene[sceneNumber].length ? automaticSummary.selectedAssetIdsByScene[sceneNumber].join(", ") : "자동으로 선택된 Asset 없음"}</li>)}</ol>
        <p className="text-slate-400">이 미리보기는 로컬에서 결정된 선택 결과만 보여줍니다. 이미지를 생성하거나 Provider에 요청을 보내지 않습니다.</p>
      </section>}
      {rerunOpen && (
        <div role="alertdialog" data-testid="episode-asset-matching-rerun-confirm" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
          <p className="text-sm text-amber-200">이 에피소드의 자동 매칭을 다시 실행할까요? 로컬 장면 선택만 다시 만들고 검토 단계로 되돌립니다. 이미지는 생성하지 않습니다.</p>
          <div className="flex gap-3">
            <button type="button" className={outlineButton} disabled={pending} onClick={() => setRerunOpen(false)}>돌아가기</button>
            <button type="button" className={primaryButton} disabled={pending} onClick={() => void run(async () => { const response = await rerunLongEpisodeAssetMatching(projectId, episodeNumber); setReview(response.review); setEpisode(response.episode); setAutomaticSummary(null); setRerunOpen(false); })}>다시 실행</button>
          </div>
        </div>
      )}
      {approvalOpen && review && (
        <div role="alertdialog" data-testid="episode-mapping-approval-confirm" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
          <p className="text-sm text-amber-200">검토된 이 Asset Mapping을 승인할까요? 매핑 결정만 기록하며 이미지는 생성하지 않습니다.</p>
          <div className="flex gap-3">
            <button type="button" className={outlineButton} disabled={pending} onClick={() => setApprovalOpen(false)}>돌아가기</button>
            <button type="button" className={primaryButton} disabled={pending} onClick={() => void run(async () => { const response = await approveLongEpisodeAssetMappingReview(projectId, episodeNumber, { approved: true, scriptFingerprint: review.scriptFingerprint }); setReview(response.review); setEpisode(response.episode); setApprovalOpen(false); })}>매핑 승인</button>
          </div>
        </div>
      )}
      {review?.status === "approved" && (
        <div className="space-y-2">
          <p className="text-sm text-emerald-400">Asset Mapping이 승인되었습니다. 이미지 생성은 이후 별도 단계로 진행됩니다.</p>
          {onOpenImageGeneration && <button type="button" className={violetOutlineButton} onClick={() => onOpenImageGeneration(projectId, episodeNumber)}>이미지 생성 열기</button>}
        </div>
      )}
      {error && <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>}
    </section>
  );
}
