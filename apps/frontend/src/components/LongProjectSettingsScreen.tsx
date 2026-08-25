import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LongProjectSettings } from "@ai-animation-studio/shared";

import { getLongProjectSettings, toLongProjectDisplayError, updateLongProjectSettings } from "../api/longProjectsApi.js";
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
      setState((old) => ({ ...old, error: { code: "INVALID_REQUEST", message: "제목과 로그라인은 필수입니다." } }));
      return;
    }
    if (
      !Number.isInteger(settings.episodeCount) ||
      settings.episodeCount < 1 ||
      !Number.isInteger(settings.episodeDurationSeconds) ||
      settings.episodeDurationSeconds <= 0
    ) {
      setState((old) => ({ ...old, error: { code: "INVALID_REQUEST", message: "에피소드 수와 길이를 올바르게 입력하세요." } }));
      return;
    }
    saving.current = true;
    setState((old) => ({ ...old, loading: true, error: null }));
    try {
      const response = await updateLongProjectSettings(projectId, { settings });
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
          <Field label="로그라인" value={state.settings.logline} onChange={(value) => setField("logline", value)} />
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
            에피소드 길이(초)
            <input
              type="number"
              className={fieldClassName}
              value={state.settings.episodeDurationSeconds}
              onChange={(event) => setField("episodeDurationSeconds", Number(event.target.value))}
            />
          </label>
          <label className="block text-sm text-slate-300">
            플랫폼
            <select
              className={fieldClassName}
              value={state.settings.platform}
              onChange={(event) => setField("platform", event.target.value as LongProjectSettings["platform"])}
            >
              <option value="YouTube Shorts">YouTube Shorts</option>
              <option value="YouTube">YouTube</option>
            </select>
          </label>
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
          <Field label="타겟 시청자" value={state.settings.audience} onChange={(value) => setField("audience", value)} />
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
    </section>
  );
}
