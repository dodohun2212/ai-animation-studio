import { useEffect, useState } from "react";
import type { Project } from "@ai-animation-studio/shared";

import { getProject, toDisplayError } from "../api/projectsApi.js";

interface ProjectDetailProps {
  projectId: string;
  onBack: () => void;
  onOpenMappingReview: (projectId: string) => void;
  onOpenSettings?: (projectId: string) => void;
}

type DetailState =
  | { status: "loading" }
  | { status: "error"; error: { code: string; message: string } }
  | { status: "success"; project: Project };

export function ProjectDetail({ projectId, onBack, onOpenMappingReview, onOpenSettings = () => {} }: ProjectDetailProps) {
  const [state, setState] = useState<DetailState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getProject(projectId)
      .then((response) => {
        if (!cancelled) {
          setState({ status: "success", project: response.project });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setState({ status: "error", error: toDisplayError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <section className="mt-8">
      <button
        type="button"
        className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300"
        onClick={onBack}
      >
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
          onClick={() => onOpenMappingReview(projectId)}
        >
          Asset Mapping 검토
        </button>
        <button
          type="button"
          className="ml-3 mt-4 rounded-full border border-violet-400/40 px-4 py-2 text-sm text-violet-300"
          onClick={() => onOpenSettings(projectId)}
        >
          프로젝트 설정
        </button>
        <dl className="mt-4 space-y-2 text-slate-100">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">ID</dt>
            <dd>{state.project.id}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">주제</dt>
            <dd>{state.project.topic}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">프로젝트 유형</dt>
            <dd>{state.project.projectType}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">진행 상태</dt>
            <dd>{state.project.workflowState}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">생성 시각</dt>
            <dd>{state.project.createdAt}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">수정 시각</dt>
            <dd>{state.project.updatedAt}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">경고</dt>
            <dd>{state.project.warnings.length}건</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">오류</dt>
            <dd>{state.project.errors.length}건</dd>
          </div>
        </dl>
        </>
      )}
    </section>
  );
}
