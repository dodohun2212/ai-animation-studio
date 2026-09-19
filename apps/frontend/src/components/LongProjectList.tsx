import { useEffect, useState } from "react";
import type { LongEpisodeOutlineStatus, LongProjectSummary } from "@ai-animation-studio/shared";

import { listLongProjects, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { longEpisodeOutlineStatusLabel } from "../utils/longEpisodeLabels.js";
import { Spinner } from "./Spinner.js";
import { StatusChip, type StatusTone } from "./ui/StatusChip.js";
import { riseIn } from "./ui/surfaces.js";

/**
 * The outline's state, in the chip grammar of §2.1 — exhaustive, so a third outline status cannot be added
 * without someone deciding what it means here.
 *
 * This row used to paint the status violet (`bg-violet-500/15 text-violet-300`), which §2.1 reserves for
 * 「현재 위치·선택」. A project in a list is not the place you are; it is a thing with a state, and the two
 * must not share a color or the list stops being readable at a glance. The same pill also carried
 * `{episodeCount}화` inside it — a count is not a status, and putting it in the status chip made the chip
 * claim something it cannot mean. The count now sits beside the chip as plain meta text, next to the date.
 */
const OUTLINE_TONE: Record<LongEpisodeOutlineStatus, StatusTone> = {
  planned: "neutral",
  outline_ready: "success",
};

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
          <stop offset="0%" stopColor="#cba878" />
          <stop offset="100%" stopColor="#e8e2d6" />
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
    <section>
      {/*
        * 단기 목록과 **같은 머리글**입니다 — 숫자를 표본으로 세우고, 그 옆에 화면 이름.
        *
        * 🔴 여기만 앱 이름 배너를 이고 있으면, 사이드바에서 한 칸 옮겼을 뿐인데 **다른 앱에 온 것처럼**
        * 보입니다. 두 목록은 같은 종류의 화면이니 같은 머리글을 답니다.
        *
        * 🟠 다만 줄은 그대로 **줄**입니다. 단기 쪽처럼 9:16 프레임 시트로 바꾸지 않은 이유: 여기 한 줄은
        * 영상 하나가 아니라 **회차 여러 개**를 대표해서, 대표 그림 한 장이 같은 뜻을 갖는지부터 다릅니다.
        * 모양을 맞추려고 뜻이 다른 것을 같게 그리는 건 맞추는 게 아닙니다.
        */}
      <header className="flex items-end gap-5">
        <div className="flex items-baseline gap-4">
          <span data-testid="long-project-count" className="type-display text-[58px] leading-[0.82] text-bone">
            {state.projects?.length ?? 0}
          </span>
          <div className="flex flex-col gap-0.5 pb-0.5">
            <span aria-hidden="true" className="type-index text-bone-faint">Long works</span>
            <h1 className="text-[17px] font-medium tracking-[-0.01em] text-bone-dim">장기 프로젝트</h1>
          </div>
        </div>
        <button
          type="button"
          className="ml-auto flex items-center gap-1.5 rounded bg-bone px-4 py-2 text-[13px] font-semibold text-ground transition-colors hover:bg-[#cfc8bb]"
          onClick={onCreateNew}
        >
          <PlusIcon />
          새 장기 프로젝트
        </button>
      </header>
      <div className="mt-6 border-b border-line" />

      {state.projects === null && state.loading && <Spinner label="불러오는 중..." className="mt-4" />}

      {state.error && (
        <p className="mt-4 text-sm text-rose-400" role="alert" data-error-code={state.error.code}>
          {state.error.message}
        </p>
      )}

      {state.projects !== null && state.projects.length === 0 && (
        <p className="mt-6 text-bone-dim">아직 생성된 장기 프로젝트가 없습니다.</p>
      )}
      {state.projects !== null && state.projects.length > 0 && (
        <ul className="mt-6 space-y-3">
          {state.projects.map((project, index) => (
            <li key={project.id}>
              <button
                type="button"
                className={`flex w-full items-center gap-4 rounded-lg border border-line bg-ground-raised p-3 text-left text-bone transition-colors duration-150 hover:border-bone-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bone-faint ${riseIn}`}
                style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
                onClick={() => onOpenProject(project.id)}
              >
                <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-ground-edge">
                  <LongProjectThumbnail />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{project.title}</span>
                  <span className="block truncate text-sm text-bone-dim">{project.logline}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StatusChip tone={OUTLINE_TONE[project.outlineStatus]}>
                      {longEpisodeOutlineStatusLabel(project.outlineStatus)}
                    </StatusChip>
                    <span className="text-xs text-slate-400 tabular-nums">{project.episodeCount}화</span>
                    <span className="text-xs text-slate-400 tabular-nums" title={project.updatedAt}>{formatDateTime(project.updatedAt)}</span>
                  </span>
                </span>
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-ground-edge text-bone-dim">
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
