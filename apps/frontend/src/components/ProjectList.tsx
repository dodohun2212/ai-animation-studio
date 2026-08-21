import { useEffect, useState } from "react";
import type { ProjectSummary } from "@ai-animation-studio/shared";

import { listProjects, toDisplayError } from "../api/projectsApi.js";

interface ProjectListProps {
  refreshToken: number;
  onOpenProject: (projectId: string) => void;
  onCreateNew: () => void;
}

interface ListState {
  // null until the first successful load; a failed refresh never clears it.
  projects: ProjectSummary[] | null;
  error: { code: string; message: string } | null;
  loading: boolean;
}

export function ProjectList({ refreshToken, onOpenProject, onCreateNew }: ProjectListProps) {
  const [state, setState] = useState<ListState>({ projects: null, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true }));
    listProjects()
      .then((response) => {
        if (!cancelled) {
          // Preserve the Backend's response order as-is.
          setState({ projects: response.projects, error: null, loading: false });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setState((previous) => ({ ...previous, error: toDisplayError(error), loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  return (
    <section className="mt-8">
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">단기 프로젝트</h2>
        <button
          type="button"
          className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white"
          onClick={onCreateNew}
        >
          새 프로젝트
        </button>
      </header>

      {state.projects === null && state.loading && <p className="mt-4 text-slate-400">불러오는 중...</p>}

      {state.error && (
        <p className="mt-4 text-sm text-rose-400" role="alert" data-error-code={state.error.code}>
          {state.error.message}
        </p>
      )}

      {state.projects !== null && state.projects.length === 0 && (
        <p className="mt-4 text-slate-400">아직 생성된 프로젝트가 없습니다.</p>
      )}
      {state.projects !== null && state.projects.length > 0 && (
        <ul className="mt-4 space-y-2">
          {state.projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-left text-slate-100"
                onClick={() => onOpenProject(project.id)}
              >
                <span className="block font-semibold">{project.id}</span>
                <span className="block text-slate-300">{project.topic}</span>
                <span className="block text-xs uppercase tracking-wide text-slate-400">{project.workflowState}</span>
                <span className="block text-xs text-slate-500">{project.updatedAt}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
