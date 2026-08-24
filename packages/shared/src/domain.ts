import type { WorkflowState } from "./workflow.js";

/** Kept at exactly six — still used by the not-yet-migrated screens/helpers below that assume a fixed 6-scene grid. */
export const SCENE_NUMBERS = [1, 2, 3, 4, 5, 6] as const;
/**
 * Deliberately widened to plain `number` rather than derived from SCENE_NUMBERS: a scene number is now bounded by
 * a project's own scene count (2-12, see MIN/MAX below), not a single fixed set. Nothing in this codebase does
 * exhaustive matching over the old 1-6 literal union, so this widening is backward compatible.
 */
export type SceneNumber = number;

/**
 * A short project's scene count is being generalized away from a fixed 6 (see docs/02_MIGRATION_PLAN.md) so it can
 * match whichever video AI provider is connected — different providers support different per-clip durations, so
 * the total video length is scene count times the connected provider's clip length. These bounds are a sanity
 * range, not tied to any one provider.
 */
export const MIN_SCENE_COUNT = 2;
export const MAX_SCENE_COUNT = 12;

/** The canonical 1..count scene number sequence for a project with this many scenes. */
export function sceneNumbersFor(sceneCount: number): SceneNumber[] {
  return Array.from({ length: sceneCount }, (_, index) => index + 1);
}

/**
 * Clip durations Runway Gen-4 Turbo's API accepts (`enum: [5, 10]`, confirmed against docs.aimlapi.com and
 * help.runwayml.com) — there is no bin-packing or mixed-duration support, a project picks one of these directly
 * and its total video length is sceneCount * that duration. Runway is the only supported video Provider today,
 * so this list is not yet keyed by provider; when a second one is added, this becomes a per-provider capability.
 */
export const RUNWAY_CLIP_DURATIONS = [5, 10] as const;
export type RunwayClipDurationSeconds = (typeof RUNWAY_CLIP_DURATIONS)[number];
export type ProjectType = "short_project" | "long_story_project";
export type ReviewDecision = "pending" | "approved" | "rejected";
export type JobStatus =
  | "created"
  | "running"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "cancelled";

export interface Scene {
  number: SceneNumber;
  script: string;
  imagePrompt: string;
  motionPrompt: string;
  generatedImagePath?: string;
  generatedVideoPath?: string;
  imageReview: ReviewDecision;
  videoReview: ReviewDecision;
}

export interface ProjectSummary {
  id: string;
  topic: string;
  projectType: ProjectType;
  workflowState: WorkflowState;
  createdAt: string;
  updatedAt: string;
}

export interface Project extends ProjectSummary {
  scenes: Scene[];
  finalVideoPath?: string;
  /** The most recently submitted local fake video job's ID, when one exists — lets a dashboard resume directly into its progress screen. */
  currentVideoJobId?: string;
  warnings: string[];
  errors: string[];
}

export interface ApiUsageRecord {
  timestamp: string;
  projectId: string;
  provider: "openai" | "runway";
  operation: "story" | "image" | "video";
  estimatedCostUsd: number;
  actualCostUsd: number;
  succeeded: boolean;
}

export interface ProviderTaskRecord {
  projectId: string;
  sceneNumber: SceneNumber;
  taskId: string;
  inputHash: string;
  userRequestId: string;
  status: JobStatus;
  estimatedCostUsd: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

/** Whether `value` is a plausible scene number for *some* project (2-12 scenes) — not tied to any one project's actual scene count. */
export function isSceneNumber(value: number): value is SceneNumber {
  return Number.isInteger(value) && value >= 1 && value <= MAX_SCENE_COUNT;
}

export function assertExactlySixScenes(scenes: readonly Scene[]): void {
  if (scenes.length !== SCENE_NUMBERS.length) {
    throw new Error("The workflow requires exactly six scenes.");
  }

  scenes.forEach((scene, index) => {
    if (scene.number !== SCENE_NUMBERS[index]) {
      throw new Error("Scenes must be uniquely ordered from 1 through 6.");
    }
  });
}
