import { useRef, useState, type FormEvent } from "react";
import type { Project } from "@ai-animation-studio/shared";

import { createProject, toDisplayError } from "../api/projectsApi.js";
import { isSafeProjectId } from "../validation/projectId.js";

interface CreateProjectFormProps {
  onCreated: (project: Project) => void;
  onCancel: () => void;
}

interface FieldErrors {
  projectId?: string;
  topic?: string;
}

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";

export function CreateProjectForm({ onCreated, onCancel }: CreateProjectFormProps) {
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
      errors.projectId = "폴더 이름에는 영문, 숫자, '_', '-'만 쓸 수 있습니다. 한글과 띄어쓰기는 폴더 이름으로 쓸 수 없습니다.";
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

  return (
    <form
      className="mt-8 max-w-xl space-y-5 rounded-2xl border border-white/10 bg-slate-900/70 p-6"
      onSubmit={handleSubmit}
      noValidate
    >
      <div>
        <label className="block text-sm text-slate-300" htmlFor="projectId">
          폴더 이름 (영문·숫자)
        </label>
        {/* Was labelled "프로젝트 ID" with no explanation — the first field of the app asked a creator to invent
            a machine identifier and obey a charset rule. It is really the folder this project gets on disk, so
            it is named that, and the constraint is stated before it can be violated rather than after. */}
        <p className="mt-1 text-xs text-slate-500">
          이 이름으로 컴퓨터에 프로젝트 폴더가 만들어집니다. 영문·숫자와 _ - 만 쓸 수 있고, 만든 뒤에는 바꿀 수 없습니다.
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
  );
}
