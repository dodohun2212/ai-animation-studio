import { useEffect, useState } from "react";
import type { LongProject } from "@ai-animation-studio/shared";

import { getLongProject, toLongProjectDisplayError } from "../api/longProjectsApi.js";

interface LongProjectDetailProps {
  projectId: string;
  onBack: () => void;
  onOpenSettings: (projectId: string) => void;
  onOpenOutline: (projectId: string) => void;
  onOpenStoryBible?: (projectId: string) => void;
}

type DetailState =
  | { status: "loading" }
  | { status: "error"; error: { code: string; message: string } }
  | { status: "success"; project: LongProject };

export function LongProjectDetail({ projectId, onBack, onOpenSettings, onOpenOutline, onOpenStoryBible }: LongProjectDetailProps) {
  const [state, setState] = useState<DetailState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getLongProject(projectId)
      .then((response) => {
        if (!cancelled) {
          setState({ status: "success", project: response.project });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setState({ status: "error", error: toLongProjectDisplayError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <section className="mt-8">
      <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300" onClick={onBack}>
        목록으로
      </button>
      {state.status === "loading" && <p className="mt-4 text-slate-400">불러오는 중...</p>}
      {state.status === "error" && (
        <p className="mt-4 text-sm text-rose-400" role="alert" data-error-code={state.error.code}>
          {state.error.message}
        </p>
      )}
      {state.status === "success" && (
        <>
          <button
            type="button"
            className="mt-4 rounded-full border border-violet-400/40 px-4 py-2 text-sm text-violet-300"
            onClick={() => onOpenSettings(projectId)}
          >
            장기 프로젝트 설정
          </button>
          <button
            type="button"
            className="ml-3 mt-4 rounded-full border border-violet-400/40 px-4 py-2 text-sm text-violet-300"
            onClick={() => onOpenOutline(projectId)}
          >
            아웃라인 확인
          </button>
          {onOpenStoryBible && <button
            type="button"
            className="ml-3 mt-4 rounded-full border border-violet-400/40 px-4 py-2 text-sm text-violet-300"
            onClick={() => onOpenStoryBible(projectId)}
          >
            Story Bible
          </button>}
          <dl className="mt-4 space-y-2 text-slate-100">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">ID</dt>
              <dd>{state.project.id}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">제목</dt>
              <dd>{state.project.title}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">로그라인</dt>
              <dd>{state.project.logline}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">아웃라인 상태</dt>
              <dd data-testid="outline-status">{state.project.outlineStatus}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Episode 수</dt>
              <dd>{state.project.episodeCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">생성 시각</dt>
              <dd>{state.project.createdAt}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">수정 시각</dt>
              <dd>{state.project.updatedAt}</dd>
            </div>
          </dl>
          <div data-testid="episode-list" className="mt-4 space-y-2">
            <h3 className="text-sm font-semibold text-slate-200">Episode 목록</h3>
            <ol className="space-y-1 text-sm text-slate-300">
              {state.project.episodes.map((episode) => (
                <li key={episode.episodeNumber} data-testid={`episode-${episode.episodeNumber}`} data-status={episode.status}>
                  {episode.episodeNumber}. {episode.title} —{" "}
                  <span className={episode.status === "outline_ready" ? "text-emerald-400" : "text-slate-400"}>{episode.status}</span>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}
