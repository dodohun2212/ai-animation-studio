import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_SCENE_COUNT, MIN_SCENE_COUNT, RUNWAY_CLIP_DURATIONS, type LongProjectSettings } from "@ai-animation-studio/shared";

import { getLongProjectSettings, toLongProjectDisplayError, updateLongProjectSettings } from "../api/longProjectsApi.js";
import { GlobalStyleAssetCard } from "./GlobalStyleAssetCard.js";
import { ProtagonistAssetCard } from "./ProtagonistAssetCard.js";
import { Spinner } from "./Spinner.js";
import { StorySecretsCard } from "./StorySecretsCard.js";
import { StoryWorldCard } from "./StoryWorldCard.js";

interface Props {
  projectId: string;
  onBack: () => void;
}

type State = {
  settings: LongProjectSettings | null;
  loading: boolean;
  error: { code: string; message: string } | null;
  /**
   * Whether the aspect ratio can still be changed, answered by the server rather than derived here.
   *
   * The save enforces this with the same function that computes it, so the screen never carries a second copy
   * of the rule — two copies is how a screen comes to disagree with its own server about work someone paid for.
   * Starts true so nothing is disabled while the answer is in flight, and a failed load leaves the old
   * behaviour rather than locking a field on a read that never arrived.
   */
  aspectRatioChangeable: boolean;
  /** Which Episode closed it. A bare "you cannot change this" leaves the person asking why now; this answers it. */
  aspectRatioLockedBy?: number;
};

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
  const [state, setState] = useState<State>({ settings: null, loading: true, error: null, aspectRatioChangeable: true });
  const [justSaved, setJustSaved] = useState(false);
  const saving = useRef(false);
  const justSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (justSavedTimer.current) clearTimeout(justSavedTimer.current); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getLongProjectSettings(projectId)
      .then((response) => {
        if (cancelled) return;
        setState({
          settings: response.settings,
          loading: false,
          error: null,
          aspectRatioChangeable: response.aspectRatioChangeable,
          aspectRatioLockedBy: response.aspectRatioLockedByEpisodeNumber,
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ settings: null, loading: false, error: toLongProjectDisplayError(error), aspectRatioChangeable: true });
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
      // Merged, not replaced: the update response carries the settings, not the lock — and saving cannot close
      // it anyway (only generating images does). Replacing the whole state here would drop what the GET said and
      // silently unlock a project whose images already exist.
      setState((old) => ({ ...old, settings: response.project.settings, loading: false, error: null }));
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
      {/* Said once, here, instead of four times below.
          Every card on this screen — 주인공, 전체 그림체, 세계관 설명, 비밀·복선 — carried its own copy of the
          same three facts: what reaches the AI, that blank is allowed, and that already-written Episodes do not
          change. Four restatements of one rule is how a screen ends up too long to read, and a person who
          stops reading misses the one line that was specific to the card in front of them. */}
      {/* "여기 적은 내용은" was true until 그림체 arrived, and a line that is true of most of a screen is the
          kind that stops being read. The exception is named here rather than left for the person to discover:
          those four boxes are the only ones on this screen that do not reach the script. */}
      <p data-testid="long-settings-scope" className="text-sm text-slate-400">
        여기 적은 내용은 <strong className="text-slate-200">회차 나누기</strong>와 <strong className="text-slate-200">대본 생성</strong> 때 AI에게 전달됩니다
        — <strong className="text-slate-200">그림체</strong> 칸 넷만 예외로 그림 쪽으로 갑니다.
        빈 칸은 AI가 알아서 정하고, <strong className="text-slate-200">이미 만든 회차는 다시 만들어야</strong> 반영됩니다.
      </p>
      {state.error && !state.settings && (
        <p className="text-sm text-rose-400" role="alert" data-error-code={state.error.code}>
          {state.error.message}
        </p>
      )}
      {/* One form, three groups, and the last one closed.
          It used to be every field at once — about six screens of column, all of it permanently above the four
          cards below. Almost none of it is edited twice: a title is set once, an episode count is set once.
          Grouping does not hide anything; it stops the rarely-touched half from being in the way of the part
          someone came to change. */}
      {state.settings && (
        <form className="grid gap-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6 md:grid-cols-2" onSubmit={submit} noValidate>
          <div className="grid gap-4 md:col-span-2 md:grid-cols-2">
          <Field label="제목" value={state.settings.title} onChange={(value) => setField("title", value)} />
          <Field label="한 줄 줄거리" value={state.settings.logline} onChange={(value) => setField("logline", value)} />
          <Field label="개요" value={state.settings.overview} onChange={(value) => setField("overview", value)} multiline />
          <Field label="장르" value={state.settings.genre} onChange={(value) => setField("genre", value)} />
          <Field label="톤" value={state.settings.tone} onChange={(value) => setField("tone", value)} />
          <Field label="테마" value={state.settings.theme} onChange={(value) => setField("theme", value)} />
          </div>
          {/* Closed, like the cards below, and for the same reason: these are set once. Leaving this one open
              while collapsing everything else was the inconsistency — the summary says what is set, so opening
              it is for changing, not for checking. */}
          <details className="md:col-span-2 rounded-xl border border-white/10 bg-slate-950/30" data-testid="long-settings-video-group">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-200">
              영상 만들기
              <span className="ml-2 font-normal text-slate-500">
                {state.settings.episodeCount}화 · {state.settings.sceneCount}장면 × {state.settings.clipDurationSeconds}초 · {state.settings.aspectRatio}
                {state.settings.narrationEnabled ? " · 음성" : ""}{state.settings.subtitlesEnabled ? " · 자막" : ""}
              </span>
            </summary>
            <div className="grid gap-4 px-4 pb-4 md:grid-cols-2">
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
          <label className="block text-sm text-slate-300" htmlFor="long-settings-aspect-ratio">
            화면 비율
            <select
              id="long-settings-aspect-ratio"
              data-testid="long-settings-aspect-ratio"
              className={fieldClassName}
              value={state.settings.aspectRatio}
              disabled={!state.aspectRatioChangeable}
              onChange={(event) => setField("aspectRatio", event.target.value as LongProjectSettings["aspectRatio"])}
            >
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
            </select>
            {/* Said here rather than after the save is refused. The refusal is the same either way; the only
                thing that can change is whether it arrives before or after the person decided to change it. */}
            {!state.aspectRatioChangeable && (
              <span data-testid="long-settings-aspect-locked" className="mt-1.5 block text-xs text-amber-300">
                {state.aspectRatioLockedBy !== undefined
                  ? `${state.aspectRatioLockedBy}화가 이미 이미지를 만들어서 화면 비율은 더 이상 바꿀 수 없습니다.`
                  : "이미 이미지를 만든 회차가 있어 화면 비율은 더 이상 바꿀 수 없습니다."}
                {" "}바꾸려면 그 이미지들을 다시 만들어야 하고, 비용이 듭니다.
              </span>
            )}
          </label>
          <div className="md:col-span-2 space-y-3 rounded-xl border border-white/10 bg-slate-950/40 p-3.5">
            <p className="text-sm font-semibold text-slate-200">내레이션</p>
            <p className="text-xs leading-relaxed text-slate-400">장면마다 읽어줄 문장이 대본에 함께 들어갑니다. 인물이 말하는 게 아니라 읽어주는 방식입니다.</p>
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
                <span className="mt-1 block text-xs text-slate-400">실제 목소리로 만들어 영상에 입힙니다. 에피소드마다, 장면마다 한 번씩 비용이 듭니다.</span>
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
                <span className="mt-1 block text-xs text-slate-400">같은 문장을 글자로 얹습니다. <span className="text-slate-300">비용 없음.</span></span>
              </span>
            </label>
          </div>
            </div>
          </details>
          {/*
            The art direction — the only fields on this screen that reach the image model.
            Four boxes, matching the four the backend's style line is actually built from; the short project's
            seven include three that go elsewhere, and building those here would put boxes on screen that do
            nothing, which is the defect this repository has spent the week removing.

            The summary counts what is filled rather than listing it: these are free text and any one of them
            can be a sentence, which would push the group's own heading off the line.
          */}
          <details className="md:col-span-2 rounded-xl border border-white/10 bg-slate-950/30" data-testid="long-settings-style-group">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-200">
              그림체
              <span className="ml-2 font-normal text-slate-500">
                {[state.settings.visualStyle, state.settings.color, state.settings.lighting, state.settings.avoid].filter((value) => value.trim()).length > 0
                  ? `${[state.settings.visualStyle, state.settings.color, state.settings.lighting, state.settings.avoid].filter((value) => value.trim()).length}칸 채움`
                  : "(비워 두면 지금까지와 똑같습니다)"}
              </span>
            </summary>
            <div className="grid gap-4 px-4 pb-4 md:grid-cols-2">
              {/* The whole reason this group is separate. 톤 and 메모 sit a few centimetres above and reach the
                  script and not the picture; these reach the picture and not the script. Nothing on screen makes
                  that visible unless it is said, and not saying it is the misunderstanding this box grew out of:
                  Episodes were drawn for weeks with no art direction at all because there was nowhere to put it. */}
              <p data-testid="long-settings-style-scope" className="md:col-span-2 text-sm text-slate-400">
                이 넷은 <strong className="text-slate-200">그림에만</strong> 갑니다. 대본에는 들어가지 않습니다 — 위의 톤·메모와 반대입니다.
                <span className="mt-1 block text-xs text-slate-500">전부 비워 두면 스타일 지시 자체가 나가지 않아, 지금까지 만들어진 회차와 똑같이 그려집니다.</span>
              </p>
              <Field label="시각 스타일" value={state.settings.visualStyle} onChange={(value) => setField("visualStyle", value)} />
              <Field label="색감" value={state.settings.color} onChange={(value) => setField("color", value)} />
              <Field label="조명" value={state.settings.lighting} onChange={(value) => setField("lighting", value)} />
              <label className="block text-sm text-slate-300">
                피할 요소
                <input className={fieldClassName} value={state.settings.avoid} onChange={(event) => setField("avoid", event.target.value)} />
                {/* Said because it is surprising and costs money to learn the other way: the video model reads
                    negatives backwards, so this one field stops at the picture even though the three above it
                    describe the same shot. */}
                <span className="mt-1.5 block text-xs text-slate-500">그림에서 빼라고 전달됩니다. <strong className="text-slate-400">영상 쪽에는 가지 않습니다</strong> — 영상 AI는 &quot;~하지 마라&quot;를 반대로 알아듣습니다.</span>
              </label>
            </div>
          </details>
          {/* Closed by default: these shape the story rather than the video, and a blank one is a complete
              answer — the AI decides. Someone with nothing particular in mind never has to open it. */}
          <details className="md:col-span-2 rounded-xl border border-white/10 bg-slate-950/30" data-testid="long-settings-story-group">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-200">이야기 흐름 <span className="font-normal text-slate-500">(비워 둬도 됩니다)</span></summary>
            <div className="grid gap-4 px-4 pb-4 md:grid-cols-2">
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
            </div>
          </details>
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
      {/* 주인공 · 전체 그림체 · 세계관 설명 · 비밀·복선 all moved here from 등장인물·설정집. Each describes the
          work rather than one character or one Episode, and script generation reads all four from the project.
          They sit outside the settings form because each saves through its own endpoint — one button per thing
          that is actually stored separately. Pictures first (one choice each), then the two lists. */}
      {state.settings && <ProtagonistAssetCard projectId={projectId} />}
      {state.settings && <GlobalStyleAssetCard projectId={projectId} />}
      {state.settings && <StoryWorldCard projectId={projectId} />}
      {state.settings && <StorySecretsCard projectId={projectId} />}
    </section>
  );
}
