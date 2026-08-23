import { WorkflowState, type Project, type ProjectSummary, type ProjectType, type Scene } from "@ai-animation-studio/shared";

import { LEGACY_VIDEO_JOB_ID } from "../videos/legacy-job.js";

import type { StoredProject } from "./project-storage.schema.js";

/**
 * Build a brand-new stored project with every Python `ProjectContext`
 * dataclass field at its documented default, so a project.json written here
 * loads cleanly through Python's `ProjectContext.from_dict()` too.
 *
 * Python's project-creation flow (ui.py draft_context / generation_service)
 * transitions a fresh context from INIT to READY as soon as a topic is set,
 * so the stored project starts at READY, not INIT.
 */
export function createStoredProject(projectId: string, topic: string, timestamp: string): StoredProject {
  return {
    project_id: projectId,
    topic,
    workflow_state: WorkflowState.Ready,
    created_at: timestamp,
    updated_at: timestamp,
    character_profile: {},
    lore_context: {},
    style_profile: {},
    references: [],
    story: {},
    scenes: [],
    image_prompts: [],
    motion_prompts: [],
    generated_images: [],
    image_generation_records: [],
    generated_image_reviews: [],
    face_consistency_results: [],
    generated_video_paths: [],
    video_generation_records: [],
    video_reviews: [],
    capcut_clip_paths: [],
    final_video_path: null,
    api_usage: [],
    warnings: [],
    errors: [],
    project_type: "short_project",
    script_revision: 0,
    mapping_revision: 0,
  };
}

export function toApiSummary(stored: StoredProject): ProjectSummary {
  return {
    id: stored.project_id,
    topic: stored.topic,
    projectType: stored.project_type as ProjectType,
    workflowState: stored.workflow_state as WorkflowState,
    createdAt: stored.created_at,
    updatedAt: stored.updated_at,
  };
}

/** The most recently appended video generation record's job_id, if any — records are always appended in submission order. */
function latestVideoJobId(records: unknown[]): string | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record && typeof record === "object" && !Array.isArray(record) && typeof (record as Record<string, unknown>).job_id === "string") {
      return (record as Record<string, unknown>).job_id as string;
    }
  }
  // Legacy Python records never had a job_id, so none of them matched above.
  // Adopt them under the synthetic legacy jobId instead of leaving this
  // project's video review permanently unreachable through the job-scoped API —
  // but only once at least one entry actually looks like a scene record, so
  // unrelated malformed data never fabricates a job that was never generated.
  const looksLikeVideoRecord = (value: unknown): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const scene = (value as Record<string, unknown>).scene_number;
    return typeof scene === "number" && Number.isInteger(scene) && scene >= 1 && scene <= 6;
  };
  return records.some(looksLikeVideoRecord) ? LEGACY_VIDEO_JOB_ID : undefined;
}

export function toApiProject(stored: StoredProject): Project {
  const jobId = latestVideoJobId(stored.video_generation_records);
  return {
    ...toApiSummary(stored),
    // Story/scene generation is out of this feature's scope: a freshly
    // created project always has an empty array here, and legacy Python
    // scene dicts use a different shape that the Story feature will
    // validate and map when it is implemented.
    scenes: stored.scenes as unknown as Scene[],
    ...(stored.final_video_path !== null ? { finalVideoPath: stored.final_video_path } : {}),
    ...(jobId !== undefined ? { currentVideoJobId: jobId } : {}),
    warnings: [...stored.warnings],
    errors: [...stored.errors],
  };
}
