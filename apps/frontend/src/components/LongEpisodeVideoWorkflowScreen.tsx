import { useEffect, useRef, useState } from "react";
import type { GetLongEpisodeVideoPreviewResponse, LongEpisodeVideoProgress, LongEpisodeVideoReview, RecoverLongEpisodeVideosResponse, SceneNumber } from "@ai-animation-studio/shared";

import { approveLongEpisodeVideoReview, episodeSceneErrorMessage, getLongEpisodeVideoPreview, getLongEpisodeVideoProgress, getLongEpisodeVideoReview, longEpisodeVideoContentUrl, recoverLongEpisodeVideos, regenerateLongEpisodeVideo, restartLongEpisodeVideoGeneration, startLongEpisodeVideoGeneration, stopLongEpisodeVideoGeneration, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { Spinner } from "./Spinner.js";
import { videoRatioLabel } from "../utils/sceneFields.js";
import { RetryCostNotice } from "./ui/RetryCostNotice.js";
import { StatusChip } from "./ui/StatusChip.js";

interface Props { projectId: string; episodeNumber: number; onBack: () => void; onOpenMerge: (projectId: string, episodeNumber: number) => void; }
type DisplayError = { code: string; message: string };
const LIMIT = 1000;

const outlineButton = "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const primaryButton = "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const dangerOutlineButton = "rounded-full border border-rose-400/30 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/10 disabled:opacity-50";
const smallOutlineButton = "rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50";
const smallAmberButton = "rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_12px_rgba(245,158,11,0.35)] disabled:opacity-50";
const textareaClassName = "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";
const dot = <span aria-hidden="true" className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]" />;

