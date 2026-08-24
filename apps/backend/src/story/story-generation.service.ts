import type { StoredProject } from "../projects/project-storage.schema.js";
import { toShortProjectSettings } from "../projects/project-settings.js";

const SCENE_FIELDS = [
  "number", "description", "visual_action", "start_motion", "main_motion", "end_motion",
  "shot_size", "camera_angle", "composition", "lens_feel", "focus_subject", "camera_motion",
  "environment_motion", "motion_speed", "motion_intensity", "expression_change", "continuity_hint",
] as const;

export type StoredStory = {
  title: string;
  synopsis: string;
  ending: string;
  scenes: Array<Record<(typeof SCENE_FIELDS)[number], string | number>>;
};

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Enforces Python's OpenAI `STORY_SCHEMA` plus StoryEngine's ordered-scene
 * and non-empty-description invariants before anything is persisted.
 */
export function validateStory(value: unknown, sceneCount = 6): asserts value is StoredStory {
  if (!object(value) || Object.keys(value).length !== 4
    || !["title", "synopsis", "ending", "scenes"].every((key) => key in value)
    || typeof value.title !== "string" || typeof value.synopsis !== "string" || typeof value.ending !== "string"
    || !Array.isArray(value.scenes) || value.scenes.length !== sceneCount) {
    throw new Error(`Story response does not match the required ${sceneCount}-scene schema.`);
  }

  value.scenes.forEach((scene, index) => {
    if (!object(scene) || Object.keys(scene).length !== SCENE_FIELDS.length
      || !SCENE_FIELDS.every((key) => key in scene)
      || scene.number !== index + 1
      || !SCENE_FIELDS.slice(1).every((key) => typeof scene[key] === "string")
      || !String(scene.description).trim()) {
      throw new Error("Story response does not match the required ordered scene schema.");
    }
  });
}

/**
 * Deterministic local stand-in for the future provider adapter. It has no SDK,
 * network, process, or media dependency; its output still must pass the same
 * strict schema that a provider response will use.
 */
export function generateLocalStory(stored: StoredProject, approvedPrompt: string): StoredStory {
  const topic = stored.topic.trim();
  const sceneCount = toShortProjectSettings(stored).sceneCount;
  const concisePrompt = approvedPrompt.trim().replace(/\s+/g, " ").slice(0, 120);
  const scenes = Array.from({ length: sceneCount }, (_, offset) => {
    const number = offset + 1;
    const phase = number === 1 ? "begins" : number === sceneCount ? "resolves" : "continues";
    return {
      number,
      description: `Scene ${number}: ${topic} ${phase}.`,
      visual_action: `The subject advances the ${topic} story beat ${number}.`,
      start_motion: "A still opening pose shifts into motion.",
      main_motion: `The central action develops in scene ${number}.`,
      end_motion: "The movement settles into the next transition.",
      shot_size: "medium shot",
      camera_angle: "eye level",
      composition: "centered subject with readable background",
      lens_feel: "natural perspective",
      focus_subject: topic,
      camera_motion: "gentle forward movement",
      environment_motion: "subtle ambient movement",
      motion_speed: "normal",
      motion_intensity: "moderate",
      expression_change: "focused to hopeful",
      continuity_hint: number === 1 ? "Establish the opening visual state." : "Continue the previous scene's ending pose and direction.",
    };
  });
  const story: StoredStory = {
    title: `${topic} — Local Story`,
    synopsis: `A ${sceneCount}-scene local draft for ${topic}, based on the approved prompt: ${concisePrompt}.`,
    ending: `The ${sceneCount}-scene ${topic} story reaches a clear local ending.`,
    scenes,
  };
  validateStory(story, sceneCount);
  return story;
}
