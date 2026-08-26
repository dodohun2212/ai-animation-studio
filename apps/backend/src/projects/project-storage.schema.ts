import { MAX_SCENE_COUNT, WorkflowState } from "@ai-animation-studio/shared";

import { dataInvalid } from "./project-api.error.js";

/**
 * Local `project.json` storage shape, snake_case to match the Python
 * `ProjectContext` dataclass. Fields not used by this feature (character
 * profile, story, image/video pipeline records, etc.) are preserved so an
 * existing Python project can still be read without data loss, but their
 * internal structure is only checked for the JSON type Python's dataclass
 * defaults use, not deeply validated.
 */
export interface StoredProject {
  project_id: string;
  topic: string;
  workflow_state: string;
  created_at: string;
  updated_at: string;
  character_profile: Record<string, unknown>;
  lore_context: Record<string, unknown>;
  style_profile: Record<string, unknown>;
  references: unknown[];
  story: Record<string, unknown>;
  scenes: unknown[];
  image_prompts: string[];
  motion_prompts: string[];
  generated_images: string[];
  image_generation_records: unknown[];
  generated_image_reviews: unknown[];
  face_consistency_results: unknown[];
  generated_video_paths: string[];
  video_generation_records: unknown[];
  video_reviews: unknown[];
  capcut_clip_paths: string[];
  /** One entry per scene, index-aligned like generated_images — but unlike images, a scene with no narration text is skipped rather than generated, so its slot holds null instead of a path. */
  generated_narrations: (string | null)[];
  narration_generation_records: unknown[];
  final_video_path: string | null;
  used_audio: StoredUsedAudio | null;
  api_usage: unknown[];
  warnings: string[];
  errors: string[];
  project_type: string;
  script_revision: number;
  mapping_revision: number;
}

/** What the most recently completed merge actually used — see ProjectSummary.usedAudio's own doc comment for why attribution is copied by value here rather than kept as a live reference to the track. */
export interface StoredUsedAudio {
  mode: "narration" | "narration+bgm" | "silent";
  track_id?: string;
  attribution_required?: boolean;
  attribution_text?: string;
}

export const KNOWN_STORED_PROJECT_FIELDS: ReadonlySet<string> = new Set([
  "project_id",
  "topic",
  "workflow_state",
  "created_at",
  "updated_at",
  "character_profile",
  "lore_context",
  "style_profile",
  "references",
  "story",
  "scenes",
  "image_prompts",
  "motion_prompts",
  "generated_images",
  "image_generation_records",
  "generated_image_reviews",
  "face_consistency_results",
  "generated_video_paths",
  "video_generation_records",
  "video_reviews",
  "capcut_clip_paths",
  "generated_narrations",
  "narration_generation_records",
  "final_video_path",
  "used_audio",
  "api_usage",
  "warnings",
  "errors",
  "project_type",
  "script_revision",
  "mapping_revision",
]);

const WORKFLOW_STATE_VALUES: ReadonlySet<string> = new Set(Object.values(WorkflowState));

// Accepts both Python's `datetime.isoformat()` UTC suffix ("+00:00") and
// JavaScript's `Date.toISOString()` suffix ("Z") so files written by either
// implementation round-trip.
const UTC_ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/;

export function isUtcIsoTimestamp(value: string): boolean {
  return UTC_ISO_TIMESTAMP_PATTERN.test(value);
}

function requireObjectRoot(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw dataInvalid("Stored project root must be a JSON object.");
  }
  return raw as Record<string, unknown>;
}

function stringField(data: Record<string, unknown>, key: string): string {
  if (!(key in data)) {
    throw dataInvalid(`Missing required field: ${key}`);
  }
  const value = data[key];
  if (typeof value !== "string") {
    throw dataInvalid(`Field "${key}" must be a string.`);
  }
  if (value.trim().length === 0) {
    throw dataInvalid(`Field "${key}" must not be empty.`);
  }
  return value;
}

function stringArrayField(data: Record<string, unknown>, key: string, fallback: string[]): string[] {
  if (!(key in data)) {
    return fallback;
  }
  const value = data[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw dataInvalid(`Field "${key}" must be an array of strings.`);
  }
  return value;
}

