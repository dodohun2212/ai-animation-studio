import { useState } from "react";
import type { AudioLibraryTrack, MergeAudioSettings, UsedAudio } from "@ai-animation-studio/shared";

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
export function toAudioSettings(mode: AudioMode | null, trackId: string): MergeAudioSettings | null {
  if (mode === null) return null;
  if (!needsTrack(mode)) return { mode };
  return trackId ? { mode, trackId } : null;
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
  disabled: boolean;
}

/**
 * An open setting, not a question: merging is free and takes seconds, so a confirmation dialog asking about
 * audio would train people to click through confirmations — the habit that costs money on the paid steps.
 * The merge button says what the current choice will produce instead.
 */
/** The two modes that mix a voice — the same pair the server requires narration audio for. */
export const needsNarration = (mode: AudioMode): boolean => mode === "narration" || mode === "narration+bgm";

export function MergeAudioFieldset({ idPrefix, tracks, narrationAvailable, mode, onModeChange, trackId, onTrackChange, disabled }: FieldsetProps) {
  const bgmSelectable = tracks.length > 0;
  const selectedTrack = tracks.find((track) => track.trackId === trackId);

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
