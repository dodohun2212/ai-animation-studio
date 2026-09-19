import { useEffect, useState } from "react";
import { WorkflowState, type ProjectSummary } from "@ai-animation-studio/shared";

import { listProjects, toDisplayError } from "../api/projectsApi.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { workflowStateLabel, workflowStateTone } from "../utils/workflowStateLabels.js";
import { Spinner } from "./Spinner.js";
import { progressPercent } from "./WorkflowProgressBar.js";
import { CoverThumb } from "./ui/CoverThumb.js";
import { sceneImageContentUrl } from "../api/videoWorkflowApi.js";
import { riseInCard } from "./ui/surfaces.js";

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
 * 프레임이 말하는 네 가지 모양.
 *
 * 🔴 이건 **새 상태 표가 아닙니다.** `workflowStateTone` 하나에서 그대로 파생됩니다 — 화면 어디서든 상태의
 * 문법은 한 군데(§2.1)에서만 정해져야 하고, 여기서 두 번째 표를 쓰면 이 목록만 「실패」를 다른 색으로 말하기
 * 시작합니다. 톤이 바뀌면 모양도 같이 바뀝니다.
 *
 * done      — 다 만들어진 그림. 아무것도 덮지 않는다.
 * developing— 아래쪽이 아직 안 현상된 그림 + 현상된 데까지를 긋는 수면선.
 * waiting   — 색이 조금 빠진 그림. 지금 아무 일도 일어나지 않고 있다는 뜻.
 * stopped   — 색이 다 빠진 그림 + 가로지르는 가는 붉은 선.
 */
type FrameShape = "done" | "developing" | "waiting" | "stopped";

export function frameShape(state: WorkflowState): FrameShape {
  switch (workflowStateTone(state)) {
    case "success": return "done";
    case "progress": return "developing";
    case "danger": return "stopped";
    default: return "waiting";
  }
}

/**
 * 프레임 위의 사진에 거는 필터. 상태를 **사진 자체**로 말하는 부분이라 목록을 멀리서 훑어도 읽힙니다.
 *
 * 🟠 색만으로 말하지 않는다는 §6 규칙은 그대로입니다 — 프레임 밑에 상태 글자가 늘 함께 있습니다. 필터는
 * 거들 뿐입니다.
 */
const SHAPE_FILTER: Record<FrameShape, string> = {
  done: "",
  developing: "",
  waiting: "[filter:saturate(0.5)]",
  stopped: "[filter:grayscale(1)_brightness(0.7)]",
};

const SHAPE_TEXT: Record<FrameShape, string> = {
  done: "text-emerald-300",
  developing: "text-amber-300",
  waiting: "text-slate-400",
  stopped: "text-rose-400",
};

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-4 w-4 flex-shrink-0">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/**
 * 한 프로젝트의 프레임 한 칸.
 *
 * 🔴 여기에는 **진행 막대가 없습니다.** 전에는 모든 줄에 막대가 붙었고, 끝난 프로젝트에도 100% 로 꽉 찬
 * 보라색 막대가 그려졌습니다 — 화면에서 제일 진한 색이 정보를 하나도 싣지 않은 자리에 쓰이고, 목록 전체가
 * 그 줄무늬로 덮였습니다. 진행 중인 것의 「어디까지 왔나」는 이제 **수면선의 높이**가 말합니다: 같은 숫자를
 * 쓰지만(`progressPercent`) 끝난 프레임에는 그릴 선이 없습니다.
 */
function ProjectFrame({ project, index, onOpen }: { project: ProjectSummary; index: number; onOpen: () => void }) {
  const shape = frameShape(project.workflowState);
  const percent = progressPercent(project.workflowState);
  // 아직 현상되지 않은 부분의 높이. 수면선은 정확히 그 경계에 놓인다.
  const undeveloped = 100 - percent;
  return (
    <button
        type="button"
        data-testid="project-frame"
        data-shape={shape}
        className={`group flex w-full flex-col gap-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 ${riseInCard}`}
        style={{ animationDelay: `${Math.min(index, 11) * 45}ms` }}
        onClick={onOpen}
      >
        <span className="relative block overflow-hidden rounded-xl border border-white/10 transition-colors group-hover:border-violet-400/50">
          {/*
            * 9:16 — 만드는 것과 같은 비율.
            *
            * 🔴 전에는 64px 정사각 썸네일이었습니다. 이 앱이 내놓는 건 전부 세로 릴인데 목록만 정사각이라,
            * 목록을 봐서는 결과물이 어떤 모양인지 알 수 없었습니다. 프레임을 결과물과 같은 비율로 두면
            * 목록 자체가 콘택트 시트가 됩니다 — 편집자가 실제로 소재를 보는 방식입니다.
            */}
          <CoverThumb bare src={sceneImageContentUrl(project.id, 1)} className={`aspect-[9/16] w-full ${SHAPE_FILTER[shape]}`} />

          {shape === "developing" && (
            <>
              <span
                aria-hidden="true"
                data-testid="project-frame-undeveloped"
                className="pointer-events-none absolute inset-x-0 bottom-0 bg-ground/85"
                style={{ height: `${undeveloped}%` }}
              />
              <span
                aria-hidden="true"
                data-testid="project-frame-waterline"
                className="waterline pointer-events-none absolute inset-x-0 h-px"
                style={{ bottom: `${undeveloped}%`, background: "linear-gradient(90deg, #f0abfc, #a78bfa 50%, #60a5fa)" }}
              />
            </>
          )}

          {shape === "stopped" && (
            <span
              aria-hidden="true"
              data-testid="project-frame-cut"
              className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-rose-400/70"
            />
          )}
        </span>

        <span className="block min-w-0 px-0.5">
          {/* The topic is what the user recognizes a project by; the generated id is the machine
              handle and belongs underneath it, not as the headline. */}
          <span className="block truncate text-sm font-semibold text-slate-100">{project.topic || project.id}</span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-slate-500">{project.id}</span>
          <span className="mt-1 flex items-baseline gap-2">
            {/* 🟠 상태는 프레임이 말하지만, 글자로도 반드시 한 번 말합니다 — 색만으로 상태를 말하지 않는다는 §6. */}
            <span className={`truncate text-xs font-semibold ${SHAPE_TEXT[shape]}`}>
              {workflowStateLabel(project.workflowState)}
            </span>
            <span className="ml-auto flex-shrink-0 text-[11px] tabular-nums text-slate-500" title={project.updatedAt}>
              {formatDateTime(project.updatedAt)}
            </span>
          </span>
        </span>
    </button>
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
        <h2 className="flex items-center gap-2.5 text-lg font-semibold text-slate-100">
          <span aria-hidden="true" className="h-4 w-1 flex-shrink-0 rounded-full bg-gradient-to-b from-violet-400 to-fuchsia-400" />
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
        <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 xl:grid-cols-4">
          {projects.map((project, index) => (
            <li key={project.id}>
              <ProjectFrame project={project} index={index} onOpen={() => onOpenProject(project.id)} />
            </li>
          ))}
        </ul>
      )}

      {state.projects !== null && (
        <p
          data-testid="dashboard-summary"
          className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/10 pt-3 text-xs text-slate-400"
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
