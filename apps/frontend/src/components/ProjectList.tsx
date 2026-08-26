import { useEffect, useState } from "react";
import { WorkflowState, type ProjectSummary } from "@ai-animation-studio/shared";

import { listProjects, toDisplayError } from "../api/projectsApi.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { workflowStateLabel } from "../utils/workflowStateLabels.js";
import { Spinner } from "./Spinner.js";
import { WorkflowProgressBar, progressPercent } from "./WorkflowProgressBar.js";
import { StatusChip, type StatusTone } from "./ui/StatusChip.js";

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

/**
 * Workflow state → status chip tone, per the design system's fixed grammar (§2.1/§3.4): emerald only for a
 * genuinely finished project, amber while something is running, rose on failure, neutral for the waiting and
 * review steps. `Ready` is deliberately neutral — it means "set up, not started", not "done".
 */
function statusTone(state: WorkflowState): StatusTone {
  if (state === WorkflowState.Failed || state === WorkflowState.Cancelled) return "danger";
  if (state === WorkflowState.Completed) return "success";
  if (state === WorkflowState.Interrupted) return "progress";
  if (
    state === WorkflowState.GeneratingStory || state === WorkflowState.GeneratingImages
    || state === WorkflowState.GeneratingVideos || state === WorkflowState.Rendering
  ) return "progress";
  return "neutral";
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

/** A generic gradient placeholder thumbnail — no per-project image exists yet, so this stands in as a consistent brand mark rather than a broken image. */
function ProjectThumbnail() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-9 w-9">
      <defs>
        <linearGradient id="projectThumbGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#f0abfc" />
        </linearGradient>
      </defs>
      <path
        d="M24 4 L42 14 L42 34 L24 44 L6 34 L6 14 Z M24 4 L24 24 L42 14 M24 24 L6 14 M24 24 L24 44"
        fill="none"
        stroke="url(#projectThumbGradient)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
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

  const projects = state.projects ?? [];
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

      {state.projects !== null && state.projects.length === 0 && (
        <p className="mt-4 text-slate-400">아직 생성된 프로젝트가 없습니다.</p>
      )}
      {state.projects !== null && state.projects.length > 0 && (
        <ul className="mt-4 space-y-3">
          {state.projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-left text-slate-100 transition-colors duration-150 hover:border-violet-400/40 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30"
                onClick={() => onOpenProject(project.id)}
              >
                <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl bg-slate-800">
                  <ProjectThumbnail />
                </span>
                <span className="min-w-0 flex-1">
                  {/* The topic is what the user recognizes a project by; the generated id is the machine
                      handle and belongs underneath it, not as the headline. */}
                  <span className="block truncate text-sm font-semibold text-slate-100">{project.topic || project.id}</span>
                  <span className="block truncate text-xs text-slate-400">{project.id}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StatusChip tone={statusTone(project.workflowState)}>
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
