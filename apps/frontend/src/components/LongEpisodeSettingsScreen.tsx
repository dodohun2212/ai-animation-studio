import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  RUNWAY_CLIP_DURATIONS,
  type LongEpisodeSettings,
} from "@ai-animation-studio/shared";

import { getLongEpisodeSettings, toLongProjectDisplayError, updateLongEpisodeSettings } from "../api/longProjectsApi.js";
import { Spinner } from "./Spinner.js";

interface Props {
  projectId: string;
  episodeNumber: number;
  onBack: () => void;
}

type DisplayError = { code: string; message: string };
type Loaded = { settings: LongEpisodeSettings; projectDefaults: LongEpisodeSettings; changeable: boolean };
type State =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; loaded: Loaded };

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const primaryButton =
  "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const cardSection = "space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

/**
 * One Episode's own scene count and clip length.
 *
 * The project's settings are where a new Episode's values come from; this is where one Episode departs from
 * them. Both numbers were project-wide until now, which meant a longer or shorter Episode could not be asked
 * for at all — and the pipeline was already reading each Episode's own stored values, so the only thing missing
 * was a way to write them.
 *
 * Aspect ratio is deliberately absent, and the screen says so rather than leaving its absence to be noticed:
 * three screens once each guessed the ratio independently and all three guessed wrong, and a continuity
 * reference image crosses from one Episode into the next, so a per-Episode ratio would put those two in
 * disagreement with nothing able to reconcile them.
 */
