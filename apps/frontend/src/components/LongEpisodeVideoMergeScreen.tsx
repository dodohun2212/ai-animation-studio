import { useEffect, useRef, useState } from "react";
import type { AudioLibraryTrack, MergeLongEpisodeVideosResponse, UsedAudio } from "@ai-animation-studio/shared";

import { getLongEpisode, getLongEpisodeCurrentVideoJob, getLongEpisodeVideoReview, getLongProjectSettings, longEpisodeFinalVideoContentUrl, mergeLongEpisodeVideos, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { getAudioLibrary } from "../api/audioLibraryApi.js";
import type { AudioMode } from "./mergeAudio.js";
import { AttributionNotice, AUDIO_MODE_LABELS, MergeAudioFieldset, needsTrack, toAudioSettings } from "./mergeAudio.js";

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
  /**
   * How many of this Episode's scene videos are actually 확정됨.
   *
   * The notice used to print the *scene* count behind the word "승인된", so an Episode with one confirmed scene
   * out of six still read "승인된 에피소드 장면 영상 6개를 이어 붙입니다" — a sentence that was never true and that
   * sent people into a merge the server then refused. Null when there is no video job or the review cannot be
   * read: the copy then omits the number instead of printing a guessed one, and the button is left alone
   * (the server is still the real gate).
   */
  const [approvedCount, setApprovedCount] = useState<number | null>(null);
  /**
   * True once this Episode has a merged final video — including one merged in an earlier page load.
   *
   * Merging used to leave a file path printed as text, and that line lived in React state, so a reload erased
   * the only trace that the Episode was finished at all. The Episode's own status is what survives a refresh.
   */
  const [alreadyMerged, setAlreadyMerged] = useState(false);
  /** Bumped after a merge so the browser fetches the new file instead of replaying a cached older one. */
  const [videoVersion, setVideoVersion] = useState(0);
  /* The content route refuses a file at or below placeholder size, so a merge of stubs fails to load rather
     than showing a black box that claims to be the finished Episode. */
  const [unplayable, setUnplayable] = useState(false);
  /**
   * null until the Episode loads, and stays null when it cannot be determined.
   *
   * The Episode's own GET is the only response that goes to disk for this; the field is absent elsewhere, and
   * absent means "not determined here", never "no narration". Null therefore leaves the narration option
   * alone rather than locking it on something nobody checked.
   */
  const [narrationAvailable, setNarrationAvailable] = useState<boolean | null>(null);
  const [audioMode, setAudioMode] = useState<AudioMode | null>(null);
  const [tracks, setTracks] = useState<AudioLibraryTrack[]>([]);
  const [trackId, setTrackId] = useState("");
  /** Where in the chosen track the music starts. 0 is the beginning, which is also what the server does with no value. */
  const [audioStartSeconds, setAudioStartSeconds] = useState(0);
  /**
   * What the last merge used — read from the Episode on load, not only from this session's merge response.
   *
   * An Episode merged in an earlier page load still owes its credit line, and that is exactly the reader who
   * is about to write a caption. Reading it only from `result` would show the attribution to the person who
   * just merged and hide it from the person who came back to publish (D-003).
   */
  const [usedAudio, setUsedAudio] = useState<UsedAudio | undefined>(undefined);
  const busy = useRef(false);

  // Only ever changes this screen's wording, so a failure here is not fatal and is deliberately swallowed.
  useEffect(() => {
    let cancelled = false;
    getLongEpisode(projectId, episodeNumber)
      .then((response) => {
        if (cancelled) return;
        setSceneCount(response.episode.script?.scenes.length ?? null);
        setAlreadyMerged(response.episode.status === "completed");
        setUsedAudio(response.episode.usedAudio);
        // Derived, not assumed: an Episode with no narration audio cannot merge "나레이션만", and defaulting to
        // it would label a silent video as a narrated one (docs/06_DECISIONS.md D-011). Absent stays null.
        const available = response.episode.narrationAvailable ?? null;
        setNarrationAvailable(available);
        setAudioMode(available === true ? "narration" : "silent");
      })
      .catch(() => {});
    // An empty library simply means the two music options stay unavailable — never a reason to block merging.
    getAudioLibrary()
      .then((library) => {
        if (!cancelled) setTracks(library.tracks);
      })
      .catch(() => {});
    // Same treatment for the two media settings: wording only, so a failure drops the sentence rather than
    // guessing at what will be laid over the clips.
    getLongProjectSettings(projectId)
      .then(({ settings }) => {
        if (!cancelled) setMediaMode({ narrationEnabled: settings.narrationEnabled, subtitlesEnabled: settings.subtitlesEnabled });
      })
      .catch(() => {});
    // The confirmed count comes from the video review, which is addressed by job id — hence the lookup first.
    getLongEpisodeCurrentVideoJob(projectId, episodeNumber)
      .then(({ jobId }) => (jobId === null ? null : getLongEpisodeVideoReview(projectId, episodeNumber, jobId)))
      .then((review) => {
        if (!cancelled && review) setApprovedCount(review.reviews.filter((one) => one.status === "approved").length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, episodeNumber]);

  const contentSentence = mergeContentSentence(mediaMode);
  /* Only blocks on a count we actually read. Unknown stays unblocked — the server refuses either way, and a
     button disabled on a guess is worse than one that fails honestly. */
  const blocked = approvedCount !== null && sceneCount !== null && approvedCount < sceneCount;
  /** Null until the Episode has loaded — merging before then would send a mode derived from nothing. */
  const audioSettings = toAudioSettings(audioMode, trackId, audioStartSeconds);
  const modeUnready = audioMode !== null && needsTrack(audioMode) && !trackId;

  function openConfirmation(): void {
    if (busy.current || result || blocked) return;
    setError(null);
    setConfirmationOpen(true);
  }

  async function confirm(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const merged = await mergeLongEpisodeVideos(projectId, episodeNumber, audioSettings ?? undefined);
      setResult(merged);
      setUsedAudio(merged.episode.usedAudio);
      setConfirmationOpen(false);
      setUnplayable(false);
      setVideoVersion((current) => current + 1);
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
        {" 확정한 장면 영상을 순서대로 이어 붙여 최종 영상을 만듭니다."}
        {contentSentence ? ` ${contentSentence}` : ""}
      </p>
      {approvedCount !== null && sceneCount !== null && (
        <p className="text-sm text-slate-300 tabular-nums" data-testid="episode-merge-approved-count">
          장면 {sceneCount}개 중 <strong className="text-slate-100">{approvedCount}개 확정됨</strong>
        </p>
      )}
      {blocked && approvedCount !== null && sceneCount !== null && (
        /* Named before the button is reached, not after the server refuses — the person can go back and
           confirm the rest instead of reading an error they did not cause. */
        <p role="status" data-testid="episode-merge-blocked" className="rounded-xl border border-amber-400/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
          아직 확정하지 않은 장면이 {sceneCount - approvedCount}개 있습니다. 장면 영상 화면에서 모두 확정한 뒤에 최종 영상을 만들 수 있습니다.
        </p>
      )}
      {!result && !alreadyMerged && audioMode !== null && (
        <MergeAudioFieldset
          idPrefix="episode-merge-audio"
          tracks={tracks}
          narrationAvailable={narrationAvailable}
          mode={audioMode}
          onModeChange={setAudioMode}
          trackId={trackId}
          onTrackChange={setTrackId}
          startSeconds={audioStartSeconds}
          onStartSecondsChange={setAudioStartSeconds}
          disabled={pending || confirmationOpen}
        />
      )}
      {!result && alreadyMerged && (
        /* Restored after Cowork Round 458 dropped it: the Episode's merge is one-way (the server answers
           LONG_EPISODE_MERGE_ALREADY_COMPLETED), so offering the button again is an offer that cannot be taken.
           Card re-merging opened cards only, deliberately — an Episode's final cut sits on paid clips. */
        <p data-testid="episode-merge-already-completed" className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-300">
          이 회차는 이미 최종 영상이 만들어졌습니다.
        </p>
      )}
      {!result && !alreadyMerged && (
        <div className="space-y-3">
          <button
            type="button"
            className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
            data-testid="episode-open-merge-confirm"
            disabled={confirmationOpen || pending || blocked || modeUnready}
            onClick={openConfirmation}
          >
            {audioMode ? `${AUDIO_MODE_LABELS[audioMode]}으로 최종 영상 만들기` : "최종 영상 만들기"}
          </button>
          {modeUnready && (
            <p data-testid="episode-merge-audio-track-required" className="text-xs text-amber-300">
              배경음악을 고르면 최종 영상을 만들 수 있습니다.
            </p>
          )}
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
      {(result || alreadyMerged) && (
        <div data-testid="episode-merge-success" className="space-y-3 rounded-2xl border border-emerald-400/30 bg-slate-900/70 p-5">
          <p className="text-sm font-semibold text-emerald-400">에피소드 최종 영상이 완성되었습니다.</p>
          {unplayable ? (
            <p data-testid="episode-final-video-missing" className="rounded-lg border border-amber-400/30 bg-amber-500/[0.06] px-3 py-2 text-sm text-amber-200">
              최종 영상 파일을 재생할 수 없습니다. 장면 영상 중에 내용이 비어 있는 것이 섞여 있을 수 있습니다 — 장면 영상 화면에서 하나씩 재생해 확인해 주세요.
            </p>
          ) : (
            /* Watching it is the point. Six empty clips passed 확정 because nobody could see them, and a merge
               nobody can play is that same blindness one layer up. */
            <video
              data-testid="episode-final-video"
              className="w-full rounded-lg border border-white/10 bg-black"
              controls
              preload="metadata"
              src={longEpisodeFinalVideoContentUrl(projectId, episodeNumber, String(videoVersion))}
              onError={() => setUnplayable(true)}
            />
          )}
          {result && <p className="text-xs text-slate-500" data-testid="episode-final-video-path">파일: {result.finalVideoPath}</p>}
          {/* The Episode publishes to the same Instagram under the same licence as a short project, and this is
              the screen the caption gets written from. Reading it from state that survives a reload is the
              point: the person who comes back to publish is the one who needs it (D-003). */}
          <AttributionNotice usedAudio={usedAudio} />
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
