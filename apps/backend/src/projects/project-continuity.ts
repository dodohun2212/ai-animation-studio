import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { WorkflowState } from "@ai-animation-studio/shared";
import type { ShortProjectContinuityOption } from "@ai-animation-studio/shared";

import type { LocalProjectRepository } from "./projects.repository.js";
import type { StoredProject } from "./project-storage.schema.js";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const trimmedString = (value: unknown): string => typeof value === "string" ? value.trim() : "";

/** Mirrors Python's `short_scene_continuity_option` allowed states: images approved through final render. */
const CONTINUITY_ALLOWED_STATES: ReadonlySet<string> = new Set([
  WorkflowState.WaitingForVideoConfirmation,
  WorkflowState.GeneratingVideos,
  WorkflowState.VideosReady,
  WorkflowState.ReviewingVideos,
  WorkflowState.VideosApproved,
  WorkflowState.Rendering,
  WorkflowState.Completed,
]);

interface ContinuityCandidate extends ShortProjectContinuityOption {
  storyContext: string;
  imagePath: string;
}

/** Mirrors Python's `short_scene_continuity_option`: eligibility, path-safety and Scene 6 text derivation. */
async function deriveContinuityCandidate(repository: LocalProjectRepository, candidate: StoredProject): Promise<ContinuityCandidate | null> {
  if (!CONTINUITY_ALLOWED_STATES.has(candidate.workflow_state)) return null;
  if (candidate.generated_images.length < 6 || candidate.scenes.length < 6) return null;

  const imagePath = candidate.generated_images[5];
  if (typeof imagePath !== "string" || !imagePath) return null;
  const resolvedPath = path.resolve(imagePath);
  const projectDir = repository.projectDirectory(candidate.project_id);
  if (resolvedPath !== projectDir && !resolvedPath.startsWith(projectDir + path.sep)) return null;
  try {
    if (!(await fsPromises.stat(resolvedPath)).isFile()) return null;
  } catch {
    return null;
  }

  const scene = candidate.scenes[5];
  const sceneDescription = isObject(scene) ? trimmedString(scene.description) : "";
  const story = isObject(candidate.story) ? candidate.story : {};
  const ending = trimmedString(story.ending);
  const projectName = trimmedString(candidate.lore_context.project_name) || trimmedString(story.title) || candidate.topic;
  const storyContext = [
    `이전 프로젝트: ${projectName}`,
    `이전 영상 주제: ${candidate.topic}`,
    `마지막 장면: ${sceneDescription || "별도 설명 없음"}`,
    `이전 결말: ${ending || "별도 결말 설명 없음"}`,
    "위 마지막 상황과 자연스럽게 이어지는 첫 장면을 작성하십시오.",
  ].join("\n");
  return { projectId: candidate.project_id, projectName, label: `${projectName} · Scene 6`, storyContext, imagePath: resolvedPath };
}

/** Every other short project currently eligible to link as this project's Scene 1 continuity source. */
export async function listContinuityOptions(repository: LocalProjectRepository, currentProjectId: string): Promise<ShortProjectContinuityOption[]> {
  const all = await repository.list();
  const options: ShortProjectContinuityOption[] = [];
  for (const candidate of all) {
    if (candidate.project_id === currentProjectId) continue;
    const derived = await deriveContinuityCandidate(repository, candidate);
    if (derived) options.push({ projectId: derived.projectId, projectName: derived.projectName, label: derived.label });
  }
  return options;
}

/** Resolve one specific candidate by ID for the write path, so a save always re-derives instead of trusting the client. */
export async function resolveContinuityCandidate(repository: LocalProjectRepository, currentProjectId: string, sourceProjectId: string): Promise<ContinuityCandidate | null> {
  if (sourceProjectId === currentProjectId) return null;
  let candidate: StoredProject;
  try { candidate = await repository.findById(sourceProjectId); } catch { return null; }
  return deriveContinuityCandidate(repository, candidate);
}

/** Reads Python's `lore_context.previous_scene_link`, mirroring `user_selected_short_scene_link`'s opt-in check. */
export function toShortProjectContinuityLink(stored: StoredProject): ShortProjectContinuityOption | null {
  const link = stored.lore_context.previous_scene_link;
  if (!isObject(link) || link.source_kind !== "short_project" || link.user_selected !== true) return null;
  const projectId = trimmedString(link.project_id);
  const projectName = trimmedString(link.project_name);
  const label = trimmedString(link.label);
  if (!projectId || !projectName || !label) return null;
  return { projectId, projectName, label };
}

/** Reads the Story-prompt text for the linked continuity source, or an empty string when none is linked. */
export function previousSceneContext(stored: StoredProject): string {
  const link = stored.lore_context.previous_scene_link;
  if (!isObject(link) || link.source_kind !== "short_project" || link.user_selected !== true) return "";
  return trimmedString(link.story_context);
}

export function applyContinuityCandidate(stored: StoredProject, candidate: ContinuityCandidate | null, updatedAt: string): StoredProject {
  return {
    ...stored,
    updated_at: updatedAt,
    lore_context: {
      ...stored.lore_context,
      previous_scene_link: candidate ? {
        source_kind: "short_project",
        user_selected: true,
        project_id: candidate.projectId,
        project_name: candidate.projectName,
        label: candidate.label,
        scene_number: 6,
        story_context: candidate.storyContext,
        image_path: candidate.imagePath,
      } : {},
    },
  };
}
