import { sceneNumbersFor, type SceneNumber, type SceneStaleness } from "@ai-animation-studio/shared";
import { imagePromptFor, sceneValue, styleLineFor } from "../images/image-prompt.js";
import { describeReferenceMappingsForScene, referenceSourcesForScene } from "../images/image-reference-selection.js";
import type { LocalAssetsRepository } from "../assets/assets.repository.js";
import type { StoredAssetMapping } from "../mappings/mapping-storage.js";
import type { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { promptFor, ratioFor, type StoredScene } from "../videos/video-preview.service.js";
import { toShortProjectSettings } from "./project-settings.js";
import type { StoredProject } from "./project-storage.schema.js";
import { previousSceneContinuityImagePath } from "./project-continuity.js";

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

/** The array counterpart of latestRecordField, for the recorded reference list. Same newest-first scan. */
function latestRecordStrings(records: readonly unknown[], sceneNumber: number, key: string): string[] | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (isObject(record) && record.scene_number === sceneNumber && Array.isArray(record[key]) && (record[key] as unknown[]).every((entry) => typeof entry === "string")) return record[key] as string[];
  }
  return undefined;
}

/**
 * Compares a freshly recomputed prompt/narration against what's actually recorded from the last time that
 * artifact was generated — never a persisted flag, so nothing needs to be kept in sync and nothing can drift out
 * of accuracy on its own. A scene with no record for an artifact is never "stale" for it (there is nothing to be
 * behind — it just hasn't been made yet, a distinct state the caller should render differently). Recomputing
 * scene N's video prompt from CURRENT scene data automatically picks up an edit to scene N-1's
 * end_motion/continuity_hint too (promptFor reads the previous scene for its own continuity cue) — so a scene
 * whose own fields were untouched can still appear here, with no special-case propagation code needed for that.
 *
 * Always covers every scene in the project, not just a just-edited one: scene-edit.service.ts's PATCH response
 * needs the whole picture because one edit can make more than one scene stale (the propagation case above), and
 * every review GET endpoint (image/video/narration) needs the same full picture for a user opening that screen
 * cold, not only right after an edit.
 *
 * `referenceContext` lets the image-staleness check recompute the same `References:` block
 * imagePromptFor() folds into a real generation (see image-reference-selection.ts). Passing `undefined` recomputes
 * without that block regardless of what actually shipped, which makes every scene of a project with a confirmed
 * Asset Mapping incorrectly imageStale — the recorded prompt has a References section this function then cannot
 * reproduce. That is why it is a required parameter with an explicit `undefined` rather than an optional one:
 * three of the four callers used to leave it off, and each of their responses was wrong in exactly that way for
 * any project with a mapping. `undefined` now means "the mappings could not be read", not "nobody thought about
 * it", and `sceneReferenceContext` below is how a caller builds one.
 */
export interface SceneReferenceContext {
  assets: LocalAssetsRepository;
  mappings: readonly StoredAssetMapping[];
  directory: string;
}

/**
 * The context above, built from the two repositories every caller of this function can reach.
 *
 * Exists because "how do I build one of these" was previously each caller's own problem, and three of the four
 * answered it by not building one — which is a decision none of them looks like it is making. The parameter is
 * now required, so omitting it is a compile error rather than a silently wrong list, and this is the one place
 * that knows a project's mappings live beside its project.json.
 *
 * `undefined` when the mappings cannot be read, which the comparison treats as "cannot tell" rather than "no
 * references": a project whose mapping file is unreadable must not have every generated scene reported behind.
 */
export async function sceneReferenceContext(
  assets: LocalAssetsRepository,
  mappings: LocalProjectAssetMappingsRepository,
  projectId: string,
): Promise<SceneReferenceContext | undefined> {
  try {
    const location = mappings.projectLocation(projectId);
    return { assets, mappings: await mappings.load(location), directory: location.directory };
  } catch { return undefined; }
}

export async function computeSceneStaleness(
  project: StoredProject,
  referenceContext: SceneReferenceContext | undefined,
): Promise<SceneStaleness> {
  const scenes = scenesFor(project);
  const styleLine = styleLineFor(project);
  const ratio = ratioFor(project);
  const clipDurationSeconds = toShortProjectSettings(project).clipDurationSeconds;
  const imageStale: SceneNumber[] = [];
  const videoStale: SceneNumber[] = [];
  const narrationStale: SceneNumber[] = [];
  const referenceStale: SceneNumber[] = [];
  for (const number of scenes) {
    const scene = project.scenes[number - 1];

    const recordedImagePrompt = latestRecordField(project.image_generation_records, number, "prompt");
    if (recordedImagePrompt !== undefined) {
      const referenceNotes = referenceContext ? await describeReferenceMappingsForScene(referenceContext.assets, referenceContext.mappings, number) : "";
      if (imagePromptFor(scene, styleLine, referenceNotes) !== recordedImagePrompt) imageStale.push(number);
    }

    // Skipped entirely without a referenceContext, for the same reason the text block is: recomputing "no
    // references at all" against a record that has some would report every such scene as behind, and the caller
    // that omits the context is the one that cannot tell.
    const recordedSources = latestRecordStrings(project.image_generation_records, number, "reference_sources");
    if (recordedSources !== undefined && referenceContext) {
      // Order as well as membership — the model is shown the images in this order, and a reordered list is a
      // different request.
      const now = await referenceSourcesForScene(referenceContext.assets, referenceContext.mappings, referenceContext.directory, number, previousSceneContinuityImagePath(project));
      if (now.length !== recordedSources.length || now.some((source, index) => source !== recordedSources[index])) referenceStale.push(number);
    }

    const recordedNarration = latestRecordField(project.narration_generation_records, number, "narration");
    if (recordedNarration !== undefined && sceneValue(scene, "narration") !== recordedNarration) narrationStale.push(number);

    const recordedVideoPrompt = latestRecordField(project.video_generation_records, number, "prompt");
    if (recordedVideoPrompt !== undefined) {
      const previous = number > 1 ? (project.scenes[number - 2] as StoredScene) : undefined;
      let recomputed: string | undefined;
      try { recomputed = promptFor(scene as StoredScene, previous, ratio, clipDurationSeconds).prompt; } catch { recomputed = undefined; }
      if (recomputed !== undefined && recomputed !== recordedVideoPrompt) videoStale.push(number);
    }
  }
  return { imageStale, videoStale, narrationStale, referenceStale };
}
