import { useEffect, useState } from "react";
import type { Project } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";

import { archiveProject, getProject, toDisplayError } from "../api/projectsApi.js";
import { projectTypeLabel, workflowStateLabel } from "../utils/workflowStateLabels.js";
import { ArchiveProjectDialog } from "./ArchiveProjectDialog.js";
import { Spinner } from "./Spinner.js";
import { WorkflowProgressBar } from "./WorkflowProgressBar.js";

interface ProjectDetailProps {
  projectId: string;
  onBack: () => void;
  onOpenMappingReview: (projectId: string) => void;
  onOpenSettings?: (projectId: string) => void;
  onOpenStoryPrompt?: (projectId: string) => void;
  onOpenImageGeneration?: (projectId: string) => void;
  onOpenVideoPreview?: (projectId: string) => void;
  onOpenVideoWorkflow?: (projectId: string, jobId: string) => void;
  onOpenVideoMerge?: (projectId: string) => void;
  onOpenGallery?: (projectId: string) => void;
  onArchived?: () => void;
}

type DetailState =
  | { status: "loading" }
  | { status: "error"; error: { code: string; message: string } }
  | { status: "success"; project: Project };

type ResumeTarget =
  | { screen: "storyPrompt"; label: string }
  | { screen: "mappingReview"; label: string }
  | { screen: "imageGeneration"; label: string }
  | { screen: "videoPreview"; label: string }
  | { screen: "videoWorkflow"; jobId: string; label: string }
  | { screen: "videoMerge"; label: string };

const secondaryButton =
  "rounded-full border border-violet-400/30 px-4 py-2 text-sm text-violet-300 hover:bg-violet-500/10";

/** Maps a project's current workflow state to the single screen that continues it, matching the fixed product flow. */
/** `label` is the complete button text — each case phrases its own lead-in, since "이어서 진행하기" only fits an in-progress state, not a finished one. */
function resumeTarget(project: Project): ResumeTarget | null {
  switch (project.workflowState) {
    case WorkflowState.Init:
    case WorkflowState.Ready:
    case WorkflowState.GeneratingStory:
      return { screen: "storyPrompt", label: "이어서 진행하기 · Story 프롬프트 확인" };
    case WorkflowState.WaitingForAssetMappingReview:
      return { screen: "mappingReview", label: "이어서 진행하기 · Asset Mapping 검토" };
    case WorkflowState.AssetMappingApproved:
    case WorkflowState.GeneratingImages:
    case WorkflowState.ImagesReady:
    case WorkflowState.ImagesReview:
      return { screen: "imageGeneration", label: "이어서 진행하기 · 장면 이미지 생성/검토" };
    case WorkflowState.WaitingForVideoConfirmation:
      return { screen: "videoPreview", label: "이어서 진행하기 · 영상 프롬프트 및 비용 확인" };
    case WorkflowState.GeneratingVideos:
    case WorkflowState.VideosReady:
    case WorkflowState.ReviewingVideos:
    case WorkflowState.Interrupted:
      return project.currentVideoJobId
        ? { screen: "videoWorkflow", jobId: project.currentVideoJobId, label: "이어서 진행하기 · 영상 생성/검토" }
        : { screen: "videoPreview", label: "이어서 진행하기 · 영상 프롬프트 및 비용 확인" };
    case WorkflowState.VideosApproved:
    case WorkflowState.Rendering:
      return { screen: "videoMerge", label: "이어서 진행하기 · 최종 영상 병합" };
    case WorkflowState.Completed:
      // Nothing left to do, but the finished result should still be reachable to watch again
      // or open in Explorer — VideoMergeScreen shows the existing video instead of re-merging.
      return { screen: "videoMerge", label: "최종 영상 결과 보기" };
    default:
      // Failed / Cancelled have no next step to resume into.
      return null;
  }
}

