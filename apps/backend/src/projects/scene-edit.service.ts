import { Injectable } from "@nestjs/common";
import { sceneNumbersFor, type SceneNumber, type SceneStaleness, type UpdateSceneResponse } from "@ai-animation-studio/shared";
import { toApiProject } from "./project.mapper.js";
import { LocalProjectRepository } from "./projects.repository.js";
import { toShortProjectSettings } from "./project-settings.js";
import type { StoredProject } from "./project-storage.schema.js";
import { imagePromptFor, sceneValue, styleLineFor } from "../images/image-prompt.js";
import { promptFor, ratioFor, type StoredScene } from "../videos/video-preview.service.js";
import { scriptFingerprint, LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { invalidRequest } from "./project-api.error.js";

/**
 * Every field the short-project scene schema has, classified by what a change actually makes stale downstream
 * (see the from-cli.md Round 49 report for the full reasoning): image-composition fields (imagePromptFor reads
 * these), video-motion fields (video-preview.service.ts's promptFor reads these — including from the *previous*
 * scene, which is why staleness is computed by full recomputation rather than a per-field diff, see staleness()
 * below), narration (only narration/TTS reads it), and description (display-only, read by nothing downstream —
 * still editable, just never makes anything stale).
 */
const EDITABLE_SCENE_FIELDS = [
  "description",
  "visual_action", "shot_size", "camera_angle", "composition", "lens_feel", "focus_subject",
  "start_motion", "main_motion", "end_motion", "expression_change", "camera_motion", "environment_motion", "motion_speed", "motion_intensity", "continuity_hint",
  "narration",
] as const;

function scenesFor(project: StoredProject): SceneNumber[] {
  return sceneNumbersFor(toShortProjectSettings(project).sceneCount);
}
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Scans newest-first: a scene can have multiple records across regenerations, and only the latest reflects what's actually on disk. */
function latestRecordField(records: readonly unknown[], sceneNumber: number, key: string): string | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (isObject(record) && record.scene_number === sceneNumber && typeof record[key] === "string") return record[key];
  }
  return undefined;
}

@Injectable()
export class SceneEditService {
  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly projectsRoot: string,
    private readonly mappings: LocalProjectAssetMappingsRepository = new LocalProjectAssetMappingsRepository(projectsRoot),
  ) {}

  /**
   * Compares a freshly recomputed prompt/narration against what's actually recorded from the last time that
   * artifact was generated — never a persisted flag, so nothing needs to be kept in sync and nothing can drift
   * out of accuracy on its own (see UpdateSceneResponse.staleness's doc comment). Recomputing scene N's video
   * prompt from CURRENT scene data automatically picks up an edit to scene N-1's end_motion/continuity_hint
   * too (promptFor reads the previous scene for its continuity cue) — so a scene whose own fields were
   * untouched can still show up here, with no special-case propagation code needed for that.
   */
  private staleness(project: StoredProject): SceneStaleness {
    const scenes = scenesFor(project);
    const styleLine = styleLineFor(project);
    const ratio = ratioFor(project);
    const clipDurationSeconds = toShortProjectSettings(project).clipDurationSeconds;
    const imageStale: SceneNumber[] = [];
    const videoStale: SceneNumber[] = [];
    const narrationStale: SceneNumber[] = [];
    for (const number of scenes) {
      const scene = project.scenes[number - 1];

      const recordedImagePrompt = latestRecordField(project.image_generation_records, number, "prompt");
      if (recordedImagePrompt !== undefined && imagePromptFor(scene, styleLine) !== recordedImagePrompt) imageStale.push(number);

      const recordedNarration = latestRecordField(project.narration_generation_records, number, "narration");
      if (recordedNarration !== undefined && sceneValue(scene, "narration") !== recordedNarration) narrationStale.push(number);

      const recordedVideoPrompt = latestRecordField(project.video_generation_records, number, "prompt");
      if (recordedVideoPrompt !== undefined) {
        const previous = number > 1 ? (project.scenes[number - 2] as StoredScene) : undefined;
        let recomputed: string | undefined;
        try { recomputed = promptFor(scene as StoredScene, previous, ratio, clipDurationSeconds); } catch { recomputed = undefined; }
        if (recomputed !== undefined && recomputed !== recordedVideoPrompt) videoStale.push(number);
      }
    }
    return { imageStale, videoStale, narrationStale };
  }

  async update(projectId: string, rawSceneNumber: string, body: unknown): Promise<UpdateSceneResponse> {
    if (!isObject(body) || Object.keys(body).length !== 1 || !isObject(body.scene)) throw invalidRequest("Request must be { scene: { <field>: <value>, ... } }.");
    const edits = body.scene;
    const editKeys = Object.keys(edits);
    if (editKeys.length === 0) throw invalidRequest("scene must include at least one field to edit.");
    const unknownKeys = editKeys.filter((key) => !(EDITABLE_SCENE_FIELDS as readonly string[]).includes(key));
    if (unknownKeys.length > 0) throw invalidRequest(`scene contains unsupported fields: ${unknownKeys.sort().join(", ")}`, { unknown: unknownKeys.sort() });
    if (!Object.values(edits).every((value) => typeof value === "string")) throw invalidRequest("Every scene field value must be a string.");

    const project = await this.projects.findById(projectId.trim());
    const scenes = scenesFor(project);
    const parsedNumber = Number(rawSceneNumber);
    if (!Number.isInteger(parsedNumber) || String(parsedNumber) !== rawSceneNumber || !scenes.includes(parsedNumber as SceneNumber)) {
      throw invalidRequest("Invalid scene number.");
    }
    const sceneNumber = parsedNumber as SceneNumber;
    const current = project.scenes[sceneNumber - 1];
    if (!isObject(current)) throw invalidRequest("Scene data is invalid.");

    const updatedScenes = [...project.scenes];
    updatedScenes[sceneNumber - 1] = { ...current, ...edits };
    const updated: StoredProject = { ...project, scenes: updatedScenes, updated_at: new Date().toISOString() };

    // A narrow, whitelisted field edit through this endpoint is a case the product has already decided doesn't
    // need a human to re-review Asset Mapping (see from-cli.md Round 49 — mapping is entirely manual asset
    // picking, no field here feeds automatic matching). Re-stamping the approved review's own fingerprint to
    // match the post-edit scenes keeps that decision local to this one call site: the general story-regeneration
    // path never touches this, so its own mapping-invalidation safety net is untouched.
    const review = await this.mappings.loadReview(project.project_id);
    if (review.status === "approved") {
      await this.mappings.saveReview(project.project_id, { ...review, script_fingerprint: scriptFingerprint(updated.scenes) });
    }

    await this.projects.save(updated);
    return { project: toApiProject(updated), staleness: this.staleness(updated) };
  }
}