function anyArrayField(data: Record<string, unknown>, key: string, fallback: unknown[]): unknown[] {
  if (!(key in data)) {
    return fallback;
  }
  const value = data[key];
  if (!Array.isArray(value)) {
    throw dataInvalid(`Field "${key}" must be an array.`);
  }
  return value;
}

function nullableStringArrayField(data: Record<string, unknown>, key: string, fallback: (string | null)[]): (string | null)[] {
  if (!(key in data)) {
    return fallback;
  }
  const value = data[key];
  if (!Array.isArray(value) || !value.every((item) => item === null || typeof item === "string")) {
    throw dataInvalid(`Field "${key}" must be an array of strings or null.`);
  }
  return value;
}

function objectField(
  data: Record<string, unknown>,
  key: string,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  if (!(key in data)) {
    return fallback;
  }
  const value = data[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw dataInvalid(`Field "${key}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function timestampField(data: Record<string, unknown>, key: string): string {
  if (!(key in data)) {
    // Mirrors ProjectContext's `default_factory=lambda: datetime.now(timezone.utc).isoformat()`.
    return new Date().toISOString();
  }
  const value = data[key];
  if (typeof value !== "string" || !isUtcIsoTimestamp(value)) {
    throw dataInvalid(`Field "${key}" must be a UTC ISO 8601 timestamp string.`);
  }
  return value;
}

function integerField(data: Record<string, unknown>, key: string, fallback: number): number {
  if (!(key in data)) {
    return fallback;
  }
  const value = data[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw dataInvalid(`Field "${key}" must be an integer.`);
  }
  return value;
}

function finalVideoPathField(data: Record<string, unknown>): string | null {
  const key = "final_video_path";
  if (!(key in data)) {
    return null;
  }
  const value = data[key];
  if (value !== null && typeof value !== "string") {
    throw dataInvalid(`Field "${key}" must be a string or null.`);
  }
  return value;
}

const USED_AUDIO_MODES: ReadonlySet<string> = new Set(["narration", "narration+bgm", "silent"]);

function usedAudioField(data: Record<string, unknown>): StoredUsedAudio | null {
  const key = "used_audio";
  if (!(key in data) || data[key] === null) {
    return null;
  }
  const value = data[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw dataInvalid(`Field "${key}" must be an object or null.`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.mode !== "string" || !USED_AUDIO_MODES.has(record.mode)) {
    throw dataInvalid(`Field "${key}.mode" must be narration, narration+bgm, or silent.`);
  }
  if (record.track_id !== undefined && typeof record.track_id !== "string") {
    throw dataInvalid(`Field "${key}.track_id" must be a string.`);
  }
  if (record.attribution_required !== undefined && typeof record.attribution_required !== "boolean") {
    throw dataInvalid(`Field "${key}.attribution_required" must be a boolean.`);
  }
  if (record.attribution_text !== undefined && typeof record.attribution_text !== "string") {
    throw dataInvalid(`Field "${key}.attribution_text" must be a string.`);
  }
  return {
    mode: record.mode as StoredUsedAudio["mode"],
    ...(record.track_id !== undefined ? { track_id: record.track_id as string } : {}),
    ...(record.attribution_required !== undefined ? { attribution_required: record.attribution_required as boolean } : {}),
    ...(record.attribution_text !== undefined ? { attribution_text: record.attribution_text as string } : {}),
  };
}

// Bounded by MAX_SCENE_COUNT (not a fixed six): these arrays hold one entry per scene, and a
// project's scene count is variable (2-12, see MAX_SCENE_COUNT), so the bound must track it too.
function requireAtMostMaxScenes(field: string, values: readonly unknown[]): void {
  if (values.length > MAX_SCENE_COUNT) {
    throw dataInvalid(`${field} cannot contain over ${MAX_SCENE_COUNT} items`);
  }
}

/**
 * Parse and validate a snake_case `project.json` payload, applying the same
 * legacy compatibility ProjectContext.from_dict() applies on read:
 * WAITING_FOR_CAPCUT / CAPCUT_CLIPS_READY state remap and backfilling
 * generated_video_paths from capcut_clip_paths when it is otherwise empty.
 */
export function parseStoredProject(raw: unknown): StoredProject {
  const root = requireObjectRoot(raw);
  const data: Record<string, unknown> = { ...root };

  if (data.workflow_state === "WAITING_FOR_CAPCUT") {
    data.workflow_state = WorkflowState.WaitingForVideoConfirmation;
  } else if (data.workflow_state === "CAPCUT_CLIPS_READY") {
    data.workflow_state = WorkflowState.VideosReady;
  }
  const legacyClips = data.capcut_clip_paths;
  const hasVideoPaths = Array.isArray(data.generated_video_paths) && data.generated_video_paths.length > 0;
  if (Array.isArray(legacyClips) && legacyClips.length > 0 && !hasVideoPaths) {
    data.generated_video_paths = [...legacyClips];
  }

  const unknownKeys = Object.keys(root).filter((key) => !KNOWN_STORED_PROJECT_FIELDS.has(key));
  if (unknownKeys.length > 0) {
    throw dataInvalid(`Unknown project fields: ${unknownKeys.sort().join(", ")}`);
  }

  const projectType = "project_type" in data ? data.project_type : "short_project";
  if (projectType !== "short_project") {
    throw dataInvalid(`Unsupported project_type: ${String(projectType)}`);
  }

  const workflowState = "workflow_state" in data ? data.workflow_state : WorkflowState.Init;
  if (typeof workflowState !== "string" || !WORKFLOW_STATE_VALUES.has(workflowState)) {
    throw dataInvalid(`Unknown workflow_state: ${String(workflowState)}`);
  }

  const imagePrompts = stringArrayField(data, "image_prompts", []);
  const motionPrompts = stringArrayField(data, "motion_prompts", []);
  const generatedImages = stringArrayField(data, "generated_images", []);
  const generatedVideoPaths = stringArrayField(data, "generated_video_paths", []);
  const capcutClipPaths = stringArrayField(data, "capcut_clip_paths", []);
  const generatedNarrations = nullableStringArrayField(data, "generated_narrations", []);
  requireAtMostMaxScenes("image_prompts", imagePrompts);
  requireAtMostMaxScenes("motion_prompts", motionPrompts);
  requireAtMostMaxScenes("generated_images", generatedImages);
  requireAtMostMaxScenes("generated_video_paths", generatedVideoPaths);
  requireAtMostMaxScenes("capcut_clip_paths", capcutClipPaths);
  requireAtMostMaxScenes("generated_narrations", generatedNarrations);

  return {
    project_id: stringField(data, "project_id"),
    topic: stringField(data, "topic"),
    workflow_state: workflowState,
    created_at: timestampField(data, "created_at"),
    updated_at: timestampField(data, "updated_at"),
    character_profile: objectField(data, "character_profile", {}),
    lore_context: objectField(data, "lore_context", {}),
    style_profile: objectField(data, "style_profile", {}),
    references: anyArrayField(data, "references", []),
    story: objectField(data, "story", {}),
    scenes: anyArrayField(data, "scenes", []),
    image_prompts: imagePrompts,
    motion_prompts: motionPrompts,
    generated_images: generatedImages,
    image_generation_records: anyArrayField(data, "image_generation_records", []),
    generated_image_reviews: anyArrayField(data, "generated_image_reviews", []),
    face_consistency_results: anyArrayField(data, "face_consistency_results", []),
    generated_video_paths: generatedVideoPaths,
    video_generation_records: anyArrayField(data, "video_generation_records", []),
    video_reviews: anyArrayField(data, "video_reviews", []),
    capcut_clip_paths: capcutClipPaths,
    generated_narrations: generatedNarrations,
    narration_generation_records: anyArrayField(data, "narration_generation_records", []),
    final_video_path: finalVideoPathField(data),
    used_audio: usedAudioField(data),
    api_usage: anyArrayField(data, "api_usage", []),
    warnings: stringArrayField(data, "warnings", []),
    errors: stringArrayField(data, "errors", []),
    project_type: projectType,
    script_revision: integerField(data, "script_revision", 0),
    mapping_revision: integerField(data, "mapping_revision", 0),
  };
}
