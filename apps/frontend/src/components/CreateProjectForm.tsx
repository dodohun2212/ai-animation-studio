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
      errors.projectId = "프로젝트 ID를 입력하세요.";
    } else if (!isSafeProjectId(trimmedId)) {
      errors.projectId = "프로젝트 ID는 문자, 숫자, '_', '-'만 사용할 수 있습니다.";
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
    <form className="mt-8 space-y-4" onSubmit={handleSubmit} noValidate>
      <div>
        <label className="block text-sm text-slate-300" htmlFor="projectId">
          프로젝트 ID
        </label>
        <input
          id="projectId"
          className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-slate-100"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          disabled={submitting}
        />
        {fieldErrors.projectId && (
          <p className="mt-1 text-sm text-rose-400" role="alert">
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
          className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-slate-100"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          disabled={submitting}
        />
        {fieldErrors.topic && (
          <p className="mt-1 text-sm text-rose-400" role="alert">
            {fieldErrors.topic}
          </p>
        )}
      </div>
      {submitError && (
        <p className="text-sm text-rose-400" role="alert" data-error-code={submitError.code}>
          {submitError.message}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="submit"
          className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={submitting}
        >
          {submitting ? "생성 중..." : "프로젝트 생성"}
        </button>
        <button
          type="button"
          className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300"
          onClick={onCancel}
          disabled={submitting}
        >
          취소
        </button>
      </div>
    </form>
  );
}
