import { useRef, useState, type FormEvent } from "react";
import type { Project } from "@ai-animation-studio/shared";

import { createProject, toDisplayError } from "../api/projectsApi.js";
import { isSafeProjectId } from "../validation/projectId.js";
import { CreateFlowerReelForm } from "./CreateFlowerReelForm.js";
import { ScreenHeader } from "./ui/ScreenHeader.js";

interface CreateProjectFormProps {
  onCreated: (project: Project) => void;
  onCancel: () => void;
}

interface FieldErrors {
  projectId?: string;
  topic?: string;
}

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";

/**
 * Which brief the new project starts from.
 *
 * 🔴 Both branches make exactly the same thing — an ordinary short project, same pipeline, same story call,
 * same images, videos, merge and publish. The flower branch only pre-fills the settings that a flower reel
 * always wants: the seed-to-bloom arc, the look, two ten-second scenes. That is why it is a branch here and
 * not its own sidebar entry: 명언 카드 has its own door because its *result* differs (it skips five of these
 * steps and costs nothing), and this one's result does not.
 *
 * 🟠 An earlier version of this branch wrote the script by hand instead. It could create a project that the
 * image step then refused, because the prompts read seventeen scene fields and only story generation fills
 * them (CLI Round 609). Preset, not pipeline.
 */
type ScriptSource = "ai" | "flower";

export function CreateProjectForm({ onCreated, onCancel }: CreateProjectFormProps) {
  const [source, setSource] = useState<ScriptSource>("ai");
  const [projectId, setProjectId] = useState("");
  const [topic, setTopic] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<{ code: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref guards re-entrant submits synchronously — React state updates are
  // batched, so two rapid clicks could both read `submitting === false`
  // before either re-render commits and disables the button.
  const submittingRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    const trimmedId = projectId.trim();
    const trimmedTopic = topic.trim();
    const errors: FieldErrors = {};
    if (!trimmedId) {
      errors.projectId = "폴더 이름을 입력하세요.";
    } else if (!isSafeProjectId(trimmedId)) {
      errors.projectId = "폴더 이름에는 한글, 영문, 숫자와 '_', '-'만 쓸 수 있습니다. 띄어쓰기는 쓸 수 없습니다.";
    }
    if (!trimmedTopic) {
      errors.topic = "영상 주제를 입력하세요.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setSubmitError(null);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await createProject({ projectId: trimmedId, topic: trimmedTopic });
      onCreated(response.project);
    } catch (error) {
      setSubmitError(toDisplayError(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const choice = (value: ScriptSource, label: string, note: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={source === value}
      data-testid={`create-source-${value}`}
      disabled={submitting}
      onClick={() => setSource(value)}
      className={`flex-1 rounded-xl border p-3.5 text-left disabled:opacity-50 ${source === value ? "border-violet-400/70 bg-violet-500/10" : "border-white/10 hover:bg-white/5"}`}
    >
      <span className="block text-sm font-semibold text-slate-100">{label}</span>
      <span className="mt-1 block text-xs text-slate-400">{note}</span>
    </button>
  );

  /*
   * 🔴 This screen opened with a radio group and then a field labelled 폴더 이름 — no title anywhere, so the
   * first thing the app ever asks a person is a question with no heading above it. The two branches below
   * both render `picker`, so the heading sits with it and is written once.
   */
  const header = (
    <ScreenHeader
      title="새 프로젝트 만들기"
      description="무엇으로 시작할지 고르고, 이름과 주제만 정하면 됩니다. 나머지 설정은 만든 뒤에 바꿀 수 있습니다."
      backLabel="프로젝트 목록으로"
      onBack={onCancel}
      className="mt-8"
    />
  );

  const picker = (
    <div role="radiogroup" aria-label="무엇으로 시작할지" className="mt-5 flex max-w-2xl flex-wrap gap-3">
      {choice("ai", "빈 프로젝트에서 시작", "주제 한 줄을 적고, 나머지는 설정 화면에서 채웁니다.")}
      {choice("flower", "꽃말 릴스 서식", "꽃 이름과 꽃말만 적으면 씨앗에서 꽃이 피기까지의 구성과 화면 스타일이 채워집니다.")}
    </div>
  );

  if (source === "flower") {
    return (
      <>
        {header}
        {picker}
        <CreateFlowerReelForm onCreated={onCreated} onCancel={onCancel} />
      </>
    );
  }

  return (
    <>
    {header}
    {picker}
    <form
      className="mt-5 max-w-xl space-y-5 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-6"
      onSubmit={handleSubmit}
      noValidate
    >
      <div>
        <label className="block text-sm text-slate-300" htmlFor="projectId">
          폴더 이름
        </label>
        {/* Was labelled "프로젝트 ID" with no explanation — the first field of the app asked a creator to invent
            a machine identifier and obey a charset rule. It is really the folder this project gets on disk, so
            it is named that, and the constraint is stated before it can be violated rather than after. */}
        {/* 🔴 The rule said 한글을 쓸 수 없다 and that was not true: both allow-lists are `\p{L}`, which accepts
            Hangul, and every 명언 card on this machine is named in Korean. The first field of the app was
            refusing names the server would have taken. Only the space is a real refusal. */}
        <p className="mt-1 text-xs text-slate-500">
          이 이름으로 컴퓨터에 프로젝트 폴더가 만들어집니다. 한글·영문·숫자와 _ - 를 쓸 수 있고 띄어쓰기는 쓸 수 없습니다. 만든 뒤에는 바꿀 수 없습니다.
        </p>
        <input
          id="projectId"
          className={fieldClassName}
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          disabled={submitting}
        />
        {fieldErrors.projectId && (
          <p className="mt-1.5 text-sm text-rose-400" role="alert">
            {fieldErrors.projectId}
          </p>
        )}
      </div>
      <div>
        <label className="block text-sm text-slate-300" htmlFor="topic">
          영상 주제
        </label>
        <input
          id="topic"
          className={fieldClassName}
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          disabled={submitting}
        />
        {fieldErrors.topic && (
          <p className="mt-1.5 text-sm text-rose-400" role="alert">
            {fieldErrors.topic}
          </p>
        )}
      </div>
      {submitError && (
        <p className="text-sm text-rose-400" role="alert" data-error-code={submitError.code}>
          {submitError.message}
        </p>
      )}
      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
          disabled={submitting}
        >
          {submitting ? "생성 중..." : "프로젝트 생성"}
        </button>
        <button
          type="button"
          className="rounded-full border border-white/10 px-5 py-2.5 text-sm text-slate-300 hover:bg-white/5"
          onClick={onCancel}
          disabled={submitting}
        >
          취소
        </button>
      </div>
    </form>
    </>
  );
}