export function ProjectDetail({
  projectId,
  onBack,
  onOpenMappingReview,
  onOpenSettings = () => {},
  onOpenStoryPrompt = () => {},
  onOpenImageGeneration = () => {},
  onOpenVideoPreview = () => {},
  onOpenVideoWorkflow = () => {},
  onOpenVideoMerge = () => {},
  onOpenGallery = () => {},
  onArchived = () => {},
}: ProjectDetailProps) {
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [archiveOpen, setArchiveOpen] = useState(false);

  function resume(target: ResumeTarget): void {
    if (target.screen === "storyPrompt") onOpenStoryPrompt(projectId);
    else if (target.screen === "mappingReview") onOpenMappingReview(projectId);
    else if (target.screen === "imageGeneration") onOpenImageGeneration(projectId);
    else if (target.screen === "videoPreview") onOpenVideoPreview(projectId);
    else if (target.screen === "videoWorkflow") onOpenVideoWorkflow(projectId, target.jobId);
    else onOpenVideoMerge(projectId);
  }

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
    <section className="mt-8 max-w-4xl space-y-5">
      <button
        type="button"
        className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
        onClick={onBack}
      >
        목록으로
      </button>
      {state.status === "loading" && <Spinner label="불러오는 중..." className="mt-4" />}
      {state.status === "error" && (
        <p className="mt-4 text-sm text-rose-400" role="alert" data-error-code={state.error.code}>
          {state.error.message}
        </p>
      )}
      {state.status === "success" && (
        <>
          {resumeTarget(state.project) && (
            <button
              type="button"
              className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]"
              onClick={() => resume(resumeTarget(state.project)!)}
            >
              {resumeTarget(state.project)!.label}
            </button>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" className={secondaryButton} onClick={() => onOpenMappingReview(projectId)}>
              Asset Mapping 검토
            </button>
            <button type="button" className={secondaryButton} onClick={() => onOpenSettings(projectId)}>
              프로젝트 설정
            </button>
            <button type="button" className={secondaryButton} onClick={() => onOpenStoryPrompt(projectId)}>
              Story 프롬프트 확인
            </button>
            {state.project.workflowState === WorkflowState.AssetMappingApproved && (
              <button type="button" className={secondaryButton} onClick={() => onOpenImageGeneration(projectId)}>
                장면 이미지 생성
              </button>
            )}
            {state.project.workflowState === WorkflowState.WaitingForVideoConfirmation && (
              <button type="button" className={secondaryButton} onClick={() => onOpenVideoPreview(projectId)}>
                영상 프롬프트 및 비용 확인
              </button>
            )}
            <button type="button" className={secondaryButton} onClick={() => onOpenGallery(projectId)}>
              생성 이미지 모음
            </button>
            <button
              type="button"
              className="rounded-full border border-rose-400/30 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/10"
              onClick={() => setArchiveOpen(true)}
            >
              프로젝트 보관하기
            </button>
          </div>
          {archiveOpen && (
            <ArchiveProjectDialog
              confirmationText={state.project.topic}
              projectKind="short"
              onCancel={() => setArchiveOpen(false)}
              onConfirm={async (confirmation) => {
                await archiveProject(projectId, { confirmation });
                onArchived();
              }}
            />
          )}
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-slate-100 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">ID</dt>
              <dd className="mt-0.5">{state.project.id}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">주제</dt>
              <dd className="mt-0.5">{state.project.topic}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">프로젝트 유형</dt>
              <dd className="mt-0.5">{projectTypeLabel(state.project.projectType)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-400">진행 상태</dt>
              <dd className="mt-0.5">{workflowStateLabel(state.project.workflowState)}</dd>
              <WorkflowProgressBar state={state.project.workflowState} className="mt-2 max-w-xs" />
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">생성 시각</dt>
              <dd className="mt-0.5">{state.project.createdAt}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">수정 시각</dt>
              <dd className="mt-0.5">{state.project.updatedAt}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">경고</dt>
              <dd className="mt-0.5">{state.project.warnings.length}건</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">오류</dt>
              <dd className="mt-0.5">{state.project.errors.length}건</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
