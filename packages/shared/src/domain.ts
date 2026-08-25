import type { WorkflowState } from "./workflow.js";

/**
 * Deliberately a plain `number` rather than a fixed literal union: a scene number is bounded by a project's own
 * scene count (2-12, see MIN/MAX below), not a single fixed set.
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

/**
 * Runway Gen-4 Turbo's API `prompt` field maxLength (confirmed against docs.aimlapi.com's schema, the same source
 * already cited for {@link RUNWAY_CLIP_DURATIONS}). Measured in UTF-16 code units, matching JavaScript's native
 * `.length` and Runway's own counting. When a rendered video prompt would exceed this, the caller drops optional
 * sections in priority order rather than truncating mid-sentence.
 */
export const RUNWAY_PROMPT_MAX_LENGTH = 1_000;

/**
 * Conservative local per-request cost estimates, used both for the local budget ledgers' preflight/record
 * accounting (apps/backend/src/providers/{openai,runway}-budget.ts) and for any UI that needs to display or
 * compute an estimate — e.g. the in-app workflow guide, or a video job's own stored estimated_cost_usd. Backend
 * and frontend must never each hold their own copy of these (see Round 22's RUNWAY_PROMPT_MAX_LENGTH consolidation
 * for the same reasoning) — a rate change updates every consumer via this single source.
 */
export const STORY_ESTIMATED_COST_USD = 0.05;
export const IMAGE_ESTIMATED_COST_USD = 0.10;
export const VIDEO_SCENE_ESTIMATED_COST_USD = 0.25;
/** Provisional — one narration TTS call per scene (matching Image/Video's per-scene pattern, since each scene has distinct narration text). Will be firmed up against real OpenAI TTS pricing when narration generation (Phase 4) is implemented; only used today by the workflow guide's call-count/cost projection while narrationEnabled is on. */
export const TTS_ESTIMATED_COST_USD = 0.05;

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
  /** Short-project-only narration/subtitle sentence. Optional: absent on scenes stored before this field existed, and always absent for long-form Episodes (narration is out of that scope). Present regardless of ShortProjectSettings.narrationEnabled — only actually turned into TTS audio when that flag is on. */
  narration?: string;
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
