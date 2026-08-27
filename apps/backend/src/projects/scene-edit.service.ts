import { Injectable } from "@nestjs/common";
import { sceneNumbersFor, type SceneNumber, type UpdateSceneResponse } from "@ai-animation-studio/shared";
import { toApiProject } from "./project.mapper.js";
import { LocalProjectRepository } from "./projects.repository.js";
import { toShortProjectSettings } from "./project-settings.js";
import type { StoredProject } from "./project-storage.schema.js";
import { computeSceneStaleness } from "./scene-staleness.js";
import { scriptFingerprint, LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { invalidRequest } from "./project-api.error.js";

/**
 * Every field the short-project scene schema has, classified by what a change actually makes stale downstream
 * (see the from-cli.md Round 49 report for the full reasoning): image-composition fields (imagePromptFor reads
 * these), video-motion fields (video-preview.service.ts's promptFor reads these — including from the *previous*
 * scene, which is why staleness is computed by full recomputation rather than a per-field diff, see
 * scene-staleness.ts), narration (only narration/TTS reads it), and description (display-only, read by nothing
 * downstream — still editable, just never makes anything stale).
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

@Injectable()
export class SceneEditService {
  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly projectsRoot: string,
    private readonly mappings: LocalProjectAssetMappingsRepository = new LocalProjectAssetMappingsRepository(projectsRoot),
  ) {}

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
    const review = await this.mappings.loadReview(this.mappings.projectLocation(project.project_id));
    if (review.status === "approved") {
      await this.mappings.saveReview(this.mappings.projectLocation(project.project_id), { ...review, script_fingerprint: scriptFingerprint(updated.scenes) });
    }

    await this.projects.save(updated);
    // TODO: no LocalAssetsRepository injected here yet, so this still recomputes the image-staleness check
    // without a References block — a project with a confirmed Asset Mapping can show a wrong imageStale here
    // even though image-review.service.ts's own GET now gets it right (same gap).
    return { project: toApiProject(updated), staleness: await computeSceneStaleness(updated) };
  }
}
