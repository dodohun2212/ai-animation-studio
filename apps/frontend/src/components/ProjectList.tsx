import { useEffect, useState } from "react";
import { WorkflowState, type ProjectSummary } from "@ai-animation-studio/shared";

import { listProjects, toDisplayError } from "../api/projectsApi.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { workflowStateLabel, workflowStateTone } from "../utils/workflowStateLabels.js";
import { Spinner } from "./Spinner.js";
import { WorkflowProgressBar, progressPercent } from "./WorkflowProgressBar.js";
import { StatusChip } from "./ui/StatusChip.js";
import { CoverThumb } from "./ui/CoverThumb.js";
import { sceneImageContentUrl } from "../api/videoWorkflowApi.js";

interface ProjectListProps {
  refreshToken: number;
  onOpenProject: (projectId: string) => void;
  onCreateNew: () => void;
}

/**
 * The one-line dashboard summary Python always showed at the bottom of its window (`app/ui.py`'s
 * `footer_status`): how many projects there are, and how many are sitting waiting for the user to confirm
 * video generation. The waiting count is the point — it answers "is anything waiting on me right now" without
 * scrolling the list, which is what someone opening the app wants to know. Counted the same way Python counted
 * it (DashboardData.waiting_count): projects in WAITING_FOR_VIDEO_CONFIRMATION.
 *
 * Python's line had a third clause, the OpenAI key status, and this deliberately does not. Reading credential
 * status needs GET /settings/providers, and App.test.tsx pins — in two separate tests — that browsing the
 * project list never calls that route. That guard is worth more than the clause: credentials should not be
 * read as a side effect of navigating. The key status has its own screen one click away in the sidebar.
 */
function waitingForVideoCount(projects: ProjectSummary[]): number {
  return projects.filter((project) => project.workflowState === WorkflowState.WaitingForVideoConfirmation).length;
}

interface ListState {
  // null until the first successful load; a failed refresh never clears it.
  projects: ProjectSummary[] | null;
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

  /**
   * Photo cards are excluded, and this is the only place that decides it.
   *
   * A card IS a short project on disk — same storage, same merge, same publish — and `ProjectSummary.photoCard`
   * exists precisely so a screen can branch without a second project type. But on screen it is not one: it has
   * its own sidebar entry, its own front door, and a pipeline that skips five of this list's steps. Leaving
   * cards here put 명언_전인미답 and four siblings under a heading the person never chose for them, above a
   * progress bar counting steps their pipeline does not have.
   *
   * 🔴 The other half of this is PhotoCardScreen's own list. Filtering here without that would not tidy the
   * cards away — it would make finished work unreachable. The two ship together.
   */
  const projects = (state.projects ?? []).filter((project) => project.photoCard !== true);
  const waitingCount = waitingForVideoCount(projects);

  return (
    <section className="mt-8">
      <header className="flex items-center justify-between">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
          />
          단기 프로젝트
        </h2>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]"
          onClick={onCreateNew}
        >
          <PlusIcon />
          새 프로젝트
        </button>
      </header>

      {state.projects === null && state.loading && <Spinner label="불러오는 중..." className="mt-4" />}

      {state.error && (
        <p className="mt-4 text-sm text-rose-400" role="alert" data-error-code={state.error.code}>
          {state.error.message}
        </p>
      )}

      {state.projects !== null && projects.length === 0 && (
        <p className="mt-4 text-slate-400">아직 생성된 프로젝트가 없습니다.</p>
      )}
      {state.projects !== null && projects.length > 0 && (
        <ul className="mt-4 space-y-3">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-3 text-left text-slate-100 transition-colors duration-150 hover:border-violet-400/40 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30"
                onClick={() => onOpenProject(project.id)}
              >
                {/*
                  * The project's own first scene, not a house glyph.
                  *
                  * The glyph was here because the comment above it was true when it was written — no project
                  * had a picture. Every project that has reached image generation has had one since, and a
                  * list of six identical purple cubes is a list nobody can scan. CoverThumb keeps the glyph
                  * for the projects that genuinely have no picture yet.
                  */}
                <CoverThumb src={sceneImageContentUrl(project.id, 1)} className="h-16 w-16" />
                <span className="min-w-0 flex-1">
                  {/* The topic is what the user recognizes a project by; the generated id is the machine
                      handle and belongs underneath it, not as the headline. */}
                  <span className="block truncate text-sm font-semibold text-slate-100">{project.topic || project.id}</span>
                  <span className="block truncate text-xs text-slate-400">{project.id}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StatusChip tone={workflowStateTone(project.workflowState)}>
                      {workflowStateLabel(project.workflowState)}
                    </StatusChip>
                    <span className="text-xs text-slate-400 tabular-nums" title={project.updatedAt}>
                      {formatDateTime(project.updatedAt)}
                    </span>
                  </span>
                  <span className="mt-2 flex items-center gap-3">
                    <WorkflowProgressBar state={project.workflowState} className="flex-1" />
                    <span className="text-xs tabular-nums text-slate-400">{progressPercent(project.workflowState)}%</span>
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

      {state.projects !== null && (
        <p
          data-testid="dashboard-summary"
          className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/10 pt-3 text-xs text-slate-400"
        >
          <span className="tabular-nums">단기 프로젝트 {projects.length}개</span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span className={`tabular-nums ${waitingCount > 0 ? "text-amber-300" : ""}`} data-testid="dashboard-waiting-count">
            영상 생성 확인 대기 {waitingCount}개
          </span>
        </p>
      )}
    </section>
  );
}
