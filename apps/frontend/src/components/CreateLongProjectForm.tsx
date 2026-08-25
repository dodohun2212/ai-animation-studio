import { useRef, useState, type FormEvent } from "react";
import type { LongProject, LongProjectSettings } from "@ai-animation-studio/shared";

import { createLongProject, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { isSafeProjectId } from "../validation/projectId.js";

interface CreateLongProjectFormProps {
  onCreated: (project: LongProject) => void;
  onCancel: () => void;
}

interface FieldErrors {
  projectId?: string;
  title?: string;
  logline?: string;
  episodeCount?: string;
  episodeDurationSeconds?: string;
}

const EMPTY_SETTINGS: LongProjectSettings = {
  title: "",
  logline: "",
  overview: "",
  genre: "",
  tone: "",
  theme: "",
  episodeCount: 3,
  episodeDurationSeconds: 30,
  platform: "YouTube Shorts",
  aspectRatio: "9:16",
  audience: "",
  notes: "",
  startingState: "",
  midpoint: "",
  endingDirection: "",
  storyFlowSummary: "",
};

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";

function Field({
  label,
  value,
  onChange,
  multiline = false,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  disabled: boolean;
}) {
  return (
    <label className="block text-sm text-slate-300">
      {label}
      {multiline ? (
        <textarea className={fieldClassName} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} rows={3} />
      ) : (
        <input className={fieldClassName} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

export function CreateLongProjectForm({ onCreated, onCancel }: CreateLongProjectFormProps) {
  const [projectId, setProjectId] = useState("");
  const [settings, setSettings] = useState<LongProjectSettings>(EMPTY_SETTINGS);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<{ code: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref guards re-entrant submits synchronously — see CreateProjectForm for the same pattern.
  const submittingRef = useRef(false);

  function setField<Key extends keyof LongProjectSettings>(key: Key, value: LongProjectSettings[Key]): void {
    setSettings((old) => ({ ...old, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    const trimmedId = projectId.trim();
    const trimmedTitle = settings.title.trim();
    const trimmedLogline = settings.logline.trim();
    const errors: FieldErrors = {};
    if (!trimmedId) {
      errors.projectId = "프로젝트 ID를 입력하세요.";
    } else if (!isSafeProjectId(trimmedId)) {
      errors.projectId = "프로젝트 ID는 문자, 숫자, '_', '-'만 사용할 수 있습니다.";
    }
    if (!trimmedTitle) {
      errors.title = "제목을 입력하세요.";
    }
    if (!trimmedLogline) {
      errors.logline = "로그라인을 입력하세요.";
    }
    if (!Number.isInteger(settings.episodeCount) || settings.episodeCount < 1) {
      errors.episodeCount = "에피소드 수는 1 이상의 정수여야 합니다.";
    }
    if (!Number.isInteger(settings.episodeDurationSeconds) || settings.episodeDurationSeconds <= 0) {
      errors.episodeDurationSeconds = "에피소드 길이는 0보다 큰 정수여야 합니다.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setSubmitError(null);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await createLongProject({
        projectId: trimmedId,
        settings: { ...settings, title: trimmedTitle, logline: trimmedLogline },
      });
      onCreated(response.project);
    } catch (error) {
      setSubmitError(toLongProjectDisplayError(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form
      className="mt-8 grid gap-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6 md:grid-cols-2"
      onSubmit={handleSubmit}
      noValidate
    >
      <div>
        <label className="block text-sm text-slate-300" htmlFor="long-project-id">
          프로젝트 ID
        </label>
        <input
          id="long-project-id"
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
        <Field label="제목" value={settings.title} onChange={(value) => setField("title", value)} disabled={submitting} />
        {fieldErrors.title && (
          <p className="mt-1.5 text-sm text-rose-400" role="alert">
            {fieldErrors.title}
          </p>
        )}
      </div>
      <div className="md:col-span-2">
        <Field label="로그라인" value={settings.logline} onChange={(value) => setField("logline", value)} disabled={submitting} multiline />
        {fieldErrors.logline && (
          <p className="mt-1.5 text-sm text-rose-400" role="alert">
            {fieldErrors.logline}
          </p>
        )}
      </div>
      <Field label="개요" value={settings.overview} onChange={(value) => setField("overview", value)} disabled={submitting} multiline />
      <Field label="장르" value={settings.genre} onChange={(value) => setField("genre", value)} disabled={submitting} />
      <Field label="톤" value={settings.tone} onChange={(value) => setField("tone", value)} disabled={submitting} />
      <Field label="테마" value={settings.theme} onChange={(value) => setField("theme", value)} disabled={submitting} />
      <div>
        <label className="block text-sm text-slate-300" htmlFor="episode-count">
          에피소드 수
        </label>
        <input
          id="episode-count"
          type="number"
          className={fieldClassName}
          value={settings.episodeCount}
          disabled={submitting}
          onChange={(event) => setField("episodeCount", Number(event.target.value))}
        />
        {fieldErrors.episodeCount && (
          <p className="mt-1.5 text-sm text-rose-400" role="alert">
            {fieldErrors.episodeCount}
          </p>
        )}
      </div>
      <div>
        <label className="block text-sm text-slate-300" htmlFor="episode-duration">
          에피소드 길이(초)
        </label>
        <input
          id="episode-duration"
          type="number"
          className={fieldClassName}
          value={settings.episodeDurationSeconds}
          disabled={submitting}
          onChange={(event) => setField("episodeDurationSeconds", Number(event.target.value))}
        />
        {fieldErrors.episodeDurationSeconds && (
          <p className="mt-1.5 text-sm text-rose-400" role="alert">
            {fieldErrors.episodeDurationSeconds}
          </p>
        )}
      </div>
      <div>
        <label className="block text-sm text-slate-300" htmlFor="long-platform">
          플랫폼
        </label>
        <select
          id="long-platform"
          className={fieldClassName}
          value={settings.platform}
          disabled={submitting}
          onChange={(event) => setField("platform", event.target.value as LongProjectSettings["platform"])}
        >
          <option value="YouTube Shorts">YouTube Shorts</option>
          <option value="YouTube">YouTube</option>
        </select>
      </div>
      <div>
        <label className="block text-sm text-slate-300" htmlFor="long-aspect-ratio">
          화면 비율
        </label>
        <select
          id="long-aspect-ratio"
          className={fieldClassName}
          value={settings.aspectRatio}
          disabled={submitting}
          onChange={(event) => setField("aspectRatio", event.target.value as LongProjectSettings["aspectRatio"])}
        >
          <option value="9:16">9:16</option>
          <option value="16:9">16:9</option>
        </select>
      </div>
      <Field label="타겟 시청자" value={settings.audience} onChange={(value) => setField("audience", value)} disabled={submitting} />
      <Field label="메모" value={settings.notes} onChange={(value) => setField("notes", value)} disabled={submitting} multiline />
      <Field label="시작 상태" value={settings.startingState} onChange={(value) => setField("startingState", value)} disabled={submitting} multiline />
      <Field label="중간 전개" value={settings.midpoint} onChange={(value) => setField("midpoint", value)} disabled={submitting} multiline />
      <Field label="결말 방향" value={settings.endingDirection} onChange={(value) => setField("endingDirection", value)} disabled={submitting} multiline />
      <Field
        label="스토리 흐름 요약"
        value={settings.storyFlowSummary}
        onChange={(value) => setField("storyFlowSummary", value)}
        disabled={submitting}
        multiline
      />

      {submitError && (
        <p className="text-sm text-rose-400 md:col-span-2" role="alert" data-error-code={submitError.code}>
          {submitError.message}
        </p>
      )}
      <div className="flex gap-3 pt-1 md:col-span-2">
        <button
          type="submit"
          className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
          disabled={submitting}
        >
          {submitting ? "생성 중..." : "장기 프로젝트 생성"}
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
  );
}
