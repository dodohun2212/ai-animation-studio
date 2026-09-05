import { useEffect, useRef, useState } from "react";
import type { AudioLibraryTrack, MergeAudioSettings, UsedAudio } from "@ai-animation-studio/shared";

import { audioTrackContentUrl } from "../api/audioLibraryApi.js";

/**
 * The audio half of a merge screen, in one place because there are two merge screens.
 *
 * A short project and a Long Project Episode publish to the same Instagram under the same licences, so "which
 * modes are offered, when each is locked, and what credit the result owes" has one correct answer. Two copies
 * of that answer is two places for it to drift, and the way it drifts that actually costs something is a video
 * going out without the attribution its licence requires (docs/06_DECISIONS.md D-003).
 */
export type AudioMode = MergeAudioSettings["mode"];

/** Fixed labels, so a merge button can say exactly what it is about to produce. */
export const AUDIO_MODE_LABELS: Record<AudioMode, string> = {
  narration: "나레이션만",
  "narration+bgm": "나레이션 + 배경음악",
  bgm: "배경음악만",
  silent: "무음",
};

/** The two modes that mix in an uploaded track, and so require one to be chosen. */
export function needsTrack(mode: AudioMode): boolean {
  return mode === "narration+bgm" || mode === "bgm";
}

/**
 * What to send, or null when the choice is not yet complete.
 *
 * Null is not "no audio" — it is "do not merge yet". A mode that needs a track and has none must never fall
 * back to sending something else, because the something else would render and look finished.
 */
export function toAudioSettings(
  mode: AudioMode | null,
  trackId: string,
  startSeconds = 0,
  volumePercent: number | null = null,
  fadeSeconds: number | null = null,
): MergeAudioSettings | null {
  if (mode === null) return null;
  // A start point without a track is meaningless, and 0 is what the server does anyway — sending it would put a
  // number in the request that says nothing, and later read as a choice someone made.
  if (!needsTrack(mode)) return { mode };
  if (!trackId) return null;
  /*
   * Untouched is null, and null is not sent.
   *
   * The server picks both defaults, and `volume`'s depends on the mode (0.25 under narration+bgm so a voice
   * stays on top, 1 under bgm where there is no voice to sit beneath). Writing those numbers here to prefill a
   * box would be a second copy of a rule the backend owns — the exact shape CLI caught in the status order —
   * and it would go stale the day the rule changes. So the fields start empty, say so, and only a number a
   * person actually typed is sent.
   */
  return {
    mode,
    trackId,
    ...(startSeconds > 0 ? { startSeconds } : {}),
    ...(volumePercent !== null ? { volume: volumePercent / 100 } : {}),
    ...(fadeSeconds !== null ? { fadeSeconds } : {}),
  };
}

/** m:ss, so a position can be compared against the track length a person sees on the player. */
export function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

interface FieldsetProps {
  /** Prefix for element ids and test ids, so two merge screens never collide. */
  idPrefix: string;
  tracks: AudioLibraryTrack[];
  /** null means "not determined" — the narration option is then left alone rather than locked on a guess. */
  narrationAvailable: boolean | null;
  mode: AudioMode;
  onModeChange: (mode: AudioMode) => void;
  trackId: string;
  onTrackChange: (trackId: string) => void;
  /** Where in the track the music should start, in seconds. 0 is the beginning, which is what the server does by default. */
  startSeconds: number;
  onStartSecondsChange: (startSeconds: number) => void;
  /** The bgm's own level as a percent, or null for "leave the server's default alone". Never a number nobody typed. */
  volumePercent: number | null;
  onVolumePercentChange: (volumePercent: number | null) => void;
  /** Fade in/out of the finished video in seconds, or null for the server's default. */
  fadeSeconds: number | null;
  onFadeSecondsChange: (fadeSeconds: number | null) => void;
  disabled: boolean;
}

/**
 * An open setting, not a question: merging is free and takes seconds, so a confirmation dialog asking about
 * audio would train people to click through confirmations — the habit that costs money on the paid steps.
 * The merge button says what the current choice will produce instead.
 */
/** The two modes that mix a voice — the same pair the server requires narration audio for. */
export const needsNarration = (mode: AudioMode): boolean => mode === "narration" || mode === "narration+bgm";

