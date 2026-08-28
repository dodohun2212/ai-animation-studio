import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_SCENE_COUNT, MIN_SCENE_COUNT, RUNWAY_CLIP_DURATIONS, type LongProjectSettings } from "@ai-animation-studio/shared";

import { getLongProjectSettings, toLongProjectDisplayError, updateLongProjectSettings } from "../api/longProjectsApi.js";
import { GlobalStyleAssetCard } from "./GlobalStyleAssetCard.js";
import { ProtagonistAssetCard } from "./ProtagonistAssetCard.js";
import { Spinner } from "./Spinner.js";

interface Props {
  projectId: string;
  onBack: () => void;
}

type State = { settings: LongProjectSettings | null; loading: boolean; error: { code: string; message: string } | null };

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30";

function Field({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return (
    <label className="block text-sm text-slate-300">
      {label}
      {multiline ? (
        <textarea className={fieldClassName} value={value} onChange={(event) => onChange(event.target.value)} rows={3} />
      ) : (
        <input className={fieldClassName} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

export function LongProjectSettingsScreen({ projectId, onBack }: Props) {
  const [state, setState] = useState<State>({ settings: null, loading: true, error: null });
  const [justSaved, setJustSaved] = useState(false);
  const saving = useRef(false);
  const justSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (justSavedTimer.current) clearTimeout(justSavedTimer.current); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getLongProjectSettings(projectId)
      .then(({ settings }) => {
        if (!cancelled) setState({ settings, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ settings: null, loading: false, error: toLongProjectDisplayError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function setField<Key extends keyof LongProjectSettings>(key: Key, value: LongProjectSettings[Key]): void {
    setState((old) => (old.settings ? { ...old, settings: { ...old.settings, [key]: value }, error: null } : old));
    setJustSaved(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!state.settings || saving.current) return;
    const settings = { ...state.settings, title: state.settings.title.trim(), logline: state.settings.logline.trim() };
    if (!settings.title || !settings.logline) {
      setState((old) => ({ ...old, error: { code: "INVALID_REQUEST", message: "제목과 한 줄 줄거리는 필수입니다." } }));
      return;
    }
    if (!Number.isInteger(settings.episodeCount) || settings.episodeCount < 1) {
      setState((old) => ({ ...old, error: { code: "INVALID_REQUEST", message: "에피소드 수를 올바르게 입력하세요." } }));
      return;
    }
    // sceneCount has no equivalent check here: its input's onChange already clamps to
    // [MIN_SCENE_COUNT, MAX_SCENE_COUNT] on every keystroke (see below), so an out-of-range value can never reach
    // this point — same reasoning as ShortProjectSettingsScreen's identical sceneCount field.
    saving.current = true;
    setState((old) => ({ ...old, loading: true, error: null }));
    try {
      // episodeDurationSeconds is derived server-side (sceneCount * clipDurationSeconds) and is rejected as an
      // unsupported field if included — same as ShortProjectSettingsInput's equivalent.
      const { episodeDurationSeconds: _episodeDurationSeconds, ...settingsInput } = settings;
      const response = await updateLongProjectSettings(projectId, { settings: settingsInput });
      setState({ settings: response.project.settings, loading: false, error: null });
      setJustSaved(true);
      if (justSavedTimer.current) clearTimeout(justSavedTimer.current);
      justSavedTimer.current = setTimeout(() => setJustSaved(false), 4000);
    } catch (error) {
      setState((old) => ({ ...old, loading: false, error: toLongProjectDisplayError(error) }));
    } finally {
      saving.current = false;
    }
  }

  if (state.loading && !state.settings) return <Spinner label="불러오는 중…" className="mt-8" />;
  return (
    <section className="mt-8 max-w-3xl space-y-4">
      <button
        type="button"
        className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
        onClick={onBack}
      >
        돌아가기
      </button>
      <h2 className="flex items-center gap-2.5 text-lg font-semibold">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        장기 프로젝트 설정
      </h2>
      {state.error && !state.settings && (
        <p className="text-sm text-rose-400" role="alert" data-error-code={state.error.code}>
          {state.error.message}
        </p>
      )}
      {state.settings && (
        <form className="grid gap-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6 md:grid-cols-2" onSubmit={submit} noValidate>
          <Field label="제목" value={state.settings.title} onChange={(value) => setField("title", value)} />
          <Field label="한 줄 줄거리" value={state.settings.logline} onChange={(value) => setField("logline", value)} />
          <Field label="개요" value={state.settings.overview} onChange={(value) => setField("overview", value)} multiline />
          <Field label="장르" value={state.settings.genre} onChange={(value) => setField("genre", value)} />
          <Field label="톤" value={state.settings.tone} onChange={(value) => setField("tone", value)} />
          <Field label="테마" value={state.settings.theme} onChange={(value) => setField("theme", value)} />
          <label className="block text-sm text-slate-300">
            에피소드 수
            <input
              type="number"
              className={fieldClassName}
              value={state.settings.episodeCount}
              onChange={(event) => setField("episodeCount", Number(event.target.value))}
            />
          </label>
          <label className="block text-sm text-slate-300">
            장면 수
            <input
              type="number"
              min={MIN_SCENE_COUNT}
              max={MAX_SCENE_COUNT}
              className={fieldClassName}
              value={state.settings.sceneCount}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (!Number.isInteger(parsed)) return;
                const sceneCount = Math.min(MAX_SCENE_COUNT, Math.max(MIN_SCENE_COUNT, parsed));
                setField("sceneCount", sceneCount);
                setField("episodeDurationSeconds", sceneCount * state.settings!.clipDurationSeconds);
              }}
            />
          </label>
          <label className="block text-sm text-slate-300">
            클립 길이(초)
            <select
              className={fieldClassName}
              value={state.settings.clipDurationSeconds}
              onChange={(event) => {
                const clipDurationSeconds = Number(event.target.value);
                setField("clipDurationSeconds", clipDurationSeconds);
                setField("episodeDurationSeconds", state.settings!.sceneCount * clipDurationSeconds);
              }}
            >
              {RUNWAY_CLIP_DURATIONS.map((duration) => (
                <option key={duration} value={duration}>{duration}초</option>
              ))}
            </select>
          </label>
          <p className="text-sm text-slate-400">
            에피소드당 예상 영상 길이: {state.settings.sceneCount * state.settings.clipDurationSeconds}초 ({state.settings.sceneCount}장면 × {state.settings.clipDurationSeconds}초)
          </p>
          <label className="block text-sm text-slate-300">
            화면 비율
            <select
              className={fieldClassName}
              value={state.settings.aspectRatio}
              onChange={(event) => setField("aspectRatio", event.target.value as LongProjectSettings["aspectRatio"])}
            >
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
            </select>
          </label>
          <div className="md:col-span-2 space-y-3 rounded-xl border border-white/10 bg-slate-950/40 p-3.5">
            <p className="text-sm font-semibold text-slate-200">내레이션</p>
            <p className="text-xs leading-relaxed text-slate-400">
              켜면 에피소드 대본에 장면마다 읽어줄 문장이 함께 들어갑니다. 등장인물이 입을 움직여 말하는 방식이 아니라
              이야기를 읽어주는 방식이라, 입 모양이 어긋나 보이지 않습니다. 음성과 자막은 따로 켤 수 있고, 설정은
              이 프로젝트의 모든 에피소드에 적용됩니다.
            </p>
            <label className="flex items-start gap-2.5 text-sm text-slate-200">
              <input
                type="checkbox"
                data-testid="long-settings-narration-enabled"
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-violet-500"
                checked={state.settings.narrationEnabled}
                onChange={(event) => setField("narrationEnabled", event.target.checked)}
              />
              <span>
                음성 넣기
                <span className="mt-1 block text-xs leading-relaxed text-slate-400">
                  문장을 실제 목소리로 만들어 영상에 입힙니다. 에피소드마다, 장면마다 한 번씩 비용이 듭니다.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-sm text-slate-200">
              <input
                type="checkbox"
                data-testid="long-settings-subtitles-enabled"
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-violet-500"
                checked={state.settings.subtitlesEnabled}
                onChange={(event) => setField("subtitlesEnabled", event.target.checked)}
              />
              <span>
                자막 넣기
                <span className="mt-1 block text-xs leading-relaxed text-slate-400">
                  같은 문장을 영상에 글자로 얹습니다. <span className="text-slate-300">비용이 들지 않습니다.</span> 소리를 끄고
                  보는 사람이 많은 곳에 올릴 거라면 음성 없이 자막만 켜도 됩니다.
                </span>
              </span>
            </label>
          </div>
          <Field label="누가 볼 영상인가" value={state.settings.audience} onChange={(value) => setField("audience", value)} />
          <Field label="메모" value={state.settings.notes} onChange={(value) => setField("notes", value)} multiline />
          <Field label="시작 상태" value={state.settings.startingState} onChange={(value) => setField("startingState", value)} multiline />
          <Field label="중간 전개" value={state.settings.midpoint} onChange={(value) => setField("midpoint", value)} multiline />
          <Field label="결말 방향" value={state.settings.endingDirection} onChange={(value) => setField("endingDirection", value)} multiline />
          <Field
            label="스토리 흐름 요약"
            value={state.settings.storyFlowSummary}
            onChange={(value) => setField("storyFlowSummary", value)}
            multiline
          />
          {state.error && (
            <p className="text-sm text-rose-400 md:col-span-2" role="alert" data-error-code={state.error.code}>
              {state.error.message}
            </p>
          )}
          {justSaved && !state.error && (
            <p role="status" data-testid="long-settings-saved-notice"
               className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3.5 py-2 text-sm text-emerald-300 md:col-span-2">
              설정이 저장되었습니다.
            </p>
          )}
          <button
            type="submit"
            disabled={state.loading}
            className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50 md:col-span-2"
          >
            {state.loading ? "저장 중…" : "설정 저장"}
          </button>
        </form>
      )}
      {/* Moved here from the Story Bible screen: it is a project-wide choice like 화면 비율 above, not
          something about one character. Rendered outside the settings form because it saves through its own
          endpoint — one button per thing that is actually stored separately. */}
      {/* Protagonist before style: a person names their lead character before deciding how it is drawn, and
          this is the one that also reaches the script. Both are project-wide choices with their own endpoint,
          so both sit outside the settings form with a button each. */}
      {state.settings && <ProtagonistAssetCard projectId={projectId} />}
      {state.settings && <GlobalStyleAssetCard projectId={projectId} />}
    </section>
  );
}
