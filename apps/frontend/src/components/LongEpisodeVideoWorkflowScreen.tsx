import { useEffect, useRef, useState } from "react";
import type { GetLongEpisodeVideoPreviewResponse, LongEpisodeStatus, LongEpisodeVideoProgress, LongEpisodeVideoReview, RecoverLongEpisodeVideosResponse, SceneNumber } from "@ai-animation-studio/shared";

import { approveLongEpisodeVideoReview, episodeSceneErrorMessage, getLongEpisode, getLongEpisodeCurrentVideoJob, getLongEpisodeVideoPreview, getLongEpisodeVideoProgress, getLongEpisodeVideoReview, longEpisodeVideoContentUrl, recoverLongEpisodeVideos, regenerateAllLongEpisodeVideos, regenerateLongEpisodeVideo, restartLongEpisodeVideoGeneration, startLongEpisodeVideoGeneration, stopLongEpisodeVideoGeneration, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { LongEpisodeSceneVersions } from "./LongEpisodeSceneVersions.js";
import { Spinner } from "./Spinner.js";
import { videoRatioLabel } from "../utils/sceneFields.js";
import { omittedSectionLabel } from "../utils/omittedSectionLabels.js";
import { isLongEpisodeStatusBefore, longEpisodeStatusLabel } from "../utils/longEpisodeLabels.js";
import { RetryCostNotice } from "./ui/RetryCostNotice.js";
import { sceneRemedyAdvice } from "../utils/sceneFailureAdvice.js";
import { StatusChip } from "./ui/StatusChip.js";
import { StaleBadge } from "./ui/StaleBadge.js";
import { RegenerateInstructionField } from "./ui/RegenerateInstructionField.js";

interface Props { projectId: string; episodeNumber: number; onBack: () => void; onOpenMerge: (projectId: string, episodeNumber: number) => void; }
type DisplayError = { code: string; message: string };
/**
 * What a refusal on this screen is an answer to — named by what a person may conclude from it, not by which
 * function issued the request.
 *
 * "video-step"  whether this Episode may do video work at all. The current-job lookup, the paid 미리보기 and
 *               생성 시작 all sit behind the same backend readiness check, so all three refuse together and
 *               refuse for the same reason.
 * "progress"    reading one run's progress.
 * "job"         an action against a run that already exists (재시도 · 전체 재생성 · 이어서 · 중단).
 * "recover"     가져오기 — a download of clips already paid for, not a purchase.
 * "approve"     장면 승인.
 */
type ErrorSubject = "video-step" | "progress" | "job" | "recover" | "approve";
const LIMIT = 1000;

const outlineButton = "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const primaryButton = "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const dangerOutlineButton = "rounded-full border border-rose-400/30 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/10 disabled:opacity-50";
const smallOutlineButton = "rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50";
const smallAmberButton = "rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_12px_rgba(245,158,11,0.35)] disabled:opacity-50";
const textareaClassName = "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";
const dot = <span aria-hidden="true" className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]" />;

/**
 * How many scenes a paid action here actually buys.
 *
 * Not the number selected. A failed scene stops the pipeline — scenes carry continuity, so the run does not
 * skip past it — and clearing that failure resumes the whole job, sending every scene not yet succeeded
 * without asking again. The confirmation said 1 while two were charged (CLI Round 429 counted the
 * submissions). Quoting money low is the one direction this must never be wrong in.
 *
 * `pendingSceneCount` comes from the server rather than being counted out of the scene arrays here. The rule
 * is a fact about the backend's own halting behaviour, and this screen and the Episode one were deriving it
 * separately — which is exactly how two ends drift apart. Only two states are reachable, so the union is
 * `max(pending, selected)`: mid-generation the selected scene is itself one of the unfinished ones, and on a
 * finished job nothing is pending.
 *
 * Absent estimate means the local fake mode, where nothing is charged and the notice renders nothing anyway;
 * falling back to the selected count keeps the number honest rather than zero.
 */
function scenesRetryBuys(estimate: { pendingSceneCount: number } | undefined, selectedCount: number): number {
  return Math.max(estimate?.pendingSceneCount ?? 0, selectedCount);
}

