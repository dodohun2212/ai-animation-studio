import { useEffect, useState } from "react";
import type { LongProjectSummary } from "@ai-animation-studio/shared";

import { listLongProjects, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { Spinner } from "./Spinner.js";

interface LongProjectListProps {
  refreshToken: number;
  onOpenProject: (projectId: string) => void;
  onCreateNew: () => void;
}

interface ListState {
  // null until the first successful load; a failed refresh never clears it.
  projects: LongProjectSummary[] | null;
  error: { code: string; message: string } | null;
  loading: boolean;
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-4 w-4 flex-shrink-0">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4 flex-shrink-0">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** A book/reel motif for long-form (multi-episode) projects — distinct from the short-project cube mark. */
function LongProjectThumbnail() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-9 w-9">
      <defs>
        <linearGradient id="longProjectThumbGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#f0abfc" />
        </linearGradient>
      </defs>
      <path
        d="M8 8 H28 V40 H8 Z M28 12 L40 15 V37 L28 34 Z M13 16 H23 M13 22 H23 M13 28 H20"
        fill="none"
        stroke="url(#longProjectThumbGradient)"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LongProjectList({ refreshToken, onOpenProject, onCreateNew }: LongProjectListProps) {
  const [state, setState] = useState<ListState>({ projects: null, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true }));
    listLongProjects()
      .then((response) => {
        if (!cancelled) {
          setState({ projects: response.projects, error: null, loading: false });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setState((previous) => ({ ...previous, error: toLongProjectDisplayError(error), loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  return (
    <section className="mt-8">
      <header className="flex items-center justify-between">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
          />
          장기 프로젝트
        </h2>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]"
          onClick={onCreateNew}
        >
          <PlusIcon />
          새 장기 프로젝트
        </button>
      </header>

      {state.projects === null && state.loading && <Spinner label="불러오는 중..." className="mt-4" />}

      {state.error && (
        <p className="mt-4 text-sm text-rose-400" role="alert" data-error-code={state.error.code}>
          {state.error.message}
        </p>
      )}

      {state.projects !== null && state.projects.length === 0 && (
        <p className="mt-4 text-slate-400">아직 생성된 장기 프로젝트가 없습니다.</p>
      )}
      {state.projects !== null && state.projects.length > 0 && (
        <ul className="mt-4 space-y-3">
          {state.projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-left text-slate-100"
                onClick={() => onOpenProject(project.id)}
              >
                <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl bg-slate-800">
                  <LongProjectThumbnail />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{project.title}</span>
                  <span className="block truncate text-sm text-slate-300">{project.logline}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-medium text-violet-300">
                      {project.outlineStatus} · Episode {project.episodeCount}개
                    </span>
                    <span className="text-xs text-slate-500">{project.updatedAt}</span>
                  </span>
                </span>
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-300">
                  <ArrowIcon />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
