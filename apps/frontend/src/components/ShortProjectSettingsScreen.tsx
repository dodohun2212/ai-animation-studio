import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ShortProjectSettings } from "@ai-animation-studio/shared";

import { getProjectSettings, toDisplayError, updateProjectSettings } from "../api/projectsApi.js";

interface Props { projectId: string; onBack: () => void; }
type State = { settings: ShortProjectSettings | null; loading: boolean; error: { code: string; message: string } | null };

const EMPTY_SETTINGS: ShortProjectSettings = {
  projectName: "", topic: "", genre: "미스터리", mood: "시네마틱", character: "", lore: "", fullStory: "",
  durationSeconds: 30, sceneCount: 6, additionalNotes: "", styleNotes: { aspect: "16:9" },
};

function Field({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  const classes = "mt-1 w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-slate-100";
  return <label className="block text-sm text-slate-300">{label}{multiline
    ? <textarea className={classes} value={value} onChange={(event) => onChange(event.target.value)} rows={3} />
    : <input className={classes} value={value} onChange={(event) => onChange(event.target.value)} />}
  </label>;
}

export function ShortProjectSettingsScreen({ projectId, onBack }: Props) {
  const [state, setState] = useState<State>({ settings: null, loading: true, error: null });
  const saving = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getProjectSettings(projectId).then(({ settings }) => {
      if (!cancelled) setState({ settings, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!cancelled) setState({ settings: null, loading: false, error: toDisplayError(error) });
    });
    return () => { cancelled = true; };
  }, [projectId]);

  function setField<Key extends keyof ShortProjectSettings>(key: Key, value: ShortProjectSettings[Key]): void {
    setState((old) => old.settings ? { ...old, settings: { ...old.settings, [key]: value }, error: null } : old);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!state.settings || saving.current) return;
    const settings = { ...state.settings, projectName: state.settings.projectName.trim(), topic: state.settings.topic.trim() };
    if (!settings.projectName || !settings.topic) {
      setState((old) => ({ ...old, error: { code: "INVALID_REQUEST", message: "프로젝트 이름과 영상 주제는 필수입니다." } }));
      return;
    }
    saving.current = true;
    setState((old) => ({ ...old, loading: true, error: null }));
    try {
      const response = await updateProjectSettings(projectId, { settings });
      setState({ settings: response.settings, loading: false, error: null });
    } catch (error) {
      setState((old) => ({ ...old, loading: false, error: toDisplayError(error) }));
    } finally { saving.current = false; }
  }

  if (state.loading && !state.settings) return <p className="mt-8 text-slate-400">불러오는 중…</p>;
  return <section className="mt-8">
    <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300" onClick={onBack}>목록으로</button>
    <h2 className="mt-4 text-xl font-semibold">프로젝트 설정</h2>
    {state.error && <p className="mt-4 text-sm text-rose-400" role="alert" data-error-code={state.error.code}>{state.error.message}</p>}
    {state.settings && <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
      <Field label="프로젝트 이름" value={state.settings.projectName} onChange={(value) => setField("projectName", value)} />
      <Field label="영상 주제" value={state.settings.topic} onChange={(value) => setField("topic", value)} />
      <Field label="장르" value={state.settings.genre} onChange={(value) => setField("genre", value)} />
      <Field label="분위기" value={state.settings.mood} onChange={(value) => setField("mood", value)} />
      <Field label="대표 캐릭터" value={state.settings.character} onChange={(value) => setField("character", value)} />
      <Field label="영상 길이(초)" value={String(state.settings.durationSeconds)} onChange={(value) => setField("durationSeconds", Number(value) || 0)} />
      <Field label="전체 줄거리" value={state.settings.fullStory} onChange={(value) => setField("fullStory", value)} multiline />
      <Field label="세계관" value={state.settings.lore} onChange={(value) => setField("lore", value)} multiline />
      <Field label="시각 스타일" value={state.settings.styleNotes.visualStyle ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, visualStyle: value })} />
      <Field label="색감" value={state.settings.styleNotes.color ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, color: value })} />
      <Field label="조명" value={state.settings.styleNotes.lighting ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, lighting: value })} />
      <Field label="카메라 느낌" value={state.settings.styleNotes.camera ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, camera: value })} />
      <Field label="대사 스타일" value={state.settings.styleNotes.dialogue ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, dialogue: value })} />
      <Field label="피할 요소" value={state.settings.styleNotes.avoid ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, avoid: value })} />
      <Field label="화면 비율" value={state.settings.styleNotes.aspect ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, aspect: value })} />
      <Field label="추가 지시사항" value={state.settings.additionalNotes} onChange={(value) => setField("additionalNotes", value)} multiline />
      <p className="text-sm text-slate-400">장면 수: 정확히 {state.settings.sceneCount}개</p>
      <button type="submit" disabled={state.loading} className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{state.loading ? "저장 중…" : "설정 저장"}</button>
    </form>}
  </section>;
}