export function MergeAudioFieldset({ idPrefix, tracks, narrationAvailable, mode, onModeChange, trackId, onTrackChange, startSeconds, onStartSecondsChange, volumePercent, onVolumePercentChange, fadeSeconds, onFadeSecondsChange, disabled }: FieldsetProps) {
  const bgmSelectable = tracks.length > 0;
  const selectedTrack = tracks.find((track) => track.trackId === trackId);
  const player = useRef<HTMLAudioElement | null>(null);

  // A start point belongs to the track it was heard in. Keeping it across a change would silently apply "1분 20초"
  // to a song that may be a minute long — and the server would refuse a merge nobody meant to ask for.
  useEffect(() => { onStartSecondsChange(0); onVolumePercentChange(null); }, [trackId]);

  return (
    <fieldset data-testid={`${idPrefix}-settings`} className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
      <legend className="px-1 text-sm font-semibold text-slate-200">오디오</legend>
      {(["narration", "narration+bgm", "bgm", "silent"] as AudioMode[]).map((option) => {
        // Only offered when it can actually be produced. Both narration modes need generated narration audio —
        // "narration+bgm" mixes a voice too, and the server refuses it without one, so offering it here would
        // put a choice on screen that comes back as an error. Either music mode needs an uploaded track. An
        // option that would fail is not an option.
        const unavailable = (needsNarration(option) && narrationAvailable === false)
          || (needsTrack(option) && !bgmSelectable);
        return (
          <label key={option} className="flex items-start gap-2 text-sm text-slate-300" htmlFor={`${idPrefix}-${option}`}>
            <input
              id={`${idPrefix}-${option}`}
              data-testid={`${idPrefix}-${option}`}
              type="radio"
              name={`${idPrefix}-mode`}
              className="mt-1"
              checked={mode === option}
              disabled={unavailable || disabled}
              onChange={() => onModeChange(option)}
            />
            <span>
              {AUDIO_MODE_LABELS[option]}
              {option === "silent" && <span className="text-slate-500"> — 소리 없이 내보냅니다. 인스타그램 앱에서 음원을 붙일 때</span>}
              {option === "narration" && narrationAvailable === false && (
                <span data-testid={`${idPrefix}-narration-unavailable`} className="text-slate-500"> — 나레이션이 아직 없습니다</span>
              )}
              {option === "narration+bgm" && !bgmSelectable && (
                <span data-testid={`${idPrefix}-bgm-unavailable`} className="text-slate-500"> — 음원 보관함에 올린 음악이 없습니다</span>
              )}
              {option === "bgm" && (bgmSelectable
                ? <span className="text-slate-500"> — 목소리 없이 음악만 깝니다</span>
                : <span data-testid={`${idPrefix}-bgm-only-unavailable`} className="text-slate-500"> — 음원 보관함에 올린 음악이 없습니다</span>
              )}
            </span>
          </label>
        );
      })}
      {needsTrack(mode) && bgmSelectable && (
        <label className="block text-sm text-slate-300" htmlFor={`${idPrefix}-track`}>
          배경음악
          <select
            id={`${idPrefix}-track`}
            data-testid={`${idPrefix}-track`}
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            value={trackId}
            disabled={disabled}
            onChange={(event) => onTrackChange(event.target.value)}
          >
            <option value="">고르지 않음</option>
            {tracks.map((track) => (
              <option key={track.trackId} value={track.trackId}>{track.title}</option>
            ))}
          </select>
        </label>
      )}
      {needsTrack(mode) && selectedTrack && (
        /*
         * Heard, then chosen — the same move as the publish screen's cover frame.
         *
         * A song is longer than a Reel, so the part someone wants is rarely the first thirty seconds. Asking for
         * a number instead would be asking which second of a two-minute track is the good one, which nobody can
         * answer without listening. This is only possible at all because the audio route now answers `Range`
         * requests (CLI Round 437); before that the player could start a track and never move inside it.
         */
        <div className="space-y-2 rounded-xl border border-white/10 bg-slate-950/40 p-3" data-testid={`${idPrefix}-start`}>
          <p className="text-sm text-slate-300">
            음악 시작 지점 <span className="text-slate-500">— 들어보고 원하는 자리에서 눌러 주세요.</span>
          </p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- an uploaded music track carries no caption track */}
          <audio
            ref={player}
            data-testid={`${idPrefix}-start-player`}
            className="w-full"
            controls
            preload="metadata"
            src={audioTrackContentUrl(selectedTrack.trackId)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid={`${idPrefix}-start-set`}
              className="rounded-full border border-white/10 px-3.5 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
              disabled={disabled}
              onClick={() => {
                const element = player.current;
                if (!element) return;
                // Not measured is not zero: a position the browser cannot state must not be recorded as "the
                // beginning", which is a choice nobody made. Same rule as the cover frame.
                if (!Number.isFinite(element.currentTime) || element.currentTime < 0) return;
                // Refused by the server at or past the end, so it is refused here first — with the reason on
                // screen rather than after a merge attempt.
                if (element.currentTime >= selectedTrack.durationSeconds) return;
                onStartSecondsChange(element.currentTime);
              }}
            >
              여기부터
            </button>
            {startSeconds > 0 ? (
              <>
                <span data-testid={`${idPrefix}-start-at`} className="text-xs tabular-nums text-emerald-400">
                  {formatSeconds(startSeconds)}부터 (곡 길이 {formatSeconds(selectedTrack.durationSeconds)})
                </span>
                <button
                  type="button"
                  data-testid={`${idPrefix}-start-clear`}
                  className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-200 disabled:opacity-50"
                  disabled={disabled}
                  onClick={() => onStartSecondsChange(0)}
                >
                  처음부터
                </button>
              </>
            ) : (
              <span data-testid={`${idPrefix}-start-unset`} className="text-xs text-slate-400">
                곡의 처음부터 깔립니다. (곡 길이 {formatSeconds(selectedTrack.durationSeconds)})
              </span>
            )}
          </div>
        </div>
      )}
      {/*
       * Two settings the server has always accepted, validated and applied — and no screen ever sent.
       *
       * `volume` and `fadeSeconds` reach ffmpeg through `mixBackgroundMusic`; the request shape has carried them
       * the whole time. Every video anyone here has made took whatever the server defaults to, because there was
       * nowhere to say otherwise. That is not a missing feature so much as a finished one nobody wired up.
       *
       * Folded away rather than laid out flat: the default is the right answer almost always, and the merge
       * screen's job is to get a video out. Empty means untouched, and untouched is not sent — the boxes carry
       * no prefilled number, because the number the server would pick is the server's rule to know, not this
       * file's to copy.
       */}
      {needsTrack(mode) && selectedTrack && (
        <details data-testid={`${idPrefix}-bgm-tuning`} className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
          <summary className="cursor-pointer text-sm text-slate-300">음악 세부 조정 <span className="text-slate-500">— 비워 두면 기본값</span></summary>
          <div className="mt-3 space-y-3">
            <label className="block text-sm text-slate-300" htmlFor={`${idPrefix}-volume`}>
              음악 크기 <span className="text-slate-500">(0~100%)</span>
              <input
                id={`${idPrefix}-volume`}
                data-testid={`${idPrefix}-volume`}
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                placeholder="기본값"
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50"
                value={volumePercent === null ? "" : String(volumePercent)}
                disabled={disabled}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  if (raw === "") { onVolumePercentChange(null); return; }
                  const parsed = Number(raw);
                  // An unreadable or out-of-range entry is not a number to send. Left as "untouched" rather than
                  // clamped, so the server's default stands instead of a value the person did not choose.
                  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) { onVolumePercentChange(null); return; }
                  onVolumePercentChange(parsed);
                }}
              />
              <span data-testid={`${idPrefix}-volume-note`} className="mt-1 block text-xs text-slate-500">
                {volumePercent === null
                  ? "비워 두면 서버가 정합니다 — 나레이션과 함께 깔 때는 목소리에 묻히지 않게 낮춰서, 음악만 깔 때는 올린 그대로."
                  : `배경음악을 ${volumePercent}% 크기로 깝니다. 나레이션에는 영향을 주지 않습니다.`}
              </span>
            </label>
            <label className="block text-sm text-slate-300" htmlFor={`${idPrefix}-fade`}>
              페이드 인·아웃 <span className="text-slate-500">(초)</span>
              <input
                id={`${idPrefix}-fade`}
                data-testid={`${idPrefix}-fade`}
                type="number"
                min={0}
                step={0.5}
                inputMode="decimal"
                placeholder="기본값"
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50"
                value={fadeSeconds === null ? "" : String(fadeSeconds)}
                disabled={disabled}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  if (raw === "") { onFadeSecondsChange(null); return; }
                  const parsed = Number(raw);
                  if (!Number.isFinite(parsed) || parsed < 0) { onFadeSecondsChange(null); return; }
                  onFadeSecondsChange(parsed);
                }}
              />
              <span data-testid={`${idPrefix}-fade-note`} className="mt-1 block text-xs text-slate-500">
                {fadeSeconds === null
                  ? "비워 두면 서버가 정합니다. 영상 처음과 끝에서 음악이 서서히 들어오고 나갑니다."
                  : `영상 처음과 끝에서 ${fadeSeconds}초에 걸쳐 음악이 드나듭니다.`}
              </span>
            </label>
          </div>
        </details>
      )}

      {/* Carried onto the merge screen so the reminder lands while the caption is still being written. */}
      {selectedTrack?.attributionRequired && (
        <p data-testid={`${idPrefix}-attribution`} className="text-xs text-amber-300">
          이 음원은 캡션에 출처를 적어야 합니다.
          {selectedTrack.attributionText?.trim()
            ? ` 병합이 끝나면 문구를 복사할 수 있습니다: ${selectedTrack.attributionText.trim()}`
            : " 적을 문구가 비어 있습니다 — 음원 보관함에서 먼저 채워 주세요."}
        </p>
      )}
    </fieldset>
  );
}

