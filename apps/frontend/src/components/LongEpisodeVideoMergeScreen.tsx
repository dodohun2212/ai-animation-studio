import { useEffect, useRef, useState } from "react";
import type { MergeLongEpisodeVideosResponse } from "@ai-animation-studio/shared";

import { getLongEpisode, getLongProjectSettings, mergeLongEpisodeVideos, toLongProjectDisplayError } from "../api/longProjectsApi.js";

interface Props {
  projectId: string;
  episodeNumber: number;
  onBack: () => void;
  onOpenContinuity?: (projectId: string, episodeNumber: number) => void;
}

type DisplayError = { code: string; message: string };

/** What the merge lays over the Episode's clips, as the two settings that decide it. */
interface MediaMode {
  narrationEnabled: boolean;
  subtitlesEnabled: boolean;
}

/**
 * One sentence describing what this merge lays over the clips.
 *
 * Mirrors episode-video-merge.service.ts, where both halves are gated the same way as the short project's
 * merge — "off" means "not used", not "not made again": audio goes on only when narrationEnabled is on AND
 * that scene's file exists, and a subtitle goes on only when subtitlesEnabled is on AND that scene has
 * narration text. The two are otherwise independent, so subtitles-only (no TTS spend) is a real mode and the
 * copy must never tie a subtitle to the presence of audio.
 *
 * Returns null when the settings could not be read: saying nothing beats promising something unconfirmed.
 */
function mergeContentSentence(mode: MediaMode | null): string | null {
  if (!mode) return null;
  if (mode.narrationEnabled && mode.subtitlesEnabled) {
    return "음성을 만들어 둔 장면에는 그 음성이 입혀지고, 읽어줄 문장이 있는 장면에는 자막이 들어갑니다 — 음성이 아직 없는 장면에도 자막은 들어갑니다.";
  }
  if (mode.subtitlesEnabled) {
    return "음성은 꺼져 있어 넣지 않습니다. 읽어줄 문장이 있는 장면에 자막만 입힙니다.";
  }
  if (mode.narrationEnabled) {
    return "음성을 만들어 둔 장면에는 그 음성이 입혀지고, 자막은 넣지 않습니다.";
  }
  return "음성도 자막도 꺼져 있어 장면 영상만 이어 붙입니다.";
}

/** The explicit, final client gate for one Episode's already-approved videos. */
export function LongEpisodeVideoMergeScreen({ projectId, episodeNumber, onBack, onOpenContinuity }: Props) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MergeLongEpisodeVideosResponse | null>(null);
  const [error, setError] = useState<DisplayError | null>(null);
  /**
   * How many scenes this Episode actually has. Was a local `const EPISODE_SCENE_COUNT = 6` with a comment
   * arguing that six was a backend invariant — true when written, false since Episodes became 2-12 scenes.
   * Read from the Episode itself for that reason. Stays null when the Episode or its script cannot be read,
   * and the copy then omits the number rather than printing a guessed one.
   */
  const [sceneCount, setSceneCount] = useState<number | null>(null);
  /** null until the project settings load, and stays null if they fail — the copy then claims nothing. */
  const [mediaMode, setMediaMode] = useState<MediaMode | null>(null);
  const busy = useRef(false);

  // Only ever changes this screen's wording, so a failure here is not fatal and is deliberately swallowed.
  useEffect(() => {
    let cancelled = false;
    getLongEpisode(projectId, episodeNumber)
      .then((response) => {
        if (!cancelled) setSceneCount(response.episode.script?.scenes.length ?? null);
      })
      .catch(() => {});
    // Same treatment for the two media settings: wording only, so a failure drops the sentence rather than
    // guessing at what will be laid over the clips.
    getLongProjectSettings(projectId)
      .then(({ settings }) => {
        if (!cancelled) setMediaMode({ narrationEnabled: settings.narrationEnabled, subtitlesEnabled: settings.subtitlesEnabled });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, episodeNumber]);

  const contentSentence = mergeContentSentence(mediaMode);

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
        에피소드 영상으로 돌아가기
      </button>
      <h2 className="flex items-center gap-2.5 text-lg font-semibold">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        에피소드 최종 영상
      </h2>
      <p className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300" data-testid="episode-merge-scope-notice">
        이 단계는 비용이 들지 않습니다 — 유료 요청 없이, 이 컴퓨터에 설치된 영상 병합 프로그램만 실행합니다.
        {sceneCount !== null ? ` 승인된 에피소드 장면 영상 ${sceneCount}개를` : " 승인된 에피소드 장면 영상을"} 순서대로 이어 붙여 최종 영상을 만듭니다.
        {contentSentence ? ` ${contentSentence}` : ""}
      </p>
      {!result && (
        <div className="space-y-3">
          <button
            type="button"
            className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
            data-testid="episode-open-merge-confirm"
            disabled={confirmationOpen || pending}
            onClick={openConfirmation}
          >
            최종 영상 만들기
          </button>
          {confirmationOpen && (
            <div role="alertdialog" aria-label="에피소드 최종 영상 확인" data-testid="episode-merge-confirm-panel" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
              <p className="text-sm text-slate-300">
                아직 시작되지 않았습니다. 확인을 눌러야 최종 영상 만들기가 시작됩니다.
                {contentSentence ? ` ${contentSentence}` : ""} 유료 요청은 전송되지 않습니다.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
                  disabled={pending}
                  onClick={() => setConfirmationOpen(false)}
                >
                  돌아가기
                </button>
                <button
                  type="button"
                  className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
                  data-testid="episode-confirm-merge"
                  disabled={pending}
                  onClick={() => void confirm()}
                >
                  {pending ? "만드는 중..." : "네, 최종 영상을 만듭니다"}
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
          <p className="text-sm font-semibold text-emerald-400">에피소드 최종 영상이 완성되었습니다.</p>
          <p className="text-sm text-slate-300" data-testid="episode-final-video-path">최종 영상: {result.finalVideoPath}</p>
          {onOpenContinuity && (
            <button
              type="button"
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
              data-testid="open-episode-continuity"
              onClick={() => onOpenContinuity(projectId, episodeNumber)}
            >
              연결 기억 검토하기
            </button>
          )}
        </div>
      )}
    </section>
  );
}
