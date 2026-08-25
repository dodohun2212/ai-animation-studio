import { sceneNumbersFor, type SceneNumber, type SceneStaleness } from "@ai-animation-studio/shared";
import { imagePromptFor, sceneValue, styleLineFor } from "../images/image-prompt.js";
import { promptFor, ratioFor, type StoredScene } from "../videos/video-preview.service.js";
import { toShortProjectSettings } from "./project-settings.js";
import type { StoredProject } from "./project-storage.schema.js";

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
 */
export function computeSceneStaleness(project: StoredProject): SceneStaleness {
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