export function LongEpisodeVideoWorkflowScreen({ projectId, episodeNumber, onBack, onOpenMerge }: Props) {
  const [preview, setPreview] = useState<GetLongEpisodeVideoPreviewResponse | null>(null);
  const [prompts, setPrompts] = useState<Partial<Record<SceneNumber, string>>>({});
  const [job, setJob] = useState<LongEpisodeVideoProgress | null>(null);
  const [reviews, setReviews] = useState<LongEpisodeVideoReview[] | null>(null);
  /**
   * The review list could not be fetched, which on a finished Episode is not a fault.
   *
   * Kept apart from `error` so a refusal of the extra request stops looking like the screen failing to load.
   * Never a reason to hide the job: `reviews` staying null already does that, and this only supplies the
   * sentence that says which of the two happened.
   */
  const [reviewsUnavailable, setReviewsUnavailable] = useState(false);
  /**
   * Scenes whose already-paid clip no longer matches the scene text, recomputed by the server from the prompt
   * recorded at generation rather than a flag someone has to remember to clear.
   *
   * A warning, never a lock: merging with a clip that has drifted is a legitimate choice once it is a choice.
   */
  const [videoStale, setVideoStale] = useState<SceneNumber[]>([]);
  const [confirmStart, setConfirmStart] = useState(false); const [regenerate, setRegenerate] = useState<SceneNumber | null>(null);
  /** One-off direction for the open confirmation, cleared on open and on close so it cannot follow to another scene. */
  const [regenerateInstruction, setRegenerateInstruction] = useState("");
  /** The all-scenes retry is its own two-step, never sharing the per-scene confirmation: they cost different amounts. */
  const [confirmRegenerateAll, setConfirmRegenerateAll] = useState(false);
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
  /** The Episode's step, read only after a blanket refusal — see the effect below. */
  const [blockedAt, setBlockedAt] = useState<LongEpisodeStatus | null>(null);
  /**
   * Which action the sentence in the error banner is an answer to.
   *
   * Every request on this screen writes into the same `error`, and the banner renders one red line with no
   * subject. That is how a person came to read 지금 이 에피소드 단계에서는 영상 작업을 할 수 없습니다 sitting
   * directly above a 다시 시도 button that was working, and reasonably asked whether pressing it was allowed.
   *
   * Both sentences were true, about different actions. The backend refuses video work outside
   * waiting_for_video_confirmation, and separately allows regenerating one failed scene of a run already going
   * (episode-videos.service.ts :137 and :633). Nothing on screen carried which of the two the red line meant,
   * so it could only be read as "everything here is blocked".
   *
   * Recorded at the call site rather than guessed at render time: a refusal that arrived from 가져오기 or 승인
   * must never be explained as a refusal about the Episode's step.
   */
  const [errorSubject, setErrorSubject] = useState<ErrorSubject | null>(null);
  const busyRef = useRef(false);
  /*
   * Paired with setError so the two cannot drift. `setError(null)` deliberately leaves the subject behind: it
   * is only read next to a non-null error, and every non-null error is set through here.
   */
  function fail(subject: ErrorSubject, caught: unknown): void { setError(toLongProjectDisplayError(caught)); setErrorSubject(subject); }
  /**
   * The review list, fetched as an addition to whatever just succeeded — never as a precondition for it.
   *
   * The route serves only videos_review and videos_approved, so its refusal is the ordinary answer for an
   * Episode past the review stage, not a failure. Rendered as the screen's own error it put a red
   * 지금 이 에피소드 단계에서는 영상 작업을 할 수 없습니다 across a job that had finished, whose clips were
   * bought and playing, and whose buttons still worked — which is how a person came to ask whether pressing
   * 다시 시도 was allowed.
   *
   * 🔴 That was fixed once, on the mount path, and the same call had two more callers: the progress poll and
   * 가져오기. Both still turned the refusal into a screen failure — and 가져오기's is worse, because there the
   * recovery had already succeeded and the red line reported the opposite. One function now, so the next
   * caller inherits the answer instead of the bug.
   *
   * `isCancelled` is for the mount effect, which can be torn down mid-flight; the others pass nothing.
   */
  async function loadReviews(jobId: string, isCancelled: () => boolean = () => false): Promise<void> {
    try {
      const review = await getLongEpisodeVideoReview(projectId, episodeNumber, jobId);
      if (isCancelled()) return;
      setReviews(review.reviews); setVideoStale(review.staleness.videoStale); setReviewsUnavailable(false);
    } catch { if (!isCancelled()) setReviewsUnavailable(true); }
  }
  const loadPreview = async () => { setError(null); try { const response = await getLongEpisodeVideoPreview(projectId, episodeNumber); setPreview(response); setPrompts(Object.fromEntries(response.scenes.map((scene) => [scene.sceneNumber, scene.prompt]))); } catch (caught) { fail("video-step", caught); } };
  /**
   * Restores the Episode's existing video job on mount, before falling back to the 미리보기.
   *
   * The job id used to live only in this screen's React state, so a reload showed "이 단계에서는 영상 작업을 할 수
   * 없습니다" and nothing else — the 검토 카드, the 회수 버튼 and the paid clips were all behind a `job` that could
   * only be set by pressing 생성 in that same page load. Money had already been spent and the screen could not
   * reach it.
   *
   * An Episode that never had a job is the ordinary case, and the route says so outright — it answers with
   * `jobId: null` and a 200, never an error (episode-videos.service.ts's currentJob: "Idleness is reported as
   * null instead of an error"). So reaching the catch means the question was not answered, which a blanket
   * `catch { jobId = null }` turned into the answer "there is none": a 500 or a dropped connection put the paid
   * 미리보기 and its price in front of an Episode whose clips were already bought, while the 검토 카드 and the
   * 회수 button — the two things that reach that spent money — disappeared with no error anywhere. That is the
   * regression this effect was written to prevent, reopened for every failure that is not "no job".
   *
   * The error is shown instead, and the preview is not attempted: an Episode never scripted answers this route
   * with LONG_EPISODE_VIDEOS_NOT_ALLOWED, and the preview route answers the same way, so falling through only
   * ever produced the same sentence one request later.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let jobId: string | null = null;
      try { jobId = (await getLongEpisodeCurrentVideoJob(projectId, episodeNumber)).jobId; }
      catch (caught) { if (!cancelled) fail("video-step", caught); return; }
      if (cancelled) return;
      if (jobId === null) { await loadPreview(); return; }
      try {
        const progress = await getLongEpisodeVideoProgress(projectId, episodeNumber, jobId);
        if (cancelled) return;
        setJob(progress);
        if (progress.status === "succeeded") {
          /* The review list is an addition to the progress above, not a precondition for it — and its refusal
             is the ordinary answer once the Episode is past the review stage: the route serves only
             videos_review and videos_approved. A finished Episode therefore opened this screen showing its
             completed job and all six scenes done, with a red 지금 이 에피소드 단계에서는 영상 작업을 할 수 없습니다
             across it, because the extra request's refusal was being rendered as the screen's own failure.
             The cards are simply absent; everything the progress response carries stays on screen, and the
             line below says why rather than leaving a person to guess what broke. */
          await loadReviews(jobId, () => cancelled);
        }
      } catch (caught) { if (!cancelled) fail("progress", caught); }
    })();
    return () => { cancelled = true; };
  }, [projectId, episodeNumber]);
  /**
   * How many polls in a row have failed — zero while the screen is current.
   *
   * 🔴 It also re-arms the timer. The effect below watched `job` alone, and a failed poll never called `setJob`
   * — so `job` did not change, the effect did not re-run, and no next timer was ever scheduled. **One failed
   * poll ended the polling for good**, while a six-scene paid run kept going behind a screen frozen at whatever
   * it last saw, with no way out but a reload. It did not take a malformed response to get there: one network
   * blip, or the backend restarting because a file was saved while 캡틴D runs it from source, was enough.
   */
  const [pollFailures, setPollFailures] = useState(0);
  const loadProgress = async () => {
    if (!job) return;
    let next: LongEpisodeVideoProgress;
    /*
     * A failed poll is a failure to re-read, not the loss of the run.
     *
     * So the last progress stays on screen and nothing goes into `error`: the red banner is for a request the
     * person is waiting on, and this one they did not ask for. What they get instead is a line saying the
     * screen is showing an older reading and is still trying — which is true, and is what a person needs to
     * decide whether to wait.
     */
    try { next = await getLongEpisodeVideoProgress(projectId, episodeNumber, job.jobId); }
    catch { setPollFailures((count) => count + 1); return; }
    setPollFailures(0);
    setJob(next);
    if (next.status === "succeeded") await loadReviews(next.jobId);
  };
  /* Backed off after a failure so a backend that is down is not asked twice a second — and so the sentence on
     screen stays true rather than flickering. */
  useEffect(() => {
    if (!job || (job.status !== "created" && job.status !== "running")) return;
    const timer = setTimeout(() => void loadProgress(), pollFailures > 0 ? 2000 : 400);
    return () => clearTimeout(timer);
  }, [job, pollFailures]);
  /**
   * What step this Episode is actually at, asked only when the route has refused the whole screen.
   *
   * "기다린다고 풀리지 않으니 에피소드 상태를 확인해 주세요" sends the person somewhere else to look up an
   * answer this app already has — and the refusal says nothing about which step is missing, so an Episode that
   * simply has no script yet reads the same as one that is genuinely stuck. The message comes from
   * `longProjectsApi`'s code table, which has no Episode to read; only the screen can add the step.
   *
   * One request, on the refused path alone. A failed lookup adds nothing rather than guessing — the original
   * refusal is still on screen, which is the honest floor.
   */
  useEffect(() => {
    if (error?.code !== "LONG_EPISODE_VIDEOS_NOT_ALLOWED") { setBlockedAt(null); return; }
    let cancelled = false;
    getLongEpisode(projectId, episodeNumber)
      .then((response) => { if (!cancelled) setBlockedAt(response.episode.status); })
      .catch(() => { /* Unknown, and an unknown step is exactly what the sentence below is withheld for. */ });
    return () => { cancelled = true; };
  }, [error?.code, projectId, episodeNumber]);
  const valid = preview !== null && preview.scenes.every((scene) => { const prompt = prompts[scene.sceneNumber] ?? ""; return prompt.trim().length > 0 && prompt.length <= LIMIT; });
  async function start(): Promise<void> { if (!preview || !valid || busyRef.current || !startRequestId) return; busyRef.current = true; setBusy(true); setError(null); try { const response = await startLongEpisodeVideoGeneration(projectId, episodeNumber, { confirmationId: preview.confirmationId, userRequestId: startRequestId, approved: true, prompts: preview.scenes.map((scene) => ({ sceneNumber: scene.sceneNumber, prompt: prompts[scene.sceneNumber] ?? "" })) }); setJob({ paidProvider: response.paidProvider, jobId: response.jobId, status: "created", completedSceneNumbers: [], failedSceneNumbers: [], sceneNumbers: preview.scenes.map((scene) => scene.sceneNumber), episode: response.episode }); setConfirmStart(false); setStartRequestId(null); } catch (caught) { fail("video-step", caught); } finally { busyRef.current = false; setBusy(false); } }
  async function action(fn: () => Promise<LongEpisodeVideoProgress>): Promise<void> { if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(null); try { setJob(await fn()); setUnplayable([]); setVideoVersion((current) => current + 1); } catch (caught) { fail("job", caught); } finally { busyRef.current = false; setBusy(false); } }
  /**
   * Fetches the clips Runway already made, using the task ids on record.
   *
   * A bug wrote a 32-byte placeholder over every downloaded clip after paying for it — $1.50 an Episode, and
   * the screen reported success. This is a download, not a generation: nothing reaches the ledger. Scenes whose
   * output can no longer be fetched come back named, with a reason, and are left failed — spending money again
   * is the person's decision, not a fallback.
   */
  const [recovery, setRecovery] = useState<RecoverLongEpisodeVideosResponse | null>(null);
  /** Opened from the failed-scenes section, where pressing it has a consequence worth stating first. */
  const [recoverConfirm, setRecoverConfirm] = useState(false);
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
      /* Outside the catch on purpose: the clips are already back at this point, and a refused review list must
         not be reported as "가져오기에 실패했습니다". */
      await loadReviews(response.jobId);
    } catch (caught) { fail("recover", caught); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function approve(sceneNumber: SceneNumber): Promise<void> { if (!job) return; try { const response = await approveLongEpisodeVideoReview(projectId, episodeNumber, job.jobId, sceneNumber); setJob((current) => current ? { ...current, episode: response.episode } : current); setReviews(response.reviews); setVideoStale(response.staleness.videoStale); } catch (caught) { fail("approve", caught); } }
  return (
    <section className="mt-8 space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>에피소드 이미지로</button>
      <header className="space-y-1">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold">{dot}{`에피소드 ${episodeNumber} 영상 작업`}</h2>
        {/*
          * Before a run exists this is genuinely conditional and says both branches. Once one exists it is not:
          * the server answered with `paidProvider`, this screen has been storing that answer since the start
          * response and never reading it, and leaving the two-branch sentence up makes the person work out
          * which case they are in about their own money. The short project says which; this now does too.
          */}
        <p data-testid="episode-video-provider-notice" className="text-sm text-amber-300">
          {job === null
            ? "Runway 키가 연결되어 있으면 장면마다 실제 유료 요청이 전송됩니다. 연결되어 있지 않으면 비용 없이 임시 영상으로 만들어집니다."
            : job.paidProvider
              ? "이 작업은 실제 유료 Runway API를 호출합니다. 장면마다 비용이 발생하며, 재생성하면 그만큼 다시 청구됩니다."
              : "Runway 키가 연결되어 있지 않아 비용 없이 임시 영상으로 만들어집니다. 키를 연결하면 실제 유료 요청이 전송됩니다."}
        </p>
      </header>
      {!preview && !job && !error && <Spinner label="영상 작업을 불러오는 중..." />}
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
                이번 요청의 예상 비용이 남은 월 예산을 초과합니다. 그대로 진행하면 예산 한도에 막혀 실패할 수 있습니다.
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
                {/* The server drops sections in a fixed order to fit the limit and says which. The short project
                    has shown this since its preview shipped; the Episode threw the list away, so a scene could
                    lose its pacing or performance direction and the only way to find out was a finished clip
                    that was wrong — after paying for it. Same sentence as the short project on purpose. */}
                {scene.omittedSections && scene.omittedSections.length > 0 && (
                  <p data-testid={`episode-video-omitted-${scene.sceneNumber}`} className="text-xs text-amber-300">
                    길이 제한 때문에 이 장면에서 {scene.omittedSections.map(omittedSectionLabel).join(", ")} 설명이 빠졌습니다.
                    꼭 필요하면 위 프롬프트에 직접 짧게 적어 주세요.
                  </p>
                )}
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
          {/*
            * Said where the numbers are, because the numbers are what has gone stale.
            *
            * Not `role="alert"` and not red: nothing has failed for the person — the run is not this screen's
            * reading of it, and a paid run does not stop because a poll did. What is claimed is only what is
            * known: this list is an older reading, and the screen is still trying. Whether the run itself is
            * still going is exactly what could not be read, so it is not asserted either way.
            *
            * The button is the seventh twin asymmetry closed: the short project's screen has always offered a
            * 다시 시도 in this situation and this one offered nothing, and this is the screen where six paid
            * scenes are generated.
            */}
          {pollFailures > 0 && (job.status === "created" || job.status === "running") && (
            <div data-testid="episode-video-progress-stale" className="space-y-2 rounded-lg border border-amber-400/30 bg-amber-500/[0.06] p-3">
              <p className="text-sm text-amber-200">
                진행 상황을 다시 읽지 못했습니다. <span className="font-semibold">위 목록은 마지막으로 확인된 상태</span>이고, 계속 다시 확인하고 있습니다.
              </p>
              <button type="button" data-testid="episode-video-progress-recheck" className={smallOutlineButton} onClick={() => void loadProgress()}>지금 다시 확인</button>
            </div>
          )}
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
          {/*
            * 🔴 The free exit, offered before the paid one.
            *
            * A `timeout` is us giving up on a task Runway was still working on, and a `no_output` is a finished
            * task whose URL had not appeared yet. Both are written `failed`, both are already on the ledger,
            * and both usually leave a finished clip sitting at the provider. Recovery reaches those records now
            * (CLI's 44fea33) — but the only button this section has ever offered is 다시 시도, which buys the
            * same seconds a second time. This section is where that costs $0.25 a scene.
            *
            * A confirmation rather than one click, because the consequence is not only a download. A record
            * that comes back flips from failed to succeeded, and that failure is the only thing holding the
            * rest of the Episode still — the run's own state never changed. Reading the progress is what
            * advances the run, and this screen reads it immediately, so the next scene is submitted right
            * after. Free to press, not free afterwards, and the dialog says both.
            */}
          <div className="space-y-2 rounded-xl border border-violet-400/25 bg-violet-500/[0.06] p-3.5">
            <p className="text-sm text-slate-300">
              멈춘 장면 중에는 <strong className="text-slate-100">이미 만들어져 있는 것</strong>이 있을 수 있습니다 — 기다리다 끊겼거나 결과가 늦게 붙은 경우입니다. 가져오기는 무료라서, 다시 만들기 전에 먼저 해 보실 수 있습니다.
            </p>
            <button type="button" data-testid="episode-video-failed-recover" className={smallOutlineButton} disabled={busy || recoverConfirm} onClick={() => setRecoverConfirm(true)}>
              {busy ? "가져오는 중..." : "이미 만든 영상 먼저 가져오기 (무료)"}
            </button>
            {recoverConfirm && (
              <div role="alertdialog" aria-label="이미 만든 영상 가져오기 확인" data-testid="episode-video-failed-recover-confirm" className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3">
                <p className="text-sm text-slate-300">가져오기 자체는 <strong className="text-slate-100">비용이 들지 않습니다</strong> — 상태를 묻고 내려받기만 합니다. 못 찾으면 아무것도 바뀌지 않습니다.</p>
                <p className="text-sm text-amber-200">
                  다만 되찾은 장면은 <strong className="text-amber-100">실패가 풀립니다.</strong> 그러면 남은 장면이 있는 경우 <strong className="text-amber-100">곧바로 이어서 만들어지고, 그 장면들은 청구됩니다</strong>. 되찾은 것이 마지막 장면이면 검토로 넘어가고 추가 비용은 없습니다.
                </p>
                <div className="flex gap-2">
                  <button type="button" className={smallOutlineButton} onClick={() => setRecoverConfirm(false)}>취소</button>
                  <button type="button" data-testid="episode-video-failed-recover-confirm-button" className={smallAmberButton} disabled={busy} onClick={() => { setRecoverConfirm(false); void recover(); }}>예, 가져옵니다</button>
                </div>
              </div>
            )}
            {recovery && (
              <p data-testid="episode-video-failed-recovery-result" className="text-sm text-slate-300">
                {recovery.recoveredSceneNumbers.length}장면을 가져왔습니다.
                {recovery.unrecoverableScenes.length > 0 && ` 가져오지 못한 장면: ${recovery.unrecoverableScenes.map((scene) => `${scene.sceneNumber}번(${scene.reason})`).join(", ")} — 다시 만들려면 장면마다 비용이 듭니다.`}
              </p>
            )}
          </div>
          <ul className="space-y-2">
            {job.failedSceneNumbers.map((scene) => {
              /*
               * The provider's answer about this one scene, and what it means for the button beside it.
               *
               * 🔴 `undefined` is "no failure detail in this response", never "safe". Everything below falls
               * back to what the screen said before the contract existed rather than reading absence as an
               * answer — a response from a build that predates `sceneFailures` must not become a claim.
               */
              const failure = job.sceneFailures?.[scene];
              const mustChangeInput = failure?.remedy === "change_input";
              const cannotRetry = failure?.remedy === "not_retryable";
              return (
              <li key={scene} data-testid={`episode-video-failed-${scene}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-950/60 p-3">
                <div className="flex-1 space-y-1">
                  <span className="text-sm text-slate-300">{scene}번 장면</span>
                  <p data-testid={`episode-video-failed-reason-${scene}`} className="text-xs text-rose-300">{episodeSceneErrorMessage(job.sceneErrors?.[scene], failure?.providerCode)}</p>
                </div>
                {/* Withheld only on a definite not_retryable. The provider says the same request never passes
                    — SAFETY.INPUT and SAFETY.OUTPUT — so offering a paid button here would be selling a press
                    whose outcome is already known. The sentence takes its place rather than nothing, and
                    「모든 장면 다시 만들기」 below is still there for a real re-do. */}
                {cannotRetry ? (
                  <p data-testid={`episode-video-failed-not-retryable-${scene}`} className="text-xs text-rose-200">
                    {sceneRemedyAdvice(failure?.remedy)}
                  </p>
                ) : (
                  <button type="button" data-testid={`episode-video-failed-retry-${scene}`} className={smallOutlineButton} disabled={busy || regenerate === scene} onClick={() => { setConfirmRegenerateAll(false); setRegenerateInstruction(""); setRegenerate(scene); }}>다시 시도</button>
                )}
                {regenerate === scene && (
                  <div role="alertdialog" data-testid={`episode-video-failed-retry-confirm-${scene}`} className="w-full space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3">
                    <p className="text-sm text-amber-200">{scene}번 장면을 다시 시도할까요? Runway 키가 연결되어 있으면 이번 시도분이 실제로 청구됩니다.</p>
                    <RetryCostNotice estimate={job.retryEstimate} sceneCount={scenesRetryBuys(job.retryEstimate, 1)} data-testid={`episode-video-failed-retry-cost-${scene}`} />
                    {/*
                     * What the sentence above leaves out, standing where the decision is made.
                     *
                     * "이번 시도분이 실제로 청구됩니다" reads as a statement about a successful attempt. It is not:
                     * the ledger records the amount, not the outcome. Episode 5 scene 3 failed twice and left two
                     * $0.25 rows behind it with no clip. Someone who believes a failed attempt is free has no
                     * reason not to press the same button again, which is what happened.
                     *
                     * 🔴 Asymmetric on purpose. It is said when the contract says billed, and when the response
                     * carries no failure detail at all — the ledger is the evidence for that second case, and it
                     * is what this screen said before the field existed. It is NOT turned into "청구되지
                     * 않습니다" on a false: a record stored before `failure_code` existed reports false for
                     * having no code rather than for having been free, and a wrong "you were not charged" costs
                     * money while a wrong "you were" costs a moment.
                     */}
                    {(failure === undefined || failure.billedOnFailure) && (
                      <p data-testid={`episode-video-failed-retry-billing-${scene}`} className="text-sm text-rose-200">
                        <strong className="font-semibold">실패해도 이 시도분은 청구됩니다.</strong>
                      </p>
                    )}
                    {/* Three answers to a question that used to get one. See episodeSceneRemedyAdvice — under
                        change_input the sentence is a certainty, not a caution, because that is what the code
                        means. */}
                    <p data-testid={`episode-video-failed-retry-remedy-${scene}`} className={mustChangeInput ? "text-sm font-semibold text-rose-200" : "text-sm text-slate-300"}>
                      {sceneRemedyAdvice(failure?.remedy)}
                    </p>
                    {/*
                     * The one place a retry could change anything, and it was the one place that could not.
                     *
                     * `additionalInstruction` exists on the request, the API function takes it, and
                     * `episode-videos.service.ts` appends it to the scene's prompt — and this path sent none, so
                     * pressing 다시 시도 re-sent a byte-identical request. Scene 3 of Episode 5 failed twice that
                     * way for $0.25 each: the model was told to disintegrate a face while the prompt's own fixed
                     * suffix says to keep anatomy stable, and no amount of retrying resolves a contradiction.
                     * The review-stage regeneration below has carried this field all along; this one did not.
                     */}
                    <RegenerateInstructionField
                      id={`episode-video-failed-retry-instruction-${scene}`}
                      value={regenerateInstruction}
                      onChange={setRegenerateInstruction}
                      disabled={busy}
                      subject="영상"
                      placeholder="예: 얼굴은 온전하게 유지한다"
                      data-testid={`episode-video-failed-retry-instruction-${scene}`}
                    />
                    <div className="flex gap-2">
                      <button type="button" className={smallOutlineButton} onClick={() => { setRegenerateInstruction(""); setRegenerate(null); }}>취소</button>
                      {/* 🔴 Under change_input an unchanged request is a paid request with a known outcome, so
                          the submit waits for the one thing that changes it. Not a lock on the person's
                          judgement — 취소 is right there, and 모든 장면 다시 만들기 is untouched — but the
                          default stops being "press again and hope". Never applied without the field: with no
                          failure detail the button behaves exactly as it did. */}
                      <button type="button" className={smallAmberButton} disabled={busy || (mustChangeInput && regenerateInstruction.trim().length === 0)} onClick={() => { const instruction = regenerateInstruction; setRegenerate(null); setRegenerateInstruction(""); void action(() => regenerateLongEpisodeVideo(projectId, episodeNumber, job.jobId, scene, instruction)); }}>다시 시도</button>
                    </div>
                  </div>
                )}
              </li>
              );
            })}
          </ul>
        </section>
      )}
      {/* Said from the Episode's own status, which the progress response carries — never inferred from the
          refusal that got us here. "완료" is a finished work, not a problem, and the previous screen said the
          opposite in red. */}
      {job?.status === "succeeded" && !reviews && reviewsUnavailable && (
        <p data-testid="episode-video-review-unavailable" className="rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
          이 회차는 <strong className="text-slate-100">{longEpisodeStatusLabel(job.episode.status)}</strong> 상태라 여기서 장면 영상을 다시 확정하거나 다시 만들 수 없습니다.
          위의 장면 목록과 최종 영상은 그대로 남아 있습니다.
        </p>
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
          {/* Twelve scenes meant twelve clicks and twelve confirmations, each naming one clip's cost, with no
              point at which the total was ever said out loud. This says it once. */}
          <div className="space-y-2 rounded-xl border border-white/10 bg-slate-950/40 p-3">
            {!confirmRegenerateAll ? (
              <button
                type="button"
                data-testid="episode-video-regenerate-all"
                className={smallOutlineButton}
                disabled={busy}
                /* Closes the per-scene one. Two open confirmations would stand side by side quoting one scene
                   and six — two prices for two actions, and the reader has to notice which panel they are in. */
                onClick={() => { setRegenerate(null); setRegenerateInstruction(""); setConfirmRegenerateAll(true); }}
              >
                모든 장면 다시 만들기
              </button>
            ) : (
              <div role="alertdialog" aria-label="모든 장면 다시 만들기 확인" data-testid="episode-video-regenerate-all-confirm" className="space-y-2">
                <p className="text-sm text-amber-200">
                  {reviews.length}장면을 모두 다시 만들까요? Runway 키가 연결되어 있으면 <strong className="text-amber-100">{reviews.length}장면 전부가 다시 청구됩니다.</strong>
                </p>
                {/* The same estimate the per-scene panel shows, multiplied by what is actually being bought —
                    the one number a person needs before this press and could not get by adding up twelve. */}
                <RetryCostNotice estimate={job.retryEstimate} sceneCount={scenesRetryBuys(job.retryEstimate, reviews.length)} data-testid="episode-video-regenerate-all-cost" />
                <RegenerateInstructionField
                  id="episode-video-regenerate-all-instruction"
                  value={regenerateInstruction}
                  onChange={setRegenerateInstruction}
                  disabled={busy}
                  subject="영상"
                  placeholder="예: 카메라를 더 천천히"
                  data-testid="episode-video-regenerate-all-instruction"
                />
                <div className="flex gap-2">
                  <button type="button" className={smallOutlineButton} disabled={busy} onClick={() => { setRegenerateInstruction(""); setConfirmRegenerateAll(false); }}>취소</button>
                  <button
                    type="button"
                    className={smallAmberButton}
                    data-testid="episode-video-regenerate-all-confirm-button"
                    disabled={busy}
                    onClick={() => { const instruction = regenerateInstruction; setConfirmRegenerateAll(false); setRegenerateInstruction(""); void action(() => regenerateAllLongEpisodeVideos(projectId, episodeNumber, job.jobId, instruction)); }}
                  >
                    예, 전부 다시 생성합니다
                  </button>
                </div>
              </div>
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-100">{review.sceneNumber}번 장면</span>
                <span className="flex flex-wrap items-center gap-2">
                  {/* The same badge the short project uses, on purpose — one wording for one fact. */}
                  <StaleBadge
                    staleSceneNumbers={videoStale}
                    sceneNumber={review.sceneNumber}
                    kind="video"
                    data-testid={`episode-video-stale-${review.sceneNumber}`}
                  />
                  <StatusChip tone={review.status === "approved" ? "success" : "neutral"}>
                    {review.status === "approved" ? "확정됨" : "검토 대기"}
                  </StatusChip>
                </span>
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
                <button type="button" className={smallOutlineButton} onClick={() => { setConfirmRegenerateAll(false); setRegenerateInstruction(""); setRegenerate(review.sceneNumber); }}>다시 만들기</button>
              </div>
              {/* The clips this scene has had. Collapsed, and absent entirely when there is no history. */}
              <LongEpisodeSceneVersions
                projectId={projectId}
                episodeNumber={episodeNumber}
                sceneNumber={review.sceneNumber}
                onRestored={(episode) => {
                  /* Restoring voids the merged final video, so the Episode comes back in a different state than
                     the one we asked from — and the scene's bytes changed, so the players must refetch. */
                  setJob((current) => current ? { ...current, episode } : current);
                  setUnplayable([]);
                  setVideoVersion((current) => current + 1);
                }}
              />
              {regenerate === review.sceneNumber && (
                <div role="alertdialog" data-testid={`episode-video-regenerate-confirm-${review.sceneNumber}`} className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3">
                  <p className="text-sm text-amber-200">{review.sceneNumber}번 장면을 다시 만들까요? Runway 키가 연결되어 있으면 이번 재생성분이 실제로 청구됩니다.</p>
                  <RetryCostNotice estimate={job.retryEstimate} sceneCount={scenesRetryBuys(job.retryEstimate, 1)} data-testid={`episode-video-regenerate-cost-${review.sceneNumber}`} />
                  {/* The same field the short project's video retry uses. Used once and never stored, so the
                      staleness badge keeps measuring the clip against the script rather than against a passing
                      note — the server records the plain prompt separately for exactly that reason. */}
                  <RegenerateInstructionField
                    id={`episode-video-regenerate-instruction-${review.sceneNumber}`}
                    value={regenerateInstruction}
                    onChange={setRegenerateInstruction}
                    disabled={busy}
                    subject="영상"
                    placeholder="예: 카메라를 더 천천히, 인물을 더 가깝게"
                    data-testid={`episode-video-regenerate-instruction-${review.sceneNumber}`}
                  />
                  <div className="flex gap-2">
                    <button type="button" className={smallOutlineButton} onClick={() => { setRegenerateInstruction(""); setRegenerate(null); }}>취소</button>
                    <button type="button" className={smallAmberButton} disabled={busy} onClick={() => { const scene = review.sceneNumber; const instruction = regenerateInstruction; setRegenerate(null); setRegenerateInstruction(""); void action(() => regenerateLongEpisodeVideo(projectId, episodeNumber, job.jobId, scene, instruction)); }}>예, 다시 생성합니다</button>
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
      {/* Named beneath the refusal, never instead of it: the server's sentence is still the reason, this is
          only the step the person can go and do. Withheld once the Episode is at or past the video step,
          where "이 단계에서는 할 수 없다" means something other than a missing earlier step. */}
      {/* At or past the video step the refusal is not about a missing earlier step, so the hint below is
          withheld — and until now nothing took its place, leaving a bare red line above buttons that still
          worked. Said only for a refusal recorded as being about the Episode's step: the ones from 가져오기 or
          승인 are different refusals and must not be explained as this one. waiting_for_video_confirmation is
          excluded because video work is allowed there, so a refusal at that step means something this screen
          has not established. The second sentence is withheld unless a run is actually on screen — it is a
          statement about buttons, and with no job there are none. It claims nothing about any particular
          button, only that they are not what this line answered. */}
      {error?.code === "LONG_EPISODE_VIDEOS_NOT_ALLOWED" && errorSubject === "video-step" && blockedAt && blockedAt !== "waiting_for_video_confirmation" && !isLongEpisodeStatusBefore(blockedAt, "waiting_for_video_confirmation") && (
        <p data-testid="episode-video-refusal-subject" className="text-sm text-amber-300">
          이 문장은 <span className="font-semibold">이 에피소드에서 영상 작업을 시작하는 것</span>에 대한 답입니다. 이미{" "}
          <span className="font-semibold">{longEpisodeStatusLabel(blockedAt)}</span> 단계라 새로 시작할 수는 없습니다.
          {job !== null && <> 위에 남아 있는 버튼들은 각각 다른 검사를 거치므로, 이 문장 때문에 막힌 것이 아닙니다.</>}
        </p>
      )}
      {error?.code === "LONG_EPISODE_VIDEOS_NOT_ALLOWED" && errorSubject === "video-step" && blockedAt && isLongEpisodeStatusBefore(blockedAt, "waiting_for_video_confirmation") && (
        <p data-testid="episode-video-next-step" className="text-sm text-amber-300">
          지금은 <span className="font-semibold">{longEpisodeStatusLabel(blockedAt)}</span> 단계입니다.{" "}
          {isLongEpisodeStatusBefore(blockedAt, "script_approved")
            ? <>왼쪽의 <span className="font-semibold">장면 대본</span>부터 끝내 주세요.</>
            : isLongEpisodeStatusBefore(blockedAt, "asset_mapping_approved")
              ? <>왼쪽의 <span className="font-semibold">참고 이미지 연결</span>을 승인해 주세요.</>
              : <>왼쪽의 <span className="font-semibold">장면 이미지</span>를 만들고 승인해 주세요.</>}
        </p>
      )}
    </section>
  );
}