/**
 * The credit line a finished video owes, shown at the one moment it is actually usable.
 *
 * Attribution was collected at upload and shown in the library and again while choosing a track, but neither of
 * those is where it has to end up: a CC BY licence requires the credit to appear *where the work is published*,
 * and the next move after a merge screen is to paste a caption into Instagram. The sentence used to live two
 * screens behind them at that moment (D-003).
 *
 * Reads `usedAudio`, not the track, on purpose — the backend copies the sentence by value at merge time, so a
 * track deleted afterwards cannot silently erase what an already-published video still owes.
 */
export function AttributionNotice({ usedAudio }: { usedAudio: UsedAudio | undefined }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  if (!usedAudio?.attributionRequired) return null;
  const text = usedAudio.attributionText?.trim() ?? "";

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      // Clipboard access can be refused outright (no permission, insecure origin). The sentence is on screen
      // either way, so this degrades to "select it yourself" rather than to a dead end.
      setCopied("failed");
    }
  }

  return (
    <div data-testid="merge-attribution" className="space-y-2 rounded-xl border border-amber-400/30 bg-amber-500/5 p-4">
      <p className="text-sm font-semibold text-amber-300">이 영상은 캡션에 출처를 함께 적어야 합니다.</p>
      {text ? (
        <>
          <p data-testid="merge-attribution-text" className="select-all rounded-lg bg-slate-950/60 px-3 py-2 text-sm text-slate-200">
            {text}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              data-testid="merge-attribution-copy"
              className="rounded-full border border-amber-400/30 px-4 py-2 text-sm text-amber-200 hover:bg-amber-400/10"
              onClick={() => void copy()}
            >
              문구 복사
            </button>
            {copied === "done" && <span data-testid="merge-attribution-copied" className="text-xs text-emerald-400">복사했습니다.</span>}
            {copied === "failed" && (
              <span data-testid="merge-attribution-copy-failed" className="text-xs text-slate-400">
                복사하지 못했습니다. 위 문구를 직접 선택해 복사해 주세요.
              </span>
            )}
          </div>
        </>
      ) : (
        // Required but blank: saying "credit it" without saying what to write leaves the user to guess wording
        // the licence may be specific about, so this points back to the one place the wording can be fixed.
        <p data-testid="merge-attribution-missing" className="text-sm text-slate-300">
          적어야 할 문구가 비어 있습니다. 음원 보관함에서 이 음원의 출처 문구를 채운 뒤 캡션에 넣어 주세요.
        </p>
      )}
    </div>
  );
}
