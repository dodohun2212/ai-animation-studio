import { useRef, useState } from "react";
import type { MergeLongEpisodeVideosResponse } from "@ai-animation-studio/shared";

import { mergeLongEpisodeVideos, toLongProjectDisplayError } from "../api/longProjectsApi.js";

interface Props {
  projectId: string;
  episodeNumber: number;
  onBack: () => void;
  onOpenContinuity?: (projectId: string, episodeNumber: number) => void;
}

type DisplayError = { code: string; message: string };

/** The explicit, final client gate for one Episode's already-approved videos. */
export function LongEpisodeVideoMergeScreen({ projectId, episodeNumber, onBack, onOpenContinuity }: Props) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MergeLongEpisodeVideosResponse | null>(null);
  const [error, setError] = useState<DisplayError | null>(null);
  const busy = useRef(false);

  function openConfirmation(): void {
    if (busy.current || result) return;
    setError(null);
    setConfirmationOpen(true);
  }

  async function confirm(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      setResult(await mergeLongEpisodeVideos(projectId, episodeNumber));
      setConfirmationOpen(false);
    } catch (caught) {
      setError(toLongProjectDisplayError(caught));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <section className="mt-8 max-w-2xl space-y-5" data-testid="episode-video-merge-screen">
      <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5" onClick={onBack}>
        Back to Episode videos
      </button>
      <h2 className="flex items-center gap-2.5 text-lg font-semibold">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        Episode final video
      </h2>
      <p className="text-sm text-slate-400">Six approved Episode scenes will be combined into the final Reel.</p>
      {!result && (
        <div className="space-y-3">
          <button
            type="button"
            className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
            data-testid="episode-open-merge-confirm"
            disabled={confirmationOpen || pending}
            onClick={openConfirmation}
          >
            Create final Episode video
          </button>
          {confirmationOpen && (
            <div role="alertdialog" aria-label="Confirm Episode final video" data-testid="episode-merge-confirm-panel" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
              <p className="text-sm text-slate-300">Creating the final Episode video starts only after this confirmation.</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
                  disabled={pending}
                  onClick={() => setConfirmationOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
                  data-testid="episode-confirm-merge"
                  disabled={pending}
                  onClick={() => void confirm()}
                >
                  {pending ? "Creating final video…" : "Confirm final Episode video"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" data-testid="episode-merge-error" data-error-code={error.code} className="text-sm text-rose-400">
          {error.message}
        </p>
      )}
      {result && (
        <div data-testid="episode-merge-success" className="space-y-3 rounded-2xl border border-emerald-400/30 bg-slate-900/70 p-5">
          <p className="text-sm font-semibold text-emerald-400">Episode final video is ready.</p>
          <p className="text-sm text-slate-300" data-testid="episode-final-video-path">Final video: {result.finalVideoPath}</p>
          {onOpenContinuity && (
            <button
              type="button"
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
              data-testid="open-episode-continuity"
              onClick={() => onOpenContinuity(projectId, episodeNumber)}
            >
              Review continuity memory
            </button>
          )}
        </div>
      )}
    </section>
  );
}
