import type { WorkflowState } from "./workflow.js";

export const SCENE_NUMBERS = [1, 2, 3, 4, 5, 6] as const;
export type SceneNumber = (typeof SCENE_NUMBERS)[number];

/**
 * A short project's scene count is being generalized away from a fixed 6 (see docs/02_MIGRATION_PLAN.md) so it can
 * match whichever video AI provider is connected — different providers support different per-clip durations, so
 * the total video length is scene count times the connected provider's clip length. These bounds are a sanity
 * range, not tied to any one provider.
 */
export const MIN_SCENE_COUNT = 2;
export const MAX_SCENE_COUNT = 12;
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

export function isSceneNumber(value: number): value is SceneNumber {
  return SCENE_NUMBERS.includes(value as SceneNumber);
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
