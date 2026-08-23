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

  return <section className="mt-8 space-y-4" data-testid="episode-video-merge-screen">
    <button type="button" onClick={onBack}>Back to Episode videos</button>
    <h2>Episode final video</h2>
    <p>Six approved Episode scenes will be combined into the final Reel.</p>
    {!result && <div className="space-y-3">
      <button type="button" data-testid="episode-open-merge-confirm" disabled={confirmationOpen || pending} onClick={openConfirmation}>Create final Episode video</button>
      {confirmationOpen && <div role="alertdialog" aria-label="Confirm Episode final video" data-testid="episode-merge-confirm-panel" className="space-y-3">
        <p>Creating the final Episode video starts only after this confirmation.</p>
        <button type="button" disabled={pending} onClick={() => setConfirmationOpen(false)}>Cancel</button>
        <button type="button" data-testid="episode-confirm-merge" disabled={pending} onClick={() => void confirm()}>{pending ? "Creating final video…" : "Confirm final Episode video"}</button>
      </div>}
    </div>}
    {error && <p role="alert" data-testid="episode-merge-error" data-error-code={error.code}>{error.message}</p>}
    {result && <div data-testid="episode-merge-success">
    <p>Episode final video is ready.</p>
    <p data-testid="episode-final-video-path">Final video: {result.finalVideoPath}</p>
    {onOpenContinuity && <button type="button" data-testid="open-episode-continuity" onClick={() => onOpenContinuity(projectId, episodeNumber)}>Review continuity memory</button>}
    </div>}
  </section>;
}