export function LongEpisodeSettingsScreen({ projectId, episodeNumber, onBack }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [sceneCount, setSceneCount] = useState(0);
  const [clipDurationSeconds, setClipDurationSeconds] = useState(0);
  const [saveError, setSaveError] = useState<DisplayError | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveBusy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getLongEpisodeSettings(projectId, episodeNumber)
      .then((response) => {
        if (cancelled) return;
        setState({ status: "ready", loaded: response });
        setSceneCount(response.settings.sceneCount);
        setClipDurationSeconds(response.settings.clipDurationSeconds);
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", error: toLongProjectDisplayError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, episodeNumber]);

  const loaded = state.status === "ready" ? state.loaded : null;
  const changeable = loaded?.changeable ?? false;
  const defaults = loaded?.projectDefaults ?? null;
  // Derived here exactly as the server derives it, so the number on screen and the number that gets stored are
  // the same arithmetic rather than two copies that can drift.
  const totalSeconds = sceneCount * clipDurationSeconds;
  const changedFromDefault =
    defaults !== null && (sceneCount !== defaults.sceneCount || clipDurationSeconds !== defaults.clipDurationSeconds);
  const changedFromSaved =
    loaded !== null
    && (sceneCount !== loaded.settings.sceneCount || clipDurationSeconds !== loaded.settings.clipDurationSeconds);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saveBusy.current || !changeable || !changedFromSaved) return;
    saveBusy.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await updateLongEpisodeSettings(projectId, episodeNumber, { sceneCount, clipDurationSeconds });
      setState((current) =>
        current.status === "ready"
          ? { status: "ready", loaded: { ...current.loaded, settings: response.settings } }
          : current,
      );
      setSceneCount(response.settings.sceneCount);
      setClipDurationSeconds(response.settings.clipDurationSeconds);
      setSaved(true);
    } catch (error: unknown) {
      setSaveError(toLongProjectDisplayError(error));
    } finally {
      saveBusy.current = false;
      setSaving(false);
    }
  }

  function restoreDefaults(): void {
    if (!defaults) return;
    setSceneCount(defaults.sceneCount);
    setClipDurationSeconds(defaults.clipDurationSeconds);
    setSaved(false);
  }

  return (
    <section className="mt-8 max-w-2xl space-y-5">
      <button type="button" className="text-xs text-slate-400 hover:text-slate-300" onClick={onBack}>
        <span aria-hidden="true">←</span> 회차로 돌아가기
      </button>
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        {episodeNumber}회차 설정
      </h1>
      <p className="text-sm leading-relaxed text-slate-400">
        이 회차만의 장면 수와 클립 길이입니다. 작품 설정에서 정한 값으로 시작하고, 여기서 바꾼 것은 이 회차에만
        적용됩니다. <strong className="text-slate-300">화면 비율은 작품 전체에 하나</strong>라 여기에 없습니다 —
        회차마다 다르면 앞 회차에서 이어받는 참고 이미지와 모양이 어긋납니다.
      </p>

      {state.status === "loading" && <Spinner label="회차 설정을 불러오는 중..." />}
      {state.status === "error" && (
        <p role="alert" data-testid="episode-settings-load-error" data-error-code={state.error.code} className="text-sm text-rose-400">
          {state.error.message}
        </p>
      )}

      {state.status === "ready" && (
        <form className={cardSection} onSubmit={(event) => void submit(event)} aria-label="회차 설정">
          {/* Said before the fields, not after a rejected save: the refusal is knowable the moment the screen
              opens, and hearing it at the end is the worst moment for it. The fields are disabled as well as
              explained — a notice above a working form is just a form with a notice on it. */}
          {!changeable && (
            <p data-testid="episode-settings-locked" className="rounded-xl border border-amber-400/30 bg-amber-500/5 p-3 text-sm text-amber-200">
              이 회차의 대본이 이미 이 장면 수와 클립 길이로 쓰였습니다. 바꾸려면 대본을 다시 만들어야 합니다.
            </p>
          )}

          <label className="block text-sm text-slate-300" htmlFor="episode-scene-count">
            장면 수
            <input
              id="episode-scene-count"
              data-testid="episode-scene-count"
              type="number"
              className={fieldClassName}
              min={MIN_SCENE_COUNT}
              max={MAX_SCENE_COUNT}
              value={sceneCount}
              disabled={!changeable || saving}
              onChange={(event) => {
                // Clamped here rather than left to the server: the bounds are the same on both sides, and a
                // person who typed 20 should see it corrected while looking at the field, not after a round trip.
                const parsed = Number(event.target.value);
                const next = Number.isFinite(parsed) ? Math.min(MAX_SCENE_COUNT, Math.max(MIN_SCENE_COUNT, Math.round(parsed))) : MIN_SCENE_COUNT;
                setSceneCount(next);
                setSaved(false);
              }}
            />
            <span className="mt-1 block text-xs text-slate-500">{MIN_SCENE_COUNT}~{MAX_SCENE_COUNT}장면</span>
          </label>

          <label className="block text-sm text-slate-300" htmlFor="episode-clip-duration">
            장면당 클립 길이
            <select
              id="episode-clip-duration"
              data-testid="episode-clip-duration"
              className={fieldClassName}
              value={clipDurationSeconds}
              disabled={!changeable || saving}
              onChange={(event) => {
                setClipDurationSeconds(Number(event.target.value));
                setSaved(false);
              }}
            >
              {RUNWAY_CLIP_DURATIONS.map((duration) => (
                <option key={duration} value={duration}>{duration}초</option>
              ))}
            </select>
            {/* Not a house rule, and worth saying so — otherwise the two options read as an arbitrary limit. */}
            <span className="mt-1 block text-xs text-slate-500">지금 연결된 영상 AI(Runway)가 받는 길이가 이 둘뿐입니다.</span>
          </label>

          <p className="text-sm text-slate-300" data-testid="episode-settings-total">
            이 회차 영상 길이: {totalSeconds}초 ({sceneCount}장면 × {clipDurationSeconds}초)
          </p>

          {defaults && (
            <p className="text-xs text-slate-500" data-testid="episode-settings-default">
              작품 기본값: {defaults.sceneCount}장면 × {defaults.clipDurationSeconds}초
              {changedFromDefault && <span className="ml-1 text-violet-300">— 이 회차는 기본값과 다릅니다.</span>}
            </p>
          )}

          {saveError && (
            <p role="alert" data-testid="episode-settings-save-error" data-error-code={saveError.code} className="text-sm text-rose-400">
              {saveError.message}
            </p>
          )}
          {saved && !changedFromSaved && (
            <p data-testid="episode-settings-saved" className="text-sm text-emerald-400">저장했습니다.</p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" data-testid="episode-settings-save" className={primaryButton} disabled={!changeable || saving || !changedFromSaved}>
              {saving ? "저장하는 중..." : "저장"}
            </button>
            <button
              type="button"
              data-testid="episode-settings-restore"
              className={outlineButton}
              onClick={restoreDefaults}
              disabled={!changeable || saving || !changedFromDefault}
            >
              작품 기본값으로 되돌리기
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
