import { DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT, isPhotoCardSubtitleLayout, WorkflowState, type PhotoCardSubtitleLayout, type Project, type ProjectSummary, type ProjectType, type Scene } from "@ai-animation-studio/shared";

import { LEGACY_VIDEO_JOB_ID } from "../videos/legacy-job.js";

import { shortProjectAspectRatio } from "./project-aspect.js";
import type { StoredProject } from "./project-storage.schema.js";
import { withoutStaleRecoveryWarnings } from "./orphaned-generation-recovery.service.js";

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
    generated_narrations: [],
    narration_generation_records: [],
    final_video_path: null,
    used_audio: null,
    instagram_post: null,
    previous_instagram_posts: [],
    api_usage: [],
    warnings: [],
    errors: [],
    project_type: "short_project",
    script_revision: 0,
    mapping_revision: 0,
  };
}

/** See project-aspect.ts for why this is one shared function rather than the per-file copy it used to be. */
const aspectRatioFor = shortProjectAspectRatio;

/** Whether real narration audio exists today, not merely whether the setting is on — see ProjectSummary.narrationAvailable's doc comment. */
function narrationAvailableFor(stored: StoredProject): boolean {
  return stored.generated_narrations.some((file) => typeof file === "string" && file.length > 0);
}

/** Snake_case-to-camelCase passthrough of the stored value — see ProjectSummary.usedAudio's own doc comment for what this represents and why it's a value copy. */
function usedAudioFor(stored: StoredProject): ProjectSummary["usedAudio"] {
  if (!stored.used_audio) return undefined;
  const { mode, track_id, attribution_required, attribution_text } = stored.used_audio;
  return {
    mode,
    ...(track_id !== undefined ? { trackId: track_id } : {}),
    ...(attribution_required !== undefined ? { attributionRequired: attribution_required } : {}),
    ...(attribution_text !== undefined ? { attributionText: attribution_text } : {}),
  };
}

/**
 * Whether this project is a photo card — one chosen picture and one line of text.
 *
 * Kept in `lore_context` beside `narration_enabled`, which is where this project's own flags already live, so
 * the strict stored-key list does not have to learn a new field. Absent means an ordinary project, and the API
 * field is omitted rather than sent as false: a reader that has never heard of photo cards behaves exactly as
 * it did.
 */
export function photoCardFor(stored: StoredProject): boolean {
  return stored.lore_context.photo_card === true;
}

/**
 * The subtitle layout this card is using: what its last merge stored, filled in with the defaults for anything
 * it has never set.
 *
 * Always answers with both numbers so no caller has to know which of them a given card happens to have written
 * — an older card has neither, and it is not a different kind of card for that.
 */
export function storedSubtitleLayout(stored: StoredProject): PhotoCardSubtitleLayout {
  const scale = stored.lore_context.subtitle_scale;
  const center = stored.lore_context.subtitle_center;
  const candidate = {
    scale: typeof scale === "number" ? scale : DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT.scale,
    center: typeof center === "number" ? center : DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT.center,
  };
  // A stored value outside the published range cannot have come from this app's own refusal, so it is a hand-
  // edited file rather than a choice — the defaults are the honest answer, not a video made from a number the
  // screen's own control could never produce.
  return isPhotoCardSubtitleLayout(candidate) ? candidate : DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT;
}

export function toApiSummary(stored: StoredProject): ProjectSummary {
  return {
    id: stored.project_id,
    topic: stored.topic,
    projectType: stored.project_type as ProjectType,
    workflowState: stored.workflow_state as WorkflowState,
    createdAt: stored.created_at,
    updatedAt: stored.updated_at,
    aspectRatio: aspectRatioFor(stored),
    narrationAvailable: narrationAvailableFor(stored),
    ...(photoCardFor(stored) ? { photoCard: true, subtitleLayout: storedSubtitleLayout(stored) } : {}),
    ...(usedAudioFor(stored) !== undefined ? { usedAudio: usedAudioFor(stored) } : {}),
    ...(stored.instagram_post ? { instagramPost: {
      mediaId: stored.instagram_post.media_id,
      igUserId: stored.instagram_post.ig_user_id,
      publishedAt: stored.instagram_post.published_at,
      caption: stored.instagram_post.caption,
    } } : {}),
    // Carried out only when there is something to carry: an empty list on every project that has never
    // published would read as a fact about them rather than the absence of one.
    ...(stored.previous_instagram_posts.length > 0 ? { previousInstagramPosts: stored.previous_instagram_posts.map((post) => ({
      mediaId: post.media_id, igUserId: post.ig_user_id, publishedAt: post.published_at, caption: post.caption,
    })) } : {}),
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

/**
 * `Scene.script`/`motionPrompt`/`generatedImagePath`/`generatedVideoPath` are documented in domain.ts as
 * "computed, mapped fields", but this mapper used to hand the raw stored scene straight through and never
 * computed any of them — so every consumer reading them (StoryPromptScreen's script text, VideoWorkflowScreen's
 * source-image thumbnail and motion-prompt detail, ImageGenerationScreen's per-scene completion poll) always
 * saw them as absent, not merely empty. `description`/`generated_images`/`generated_video_paths`/`motion_prompts`
 * are the real data; this only adds the camelCase aliases the API contract promises, it does not remove the
 * raw pass-through fields other screens still read directly (e.g. `narration`).
 */
function toApiScene(rawScene: unknown, index: number, stored: StoredProject): Scene {
  const scene = rawScene && typeof rawScene === "object" && !Array.isArray(rawScene) ? rawScene as Record<string, unknown> : {};
  const script = typeof scene.description === "string" ? scene.description : undefined;
  const motionPrompt = stored.motion_prompts[index];
  const generatedImagePath = stored.generated_images[index];
  const generatedVideoPath = stored.generated_video_paths[index];
  return {
    ...scene,
    ...(script !== undefined ? { script } : {}),
    ...(motionPrompt ? { motionPrompt } : {}),
    ...(generatedImagePath ? { generatedImagePath } : {}),
    ...(generatedVideoPath ? { generatedVideoPath } : {}),
  } as unknown as Scene;
}

export function toApiProject(stored: StoredProject): Project {
  const jobId = latestVideoJobId(stored.video_generation_records);
  return {
    ...toApiSummary(stored),
    scenes: stored.scenes.map((scene, index) => toApiScene(scene, index, stored)),
    ...(stored.final_video_path !== null ? { finalVideoPath: stored.final_video_path } : {}),
    ...(jobId !== undefined ? { currentVideoJobId: jobId } : {}),
    warnings: withoutStaleRecoveryWarnings(stored.warnings, stored.workflow_state),
    errors: [...stored.errors],
  };
}
