import type { LongEpisodeScene, LongEpisodeScript } from "@ai-animation-studio/shared";

const snakeKeys = ["number", "description", "visual_action", "start_motion", "main_motion", "end_motion", "shot_size", "camera_angle", "composition", "lens_feel", "focus_subject", "camera_motion", "environment_motion", "motion_speed", "motion_intensity", "expression_change", "continuity_hint"] as const;
const camelKeys = ["number", "description", "visualAction", "startMotion", "mainMotion", "endMotion", "shotSize", "cameraAngle", "composition", "lensFeel", "focusSubject", "cameraMotion", "environmentMotion", "motionSpeed", "motionIntensity", "expressionChange", "continuityHint"] as const;

/**
 * The stored `episode.script` on disk is Python-compatible snake_case (see episode-scripts.service.ts's
 * storedScript()), but every LongEpisodeDetail API response must return camelCase LongEpisodeScene fields.
 * Tolerant of either casing so it is safe to call on scripts already shaped by episode-scripts.service.ts.
 */
export function toApiEpisodeScript(stored: unknown): LongEpisodeScript | undefined {
  if (!stored || typeof stored !== "object" || Array.isArray(stored) || !Object.keys(stored).length) return undefined;
  const record = stored as Record<string, unknown>;
  const scenes = record.scenes;
  if (typeof record.title !== "string" || typeof record.synopsis !== "string" || typeof record.ending !== "string" || !Array.isArray(scenes)) return undefined;
  return {
    title: record.title,
    synopsis: record.synopsis,
    ending: record.ending,
    scenes: scenes.map((item) => {
      const scene = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const sourceKeys = "visualAction" in scene ? camelKeys : snakeKeys;
      // "narration" is the same key both cased (no underscore) — optional, see LongEpisodeScene.narration's doc comment.
      return Object.fromEntries([...camelKeys.map((key, index) => [key, scene[sourceKeys[index]!]]), ...(typeof scene.narration === "string" ? [["narration", scene.narration]] : [])]) as unknown as LongEpisodeScene;
    }),
  };
}
