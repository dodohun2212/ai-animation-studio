import { useEffect, useState } from "react";
import type { Project } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";

import { archiveProject, getProject, getProjectSettings, toDisplayError } from "../api/projectsApi.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { projectTypeLabel, workflowStateLabel } from "../utils/workflowStateLabels.js";
import { ArchiveProjectDialog } from "./ArchiveProjectDialog.js";
import { Spinner } from "./Spinner.js";
import { WorkflowProgressBar } from "./WorkflowProgressBar.js";
import { StatusChip, type StatusTone } from "./ui/StatusChip.js";

/** Workflow state → status chip tone, per design system §3.4's documented mapping. */
function workflowTone(state: WorkflowState): StatusTone {
  if (state === WorkflowState.Completed) return "success";
  if (state === WorkflowState.Failed || state === WorkflowState.Cancelled) return "danger";
  if (state === WorkflowState.Interrupted) return "progress";
  if (state === WorkflowState.GeneratingStory || state === WorkflowState.GeneratingImages
    || state === WorkflowState.GeneratingVideos || state === WorkflowState.Rendering) return "progress";
  return "neutral";
}

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
  onOpenNarrationReview?: (projectId: string) => void;
  onOpenSceneEdit?: (projectId: string) => void;
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
      return { screen: "storyPrompt", label: "이어서 진행하기 · 대본 지시문 확인" };
    case WorkflowState.WaitingForAssetMappingReview:
      return { screen: "mappingReview", label: "이어서 진행하기 · 참고 이미지 연결 검토" };
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
  onOpenNarrationReview = () => {},
  onOpenSceneEdit = () => {},
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

  /**
   * Whether this project uses its narration sentences for anything. Both off means the sentences are stored
   * but never spoken and never burned in, so a link to review them is an invitation to nothing — the long
   * project's timeline already hides its narration link on exactly this rule.
   *
   * These two flags live in the settings resource, not on the project, so this is a second request. It fails
   * soft on purpose: if settings cannot be read the link falls back to its old condition (the script has
   * narration text at all) rather than disappearing on a project that does use it.
   */
  const [narrationInUse, setNarrationInUse] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNarrationInUse(null);
    getProjectSettings(projectId)
      .then((response) => {
        if (!cancelled) setNarrationInUse(response.settings.narrationEnabled || response.settings.subtitlesEnabled);
      })
      .catch(() => { if (!cancelled) setNarrationInUse(null); });
    return () => { cancelled = true; };
  }, [projectId]);

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
          {/* §4.1: every screen leads with its own title. The project's topic is what identifies it —
              previously the screen opened straight into a row of buttons with no heading at all. */}
          <header className="space-y-2">
            <h1 className="text-2xl font-semibold text-slate-100">{state.project.topic || state.project.id}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone={workflowTone(state.project.workflowState)}>
                {workflowStateLabel(state.project.workflowState)}
              </StatusChip>
              <span className="text-xs text-slate-400">{projectTypeLabel(state.project.projectType)}</span>
            </div>
            <WorkflowProgressBar state={state.project.workflowState} className="max-w-md" />
          </header>
          {resumeTarget(state.project) && (
            <button
              type="button"
              className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]"
              onClick={() => resume(resumeTarget(state.project)!)}
            >
              {resumeTarget(state.project)!.label}
            </button>
          )}
          {/* This row used to mix pipeline steps with side tools, so the same step appeared three times on one
              screen: in the progress bar, in the resume button, and here. The bar owns the ordered steps and is
              always on screen for this project; the resume button owns the next one. What is left here is only
              what is NOT a step — hence the heading, which says so. */}
          <p className="text-xs text-slate-500">순서와 상관없이 언제든 볼 수 있는 것</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={secondaryButton} onClick={() => onOpenSettings(projectId)}>
              프로젝트 설정
            </button>
            {state.project.scenes.length > 0 && (
              <button
                type="button"
                data-testid="open-scene-edit"
                className={secondaryButton}
                onClick={() => onOpenSceneEdit(projectId)}
              >
                장면 편집
              </button>
            )}
            {narrationInUse !== false && state.project.scenes.some((scene) => typeof scene.narration === "string" && scene.narration.trim()) && (
              <button
                type="button"
                data-testid="open-narration-review"
                className={secondaryButton}
                onClick={() => onOpenNarrationReview(projectId)}
              >
                내레이션 확인
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
          {/* Warnings and errors were previously shown as bare counts ("2건"), with the actual messages
              unreachable anywhere in the UI. A count the user cannot act on is not information. */}
          {state.project.errors.length > 0 && (
            <section
              aria-label="프로젝트 오류"
              data-testid="project-errors"
              className="space-y-2 rounded-xl border border-rose-400/30 bg-rose-500/15 p-4"
            >
              <h2 className="text-sm font-semibold text-rose-300">오류 {state.project.errors.length}건</h2>
              <ul className="space-y-1 text-sm text-rose-300">
                {state.project.errors.map((message, index) => (
                  <li key={`${index}-${message}`}>{message}</li>
                ))}
              </ul>
            </section>
          )}
          {state.project.warnings.length > 0 && (
            <section
              aria-label="프로젝트 경고"
              data-testid="project-warnings"
              className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-500/10 p-4"
            >
              <h2 className="text-sm font-semibold text-amber-300">경고 {state.project.warnings.length}건</h2>
              <ul className="space-y-1 text-sm text-amber-300">
                {state.project.warnings.map((message, index) => (
                  <li key={`${index}-${message}`}>{message}</li>
                ))}
              </ul>
            </section>
          )}
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-400">ID</dt>
              <dd className="mt-0.5 text-sm text-slate-300">{state.project.id}</dd>
            </div>
            {/* Topic, project type and workflow state are the screen heading and its chips above; this list
                carries only what the heading does not — repeating them showed the same value twice. */}
            <div>
              <dt className="text-xs text-slate-400">만든 시각</dt>
              <dd className="mt-0.5 text-sm text-slate-300 tabular-nums" title={state.project.createdAt}>
                {formatDateTime(state.project.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">마지막 수정</dt>
              <dd className="mt-0.5 text-sm text-slate-300 tabular-nums" title={state.project.updatedAt}>
                {formatDateTime(state.project.updatedAt)}
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
