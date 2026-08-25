import { MAX_SCENE_COUNT, MIN_SCENE_COUNT, RUNWAY_CLIP_DURATIONS, type ShortProjectSettings, type ShortProjectStyleNotes } from "@ai-animation-studio/shared";

import { invalidRequest } from "./project-api.error.js";
import type { StoredProject } from "./project-storage.schema.js";

const DEFAULT_SCENE_COUNT = 6;
const DEFAULT_CLIP_DURATION_SECONDS = 5;

function isValidSceneCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_SCENE_COUNT && value <= MAX_SCENE_COUNT;
}

function isValidClipDuration(value: unknown): value is number {
  return typeof value === "number" && (RUNWAY_CLIP_DURATIONS as readonly number[]).includes(value);
}

const STYLE_KEYS = ["visualStyle", "color", "lighting", "camera", "dialogue", "avoid", "aspect"] as const;
const SETTINGS_KEYS = ["projectName", "topic", "genre", "mood", "character", "lore", "fullStory", "sceneCount", "clipDurationSeconds", "additionalNotes", "styleNotes", "narrationEnabled", "subtitlesEnabled"] as const;

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidRequest(`${field} must be an object.`, { field });
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw invalidRequest(`${field} contains unsupported fields.`, { field, unknown: unknown.sort() });
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidRequest(`${field} must be a non-empty string.`, { field });
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw invalidRequest(`${field} must be a string.`, { field });
  }
  return value.trim();
}

function stringFrom(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function styleNotesFrom(value: unknown): ShortProjectStyleNotes {
  const source = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const result: ShortProjectStyleNotes = {};
  for (const key of STYLE_KEYS) {
    const item = source[key === "visualStyle" ? "visual_style" : key];
    if (typeof item === "string" && item.trim()) {
      result[key] = item;
    }
  }
  return result;
}

export function toShortProjectSettings(stored: StoredProject): ShortProjectSettings {
  const storyTitle = stringFrom(stored.story.title);
  const sceneCount = isValidSceneCount(stored.lore_context.scene_count) ? stored.lore_context.scene_count : DEFAULT_SCENE_COUNT;
  const clipDurationSeconds = isValidClipDuration(stored.lore_context.clip_duration_seconds) ? stored.lore_context.clip_duration_seconds : DEFAULT_CLIP_DURATION_SECONDS;
  return {
    projectName: stringFrom(stored.lore_context.project_name, storyTitle || "단편 프로젝트"),
    topic: stored.topic,
    genre: stringFrom(stored.style_profile.genre, "미스터리"),
    mood: stringFrom(stored.style_profile.mood, "시네마틱"),
    character: stringFrom(stored.character_profile.name),
    lore: stringFrom(stored.lore_context.lore),
    fullStory: stringFrom(stored.lore_context.full_story),
    durationSeconds: sceneCount * clipDurationSeconds,
    sceneCount,
    clipDurationSeconds,
    additionalNotes: stringFrom(stored.lore_context.additional_notes),
    styleNotes: styleNotesFrom(stored.lore_context.style_notes),
    narrationEnabled: stored.lore_context.narration_enabled === true,
    // Falls back to narrationEnabled's value when the key has never been stored — see ShortProjectSettings.subtitlesEnabled's doc comment.
    subtitlesEnabled: "subtitles_enabled" in stored.lore_context
      ? stored.lore_context.subtitles_enabled === true
      : stored.lore_context.narration_enabled === true,
  };
}

export function parseShortProjectSettings(value: unknown): ShortProjectSettings {
  const settings = asObject(value, "settings");
  rejectUnknownFields(settings, SETTINGS_KEYS, "settings");
  for (const key of SETTINGS_KEYS) {
    if (!(key in settings)) {
      throw invalidRequest(`settings.${key} is required.`, { field: `settings.${key}` });
    }
  }
  const styleNotes = asObject(settings.styleNotes, "settings.styleNotes");
  rejectUnknownFields(styleNotes, STYLE_KEYS, "settings.styleNotes");
  const normalizedStyleNotes: ShortProjectStyleNotes = {};
  for (const key of STYLE_KEYS) {
    if (key in styleNotes) {
      const item = optionalString(styleNotes[key], `settings.styleNotes.${key}`);
      if (item) normalizedStyleNotes[key] = item;
    }
  }
  if (!isValidSceneCount(settings.sceneCount)) {
    throw invalidRequest(`settings.sceneCount must be an integer between ${MIN_SCENE_COUNT} and ${MAX_SCENE_COUNT}.`, { field: "settings.sceneCount" });
  }
  if (!isValidClipDuration(settings.clipDurationSeconds)) {
    throw invalidRequest(`settings.clipDurationSeconds must be one of: ${RUNWAY_CLIP_DURATIONS.join(", ")}.`, { field: "settings.clipDurationSeconds" });
  }
  if (typeof settings.narrationEnabled !== "boolean") {
    throw invalidRequest("settings.narrationEnabled must be a boolean.", { field: "settings.narrationEnabled" });
  }
  if (typeof settings.subtitlesEnabled !== "boolean") {
    throw invalidRequest("settings.subtitlesEnabled must be a boolean.", { field: "settings.subtitlesEnabled" });
  }
  return {
    projectName: requiredString(settings.projectName, "settings.projectName"),
    topic: requiredString(settings.topic, "settings.topic"),
    genre: optionalString(settings.genre, "settings.genre"),
    mood: optionalString(settings.mood, "settings.mood"),
    character: optionalString(settings.character, "settings.character"),
    lore: optionalString(settings.lore, "settings.lore"),
    fullStory: optionalString(settings.fullStory, "settings.fullStory"),
    // Derived, not accepted from the client — see the ShortProjectSettings.durationSeconds doc comment.
    durationSeconds: settings.sceneCount * settings.clipDurationSeconds,
    sceneCount: settings.sceneCount,
    clipDurationSeconds: settings.clipDurationSeconds,
    additionalNotes: optionalString(settings.additionalNotes, "settings.additionalNotes"),
    styleNotes: normalizedStyleNotes,
    narrationEnabled: settings.narrationEnabled,
    subtitlesEnabled: settings.subtitlesEnabled,
  };
}

export function applyShortProjectSettings(stored: StoredProject, settings: ShortProjectSettings, updatedAt: string): StoredProject {
  const styleNotes: Record<string, string> = {};
  for (const key of STYLE_KEYS) {
    const value = settings.styleNotes[key];
    if (value) styleNotes[key === "visualStyle" ? "visual_style" : key] = value;
  }
  return {
    ...stored,
    topic: settings.topic,
    updated_at: updatedAt,
    style_profile: { ...stored.style_profile, genre: settings.genre, mood: settings.mood },
    character_profile: { ...stored.character_profile, name: settings.character },
    lore_context: {
      ...stored.lore_context,
      project_name: settings.projectName,
      lore: settings.lore,
      full_story: settings.fullStory,
      // duration_seconds is kept in storage for transparency/debugging even though it is always derived
      // (scene_count * clip_duration_seconds) — see ShortProjectSettings.durationSeconds.
      duration_seconds: settings.durationSeconds,
      scene_count: settings.sceneCount,
      clip_duration_seconds: settings.clipDurationSeconds,
      additional_notes: settings.additionalNotes,
      style_notes: styleNotes,
      narration_enabled: settings.narrationEnabled,
      subtitles_enabled: settings.subtitlesEnabled,
    },
  };
}