export function LongEpisodeVideoWorkflowScreen({ projectId, episodeNumber, onBack, onOpenMerge }: Props) {
  const [preview, setPreview] = useState<GetLongEpisodeVideoPreviewResponse | null>(null);
  const [prompts, setPrompts] = useState<Partial<Record<SceneNumber, string>>>({});
  const [job, setJob] = useState<LongEpisodeVideoProgress | null>(null);
  const [reviews, setReviews] = useState<LongEpisodeVideoReview[] | null>(null);
  const [confirmStart, setConfirmStart] = useState(false); const [regenerate, setRegenerate] = useState<SceneNumber | null>(null);
  /**
   * Identifies the person's intent to generate this Episode's videos — not the click that sends it.
   *
   * Made when the confirmation opens and kept until a start actually succeeds, so a retry after a failed or
   * timed-out send carries the same id and the server can recognise it as the same request rather than a
   * second one. Minting it inside start() (which is what this did) meant every press was a new intent, and the
   * id was doing nothing at all: the field was sent, and could never match anything.
   *
   * It does not stop a double charge — the Episode moves to videos_generating on the first start, and the
   * state gate refuses the second regardless. What it stops is the second press being answered with a
   * confusing error about something else instead of being recognised as the same request.
   */
  const [startRequestId, setStartRequestId] = useState<string | null>(null);
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<DisplayError | null>(null);
  const busyRef = useRef(false);
  const loadPreview = async () => { setError(null); try { const response = await getLongEpisodeVideoPreview(projectId, episodeNumber); setPreview(response); setPrompts(Object.fromEntries(response.scenes.map((scene) => [scene.sceneNumber, scene.prompt]))); } catch (caught) { setError(toLongProjectDisplayError(caught)); } };
  useEffect(() => { void loadPreview(); }, [projectId, episodeNumber]);
  const loadProgress = async () => { if (!job) return; try { const next = await getLongEpisodeVideoProgress(projectId, episodeNumber, job.jobId); setJob(next); if (next.status === "succeeded") { const review = await getLongEpisodeVideoReview(projectId, episodeNumber, next.jobId); setReviews(review.reviews); } } catch (caught) { setError(toLongProjectDisplayError(caught)); } };
  useEffect(() => { if (!job || (job.status !== "created" && job.status !== "running")) return; const timer = setTimeout(() => void loadProgress(), 400); return () => clearTimeout(timer); }, [job]);
  const valid = preview !== null && preview.scenes.every((scene) => { const prompt = prompts[scene.sceneNumber] ?? ""; return prompt.trim().length > 0 && prompt.length <= LIMIT; });
  async function start(): Promise<void> { if (!preview || !valid || busyRef.current || !startRequestId) return; busyRef.current = true; setBusy(true); setError(null); try { const response = await startLongEpisodeVideoGeneration(projectId, episodeNumber, { confirmationId: preview.confirmationId, userRequestId: startRequestId, approved: true, prompts: preview.scenes.map((scene) => ({ sceneNumber: scene.sceneNumber, prompt: prompts[scene.sceneNumber] ?? "" })) }); setJob({ jobId: response.jobId, status: "created", completedSceneNumbers: [], failedSceneNumbers: [], sceneNumbers: preview.scenes.map((scene) => scene.sceneNumber), episode: response.episode }); setConfirmStart(false); setStartRequestId(null); } catch (caught) { setError(toLongProjectDisplayError(caught)); } finally { busyRef.current = false; setBusy(false); } }
  async function action(fn: () => Promise<LongEpisodeVideoProgress>): Promise<void> { if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(null); try { setJob(await fn()); setUnplayable([]); setVideoVersion((current) => current + 1); } catch (caught) { setError(toLongProjectDisplayError(caught)); } finally { busyRef.current = false; setBusy(false); } }
  /**
   * Fetches the clips Runway already made, using the task ids on record.
   *
   * A bug wrote a 32-byte placeholder over every downloaded clip after paying for it — $1.50 an Episode, and
   * the screen reported success. This is a download, not a generation: nothing reaches the ledger. Scenes whose
   * output can no longer be fetched come back named, with a reason, and are left failed — spending money again
   * is the person's decision, not a fallback.
   */
  const [recovery, setRecovery] = useState<RecoverLongEpisodeVideosResponse | null>(null);
  /* The content route refuses placeholders, so a scene that never downloaded fails to load rather than playing
     32 bytes of nothing. Which sentence the person gets depends on whether 가져오기 has already run. */
  const [unplayable, setUnplayable] = useState<readonly number[]>([]);
  const [videoVersion, setVideoVersion] = useState(0);
  async function recover(): Promise<void> {
    if (!job || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const response = await recoverLongEpisodeVideos(projectId, episodeNumber, job.jobId);
      setJob(response); setRecovery(response); setUnplayable([]); setVideoVersion((current) => current + 1);
      const review = await getLongEpisodeVideoReview(projectId, episodeNumber, response.jobId);
      setReviews(review.reviews);
    } catch (caught) { setError(toLongProjectDisplayError(caught)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function approve(sceneNumber: SceneNumber): Promise<void> { if (!job) return; try { const response = await approveLongEpisodeVideoReview(projectId, episodeNumber, job.jobId, sceneNumber); setJob((current) => current ? { ...current, episode: response.episode } : current); setReviews(response.reviews); } catch (caught) { setError(toLongProjectDisplayError(caught)); } }
  return (
    <section className="mt-8 space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>에피소드 이미지로</button>
      <header className="space-y-1">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold">{dot}{`에피소드 ${episodeNumber} 영상 작업`}</h2>
        <p data-testid="episode-video-provider-notice" className="text-sm text-amber-300">Runway 키가 연결되어 있으면 장면마다 실제 유료 요청이 전송됩니다. 연결되어 있지 않으면 비용 없이 임시 영상으로 만들어집니다.</p>
      </header>
      {!preview && !error && <Spinner label="영상 미리보기를 불러오는 중..." />}
      {preview && !job && (
        <div className={cardSection}>
          <p data-testid="episode-video-summary" className="text-sm text-slate-300">순차 진행 · ${preview.estimatedCostUsd.toFixed(2)}</p>
          {/* The short project's prompt preview states model, ratio and clip length before the paid button;
              this screen carried the same values in its response and showed none of them. Orientation matters
              most: a project set to 16:9 that submits a portrait ratio produces the wrong video shape, and the
              only place that would have been visible is here, before the money is spent. */}
          <p data-testid="episode-video-output-spec" className="text-sm text-slate-400">
            모델: {preview.model} · 비율: {videoRatioLabel(preview.ratio)} · 장면당 길이: {preview.durationSecondsPerScene}초
          </p>
          {/* Spec: the maximum call count and the remaining local budget must be visible before approval.
              `budget` is omitted when no Runway credential is connected — then there is nothing to show. */}
          <div
            className={`space-y-1.5 rounded-xl border p-3 ${
              preview.budget && (preview.estimatedCostUsd > preview.budget.remainingUsd || !preview.budget.canSpend)
                ? "border-rose-400/40 bg-rose-950/20"
                : "border-white/10 bg-slate-950/40"
            }`}
          >
            <p className="text-sm text-slate-300 tabular-nums">총 예상 비용: ${preview.estimatedCostUsd.toFixed(2)}</p>
            {preview.maximumProviderCalls !== undefined && (
              <p className="text-sm text-slate-300 tabular-nums" data-testid="episode-video-max-calls">
                최대 호출 수: {preview.maximumProviderCalls}회
              </p>
            )}
            {preview.budget && (
              <p className="text-sm text-slate-300 tabular-nums" data-testid="episode-video-budget">
                이번 달 남은 예산: ${preview.budget.remainingUsd.toFixed(2)} (월 한도 ${preview.budget.monthlyLimitUsd.toFixed(2)} 중 $
                {preview.budget.spentUsd.toFixed(2)} 사용)
              </p>
            )}
            {preview.budget && (preview.estimatedCostUsd > preview.budget.remainingUsd || !preview.budget.canSpend) && (
              <p role="alert" data-testid="episode-video-budget-exceeded" className="text-sm font-semibold text-rose-300">
                이번 요청의 예상 비용이 남은 월 예산을 초과합니다. 그대로 전송하면 예산 한도에 막혀 실패할 수 있습니다.
              </p>
            )}
          </div>
          <ol className="space-y-3">
            {preview.scenes.map((scene) => (
              <li key={scene.sceneNumber} className="space-y-1">
                <label className="block text-sm text-slate-300">
                  {`${scene.sceneNumber}번 장면 프롬프트`}
                  <textarea data-testid={`episode-video-prompt-${scene.sceneNumber}`} className={textareaClassName} value={prompts[scene.sceneNumber] ?? ""} disabled={confirmStart || busy} onChange={(event) => setPrompts((current) => ({ ...current, [scene.sceneNumber]: event.target.value }))} />
                </label>
                <span className="text-xs text-slate-500">{(prompts[scene.sceneNumber] ?? "").length} / {LIMIT}</span>
              </li>
            ))}
          </ol>
          <button type="button" data-testid="episode-video-open-confirm" className={primaryButton} disabled={!valid || confirmStart} onClick={() => { setStartRequestId(crypto.randomUUID()); setConfirmStart(true); }}>영상 생성 확인창 열기</button>
          {confirmStart && (
            <div role="alertdialog" data-testid="episode-video-start-confirm" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
              <p className="text-sm text-amber-200">이 확인창을 연 것만으로는 아직 요청이 가지 않았습니다. 장면 영상을 순서대로 만들까요? Runway 키가 연결되어 있으면 이때부터 실제로 청구됩니다.</p>
              <div className="flex gap-3">
                <button type="button" className={outlineButton} disabled={busy} onClick={() => { setConfirmStart(false); setStartRequestId(null); }}>취소</button>
                <button type="button" className={primaryButton} disabled={busy} onClick={() => void start()}>영상 만들기 시작</button>
              </div>
            </div>
          )}
        </div>
      )}
      {job && (
        <section data-testid="episode-video-progress" className={cardSection}>
          <p className="text-sm text-slate-300">작업 상태: {{ created: "생성됨", running: "진행 중", succeeded: "완료됨", failed: "실패", interrupted: "중단됨" }[job.status] ?? "상태 확인 중"}</p>
          <ol className="grid grid-cols-2 gap-2 text-sm text-slate-300 sm:grid-cols-3">
            {job.sceneNumbers.map((scene) => <li key={scene} data-testid={`episode-video-progress-${scene}`} className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2">{scene}: {job.completedSceneNumbers.includes(scene) ? "완료" : job.currentSceneNumber === scene ? "진행 중" : job.failedSceneNumbers.includes(scene) ? "실패" : "대기 중"}</li>)}
          </ol>
          {(job.status === "created" || job.status === "running") && <button type="button" className={dangerOutlineButton} disabled={busy} onClick={() => void action(() => stopLongEpisodeVideoGeneration(projectId, episodeNumber, job.jobId))}>중단</button>}
          {/* Every other paid button on this screen confirms first; this one spent money on a single click. */}
          {job.status === "interrupted" && <button type="button" data-testid="episode-video-restart" className={outlineButton} disabled={busy} onClick={() => setRestartConfirm(true)}>남은 장면 이어서 만들기</button>}
          {restartConfirm && (
            <div role="alertdialog" data-testid="episode-video-restart-confirm" className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3">
              <p className="text-sm text-amber-200">중단된 지점부터 남은 장면 영상을 이어서 만들까요? Runway 키가 연결되어 있으면 만드는 장면 수만큼 실제로 청구됩니다.</p>
              <div className="flex gap-2">
                <button type="button" className={smallOutlineButton} onClick={() => setRestartConfirm(false)}>취소</button>
                <button type="button" className={smallAmberButton} disabled={busy} onClick={() => { setRestartConfirm(false); void action(() => restartLongEpisodeVideoGeneration(projectId, episodeNumber, job.jobId)); }}>네, 이어서 만들기</button>
              </div>
            </div>
          )}
        </section>
      )}
      {job?.status === "failed" && (
        <section data-testid="episode-video-failed-scenes" className={cardSection}>
          <p className="text-sm text-amber-300">일부 장면이 실패했습니다. 아래에서 실패한 장면을 다시 시도할 수 있습니다.</p>
          <ul className="space-y-2">
            {job.failedSceneNumbers.map((scene) => (
              <li key={scene} data-testid={`episode-video-failed-${scene}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-950/60 p-3">
                <div className="flex-1 space-y-1">
                  <span className="text-sm text-slate-300">{scene}번 장면</span>
                  <p data-testid={`episode-video-failed-reason-${scene}`} className="text-xs text-rose-300">{episodeSceneErrorMessage(job.sceneErrors?.[scene])}</p>
                </div>
                <button type="button" data-testid={`episode-video-failed-retry-${scene}`} className={smallOutlineButton} disabled={busy || regenerate === scene} onClick={() => setRegenerate(scene)}>다시 시도</button>
                {regenerate === scene && (
                  <div role="alertdialog" data-testid={`episode-video-failed-retry-confirm-${scene}`} className="w-full space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3">
                    <p className="text-sm text-amber-200">{scene}번 장면을 다시 시도할까요? Runway 키가 연결되어 있으면 이번 시도분이 실제로 청구됩니다.</p>
                    <RetryCostNotice estimate={job.retryEstimate} sceneCount={1} data-testid={`episode-video-failed-retry-cost-${scene}`} />
                    <div className="flex gap-2">
                      <button type="button" className={smallOutlineButton} onClick={() => setRegenerate(null)}>취소</button>
                      <button type="button" className={smallAmberButton} disabled={busy} onClick={() => { setRegenerate(null); void action(() => regenerateLongEpisodeVideo(projectId, episodeNumber, job.jobId, scene)); }}>다시 시도</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {job?.status === "succeeded" && reviews && (
        <section data-testid="episode-video-review" className={cardSection}>
          <h3 className="flex items-center gap-2.5 text-base font-semibold">{dot}영상 검토</h3>
          {/* Recovery, not regeneration — the difference is $1.50 an Episode, so the button says which one it
              is before it is pressed. */}
          <div className="space-y-2 rounded-xl border border-violet-400/25 bg-violet-500/[0.06] p-3.5">
            <p className="text-sm text-slate-300">
              영상이 비어 있거나 재생되지 않으면 <strong className="text-slate-100">다시 만들 필요 없습니다</strong> — 이미 만들어진 영상을 가져옵니다. 추가 비용이 들지 않습니다.
            </p>
            <button type="button" data-testid="episode-video-recover" className={smallOutlineButton} disabled={busy} onClick={() => void recover()}>
              {busy ? "가져오는 중..." : "이미 만든 영상 가져오기"}
            </button>
            {recovery && (
              <p data-testid="episode-video-recovery-result" className="text-sm text-slate-300">
                {recovery.recoveredSceneNumbers.length}장면을 가져왔습니다.
                {recovery.unrecoverableScenes.length > 0 && (
                  /* Named, with the reason, and left failed. Regenerating them costs money, so the screen
                     reports and stops rather than deciding. */
                  <span className="mt-1 block text-amber-300">
                    가져오지 못한 장면: {recovery.unrecoverableScenes.map((scene) => `${scene.sceneNumber}번(${scene.reason})`).join(", ")} — 다시 만들려면 장면마다 비용이 듭니다.
                  </span>
                )}
              </p>
            )}
          </div>
          {/* Design system §4.3: overall confirmation progress before the per-scene cards. */}
          <p className="text-sm text-slate-300 tabular-nums" data-testid="episode-video-review-summary">
            {reviews.length}장면 중 {reviews.filter((review) => review.status === "approved").length}장면 확정
            {reviews.some((review) => review.costUsd !== undefined) && (
              <>
                {" · 이 작업에 쓴 비용 합계: $"}
                {reviews.reduce((sum, review) => sum + (review.costUsd ?? 0), 0).toFixed(2)}
              </>
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
          {reviews.map((review) => (
            <div
              key={review.sceneNumber}
              data-testid={`episode-video-review-${review.sceneNumber}`}
              data-status={review.status}
              className={`space-y-2 rounded-xl border bg-slate-950/40 p-3 ${review.status === "approved" ? "border-emerald-400/30" : "border-white/10"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-100">{review.sceneNumber}번 장면</span>
                <StatusChip tone={review.status === "approved" ? "success" : "neutral"}>
                  {review.status === "approved" ? "확정됨" : "검토 대기"}
                </StatusChip>
              </div>
              {unplayable.includes(review.sceneNumber) ? (
                <p data-testid={`episode-video-missing-${review.sceneNumber}`} className="rounded-lg border border-amber-400/30 bg-amber-500/[0.06] px-3 py-2 text-sm text-amber-200">
                  {recovery
                    ? "이 장면 영상은 남아 있지 않습니다. 보려면 다시 만들어야 하고, 비용이 듭니다."
                    : "영상을 아직 가져오지 않았습니다. 위의 '이미 만든 영상 가져오기'를 눌러 주세요."}
                </p>
              ) : (
                <video
                  data-testid={`episode-video-player-${review.sceneNumber}`}
                  className="w-full rounded-lg border border-white/10 bg-black"
                  controls
                  preload="metadata"
                  src={longEpisodeVideoContentUrl(projectId, episodeNumber, review.sceneNumber, String(videoVersion))}
                  onError={() => setUnplayable((current) => current.includes(review.sceneNumber) ? current : [...current, review.sceneNumber])}
                />
              )}
              {review.costUsd !== undefined && (
                <p className="text-xs text-slate-400 tabular-nums" data-testid={`episode-video-review-cost-${review.sceneNumber}`}>
                  이 장면에 쓴 비용: ${review.costUsd.toFixed(2)}
                </p>
              )}
              <div className="flex justify-end gap-3">
                <button type="button" className={smallOutlineButton} disabled={review.status === "approved"} onClick={() => void approve(review.sceneNumber)}>{review.status === "approved" ? "확정 완료" : "이 영상으로 확정"}</button>
                <button type="button" className={smallOutlineButton} onClick={() => setRegenerate(review.sceneNumber)}>다시 만들기</button>
              </div>
              {regenerate === review.sceneNumber && (
                <div role="alertdialog" data-testid={`episode-video-regenerate-confirm-${review.sceneNumber}`} className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3">
                  <p className="text-sm text-amber-200">{review.sceneNumber}번 장면을 다시 만들까요? Runway 키가 연결되어 있으면 이번 재생성분이 실제로 청구됩니다.</p>
                  <RetryCostNotice estimate={job.retryEstimate} sceneCount={1} data-testid={`episode-video-regenerate-cost-${review.sceneNumber}`} />
                  <div className="flex gap-2">
                    <button type="button" className={smallOutlineButton} onClick={() => setRegenerate(null)}>취소</button>
                    <button type="button" className={smallAmberButton} disabled={busy} onClick={() => { const scene = review.sceneNumber; setRegenerate(null); void action(() => regenerateLongEpisodeVideo(projectId, episodeNumber, job.jobId, scene)); }}>다시 만들기</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          </div>
        </section>
      )}
      {job?.episode.status === "videos_approved" && (
        <div data-testid="episode-videos-approved" className="space-y-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/5 p-5">
          <p className="text-sm text-emerald-400">{job.sceneNumbers.length}개 에피소드 영상이 모두 승인되었습니다.</p>
          <button type="button" data-testid="open-episode-video-merge" className={primaryButton} onClick={() => onOpenMerge(projectId, episodeNumber)}>최종 에피소드 영상 만들기</button>
        </div>
      )}
      {error && <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>}
    </section>
  );
}
