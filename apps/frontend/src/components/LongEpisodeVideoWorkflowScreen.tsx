import { useEffect, useRef, useState } from "react";
import type { LongEpisodeVideoProgress, LongEpisodeVideoReview, LongEpisodeVideoPreview, SceneNumber } from "@ai-animation-studio/shared";

import { approveLongEpisodeVideoReview, getLongEpisodeVideoPreview, getLongEpisodeVideoProgress, getLongEpisodeVideoReview, regenerateLongEpisodeVideo, restartLongEpisodeVideoGeneration, startLongEpisodeVideoGeneration, stopLongEpisodeVideoGeneration, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { Spinner } from "./Spinner.js";

interface Props { projectId: string; episodeNumber: number; onBack: () => void; onOpenMerge: (projectId: string, episodeNumber: number) => void; }
type DisplayError = { code: string; message: string };
const SCENES = [1, 2, 3, 4, 5, 6] as const satisfies readonly SceneNumber[];
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
  const [preview, setPreview] = useState<{ confirmationId: string; scenes: LongEpisodeVideoPreview[]; estimatedCostUsd: number } | null>(null);
  const [prompts, setPrompts] = useState<Partial<Record<SceneNumber, string>>>({});
  const [job, setJob] = useState<LongEpisodeVideoProgress | null>(null);
  const [reviews, setReviews] = useState<LongEpisodeVideoReview[] | null>(null);
  const [confirmStart, setConfirmStart] = useState(false); const [regenerate, setRegenerate] = useState<SceneNumber | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<DisplayError | null>(null);
  const busyRef = useRef(false);
  const loadPreview = async () => { setError(null); try { const response = await getLongEpisodeVideoPreview(projectId, episodeNumber); setPreview(response); setPrompts(Object.fromEntries(response.scenes.map((scene) => [scene.sceneNumber, scene.prompt]))); } catch (caught) { setError(toLongProjectDisplayError(caught)); } };
  useEffect(() => { void loadPreview(); }, [projectId, episodeNumber]);
  const loadProgress = async () => { if (!job) return; try { const next = await getLongEpisodeVideoProgress(projectId, episodeNumber, job.jobId); setJob(next); if (next.status === "succeeded") { const review = await getLongEpisodeVideoReview(projectId, episodeNumber, next.jobId); setReviews(review.reviews); } } catch (caught) { setError(toLongProjectDisplayError(caught)); } };
  useEffect(() => { if (!job || (job.status !== "created" && job.status !== "running")) return; const timer = setTimeout(() => void loadProgress(), 400); return () => clearTimeout(timer); }, [job]);
  const valid = preview !== null && preview.scenes.every((scene) => { const prompt = prompts[scene.sceneNumber] ?? ""; return prompt.trim().length > 0 && prompt.length <= LIMIT; });
  async function start(): Promise<void> { if (!preview || !valid || busyRef.current) return; busyRef.current = true; setBusy(true); setError(null); try { const response = await startLongEpisodeVideoGeneration(projectId, episodeNumber, { confirmationId: preview.confirmationId, userRequestId: crypto.randomUUID(), approved: true, prompts: preview.scenes.map((scene) => ({ sceneNumber: scene.sceneNumber, prompt: prompts[scene.sceneNumber] ?? "" })) }); setJob({ jobId: response.jobId, status: "created", completedSceneNumbers: [], failedSceneNumbers: [], episode: response.episode }); setConfirmStart(false); } catch (caught) { setError(toLongProjectDisplayError(caught)); } finally { busyRef.current = false; setBusy(false); } }
  async function action(fn: () => Promise<LongEpisodeVideoProgress>): Promise<void> { if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(null); try { setJob(await fn()); } catch (caught) { setError(toLongProjectDisplayError(caught)); } finally { busyRef.current = false; setBusy(false); } }
  async function approve(sceneNumber: SceneNumber): Promise<void> { if (!job) return; try { const response = await approveLongEpisodeVideoReview(projectId, episodeNumber, job.jobId, sceneNumber); setJob((current) => current ? { ...current, episode: response.episode } : current); setReviews(response.reviews); } catch (caught) { setError(toLongProjectDisplayError(caught)); } }
  return (
    <section className="mt-8 space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>Episode images</button>
      <header className="space-y-1">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold">{dot}{`Episode ${episodeNumber} video workflow`}</h2>
        <p data-testid="episode-video-local-notice" className="text-sm text-amber-300">Local fake video workflow only. No Runway or provider request is sent.</p>
      </header>
      {!preview && !error && <Spinner label="Loading local video preview..." />}
      {preview && !job && (
        <div className={cardSection}>
          <p data-testid="episode-video-summary" className="text-sm text-slate-300">Sequential · ${preview.estimatedCostUsd.toFixed(2)}</p>
          <ol className="space-y-3">
            {preview.scenes.map((scene) => (
              <li key={scene.sceneNumber} className="space-y-1">
                <label className="block text-sm text-slate-300">
                  {`Scene ${scene.sceneNumber} prompt`}
                  <textarea data-testid={`episode-video-prompt-${scene.sceneNumber}`} className={textareaClassName} value={prompts[scene.sceneNumber] ?? ""} disabled={confirmStart || busy} onChange={(event) => setPrompts((current) => ({ ...current, [scene.sceneNumber]: event.target.value }))} />
                </label>
                <span className="text-xs text-slate-500">{(prompts[scene.sceneNumber] ?? "").length} / {LIMIT}</span>
              </li>
            ))}
          </ol>
          <button type="button" data-testid="episode-video-open-confirm" className={primaryButton} disabled={!valid || confirmStart} onClick={() => setConfirmStart(true)}>Open local generation confirmation</button>
          {confirmStart && (
            <div role="alertdialog" data-testid="episode-video-start-confirm" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
              <p className="text-sm text-amber-200">Opening this confirmation made no request. Start the local fake sequential video job?</p>
              <div className="flex gap-3">
                <button type="button" className={outlineButton} disabled={busy} onClick={() => setConfirmStart(false)}>Cancel</button>
                <button type="button" className={primaryButton} disabled={busy} onClick={() => void start()}>Start local fake videos</button>
              </div>
            </div>
          )}
        </div>
      )}
      {job && (
        <section data-testid="episode-video-progress" className={cardSection}>
          <p className="text-sm text-slate-300">Job: {job.status}</p>
          <ol className="grid grid-cols-2 gap-2 text-sm text-slate-300 sm:grid-cols-3">
            {SCENES.map((scene) => <li key={scene} data-testid={`episode-video-progress-${scene}`} className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2">{scene}: {job.completedSceneNumbers.includes(scene) ? "completed" : job.currentSceneNumber === scene ? "running" : job.failedSceneNumbers.includes(scene) ? "failed" : "pending"}</li>)}
          </ol>
          {(job.status === "created" || job.status === "running") && <button type="button" className={dangerOutlineButton} disabled={busy} onClick={() => void action(() => stopLongEpisodeVideoGeneration(projectId, episodeNumber, job.jobId))}>Stop</button>}
          {job.status === "interrupted" && <button type="button" className={outlineButton} disabled={busy} onClick={() => void action(() => restartLongEpisodeVideoGeneration(projectId, episodeNumber, job.jobId))}>Restart</button>}
        </section>
      )}
      {job?.status === "failed" && (
        <section data-testid="episode-video-failed-scenes" className={cardSection}>
          <p className="text-sm text-amber-300">Some scenes failed. You can retry a failed scene below.</p>
          <ul className="space-y-2">
            {job.failedSceneNumbers.map((scene) => (
              <li key={scene} data-testid={`episode-video-failed-${scene}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-950/60 p-3">
                <span className="text-sm text-slate-300">Scene {scene}</span>
                <button type="button" data-testid={`episode-video-failed-retry-${scene}`} className={smallOutlineButton} disabled={busy || regenerate === scene} onClick={() => setRegenerate(scene)}>Retry scene</button>
                {regenerate === scene && (
                  <div role="alertdialog" data-testid={`episode-video-failed-retry-confirm-${scene}`} className="w-full space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3">
                    <p className="text-sm text-amber-200">Retry Scene {scene} with local fake video only?</p>
                    <div className="flex gap-2">
                      <button type="button" className={smallOutlineButton} onClick={() => setRegenerate(null)}>Cancel</button>
                      <button type="button" className={smallAmberButton} disabled={busy} onClick={() => { setRegenerate(null); void action(() => regenerateLongEpisodeVideo(projectId, episodeNumber, job.jobId, scene)); }}>Retry scene</button>
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
          <h3 className="flex items-center gap-2.5 text-base font-semibold">{dot}Video review</h3>
          {reviews.map((review) => (
            <div key={review.sceneNumber} data-testid={`episode-video-review-${review.sceneNumber}`} data-status={review.status} className="space-y-2 border-t border-white/10 pt-3">
              <p className="text-sm text-slate-300">Scene {review.sceneNumber}: {review.status}</p>
              <div className="flex gap-3">
                <button type="button" className={smallOutlineButton} disabled={review.status === "approved"} onClick={() => void approve(review.sceneNumber)}>{review.status === "approved" ? "Approved" : "Approve"}</button>
                <button type="button" className={smallOutlineButton} onClick={() => setRegenerate(review.sceneNumber)}>Regenerate</button>
              </div>
              {regenerate === review.sceneNumber && (
                <div role="alertdialog" data-testid={`episode-video-regenerate-confirm-${review.sceneNumber}`} className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3">
                  <p className="text-sm text-amber-200">Regenerate Scene {review.sceneNumber} with local fake video only?</p>
                  <div className="flex gap-2">
                    <button type="button" className={smallOutlineButton} onClick={() => setRegenerate(null)}>Cancel</button>
                    <button type="button" className={smallAmberButton} disabled={busy} onClick={() => { const scene = review.sceneNumber; setRegenerate(null); void action(() => regenerateLongEpisodeVideo(projectId, episodeNumber, job.jobId, scene)); }}>Regenerate scene</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
      {job?.episode.status === "videos_approved" && (
        <div data-testid="episode-videos-approved" className="space-y-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/5 p-5">
          <p className="text-sm text-emerald-400">All six Episode videos are approved.</p>
          <button type="button" data-testid="open-episode-video-merge" className={primaryButton} onClick={() => onOpenMerge(projectId, episodeNumber)}>Create final Episode video</button>
        </div>
      )}
      {error && <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>}
    </section>
  );
}
