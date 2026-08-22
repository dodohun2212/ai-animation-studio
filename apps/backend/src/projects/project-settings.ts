import type { ShortProjectSettings, ShortProjectStyleNotes } from "@ai-animation-studio/shared";

import { invalidRequest } from "./project-api.error.js";
import type { StoredProject } from "./project-storage.schema.js";

const STYLE_KEYS = ["visualStyle", "color", "lighting", "camera", "dialogue", "avoid", "aspect"] as const;
const SETTINGS_KEYS = ["projectName", "topic", "genre", "mood", "character", "lore", "fullStory", "durationSeconds", "sceneCount", "additionalNotes", "styleNotes"] as const;

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
  const duration = stored.lore_context.duration_seconds;
  return {
    projectName: stringFrom(stored.lore_context.project_name, storyTitle || "단편 프로젝트"),
    topic: stored.topic,
    genre: stringFrom(stored.style_profile.genre, "미스터리"),
    mood: stringFrom(stored.style_profile.mood, "시네마틱"),
    character: stringFrom(stored.character_profile.name),
    lore: stringFrom(stored.lore_context.lore),
    fullStory: stringFrom(stored.lore_context.full_story),
    durationSeconds: typeof duration === "number" && Number.isInteger(duration) && duration > 0 ? duration : 30,
    sceneCount: 6,
    additionalNotes: stringFrom(stored.lore_context.additional_notes),
    styleNotes: styleNotesFrom(stored.lore_context.style_notes),
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
  if (!Number.isInteger(settings.durationSeconds) || (settings.durationSeconds as number) <= 0) {
    throw invalidRequest("settings.durationSeconds must be a positive integer.", { field: "settings.durationSeconds" });
  }
  if (settings.sceneCount !== 6) {
    throw invalidRequest("settings.sceneCount must be exactly 6.", { field: "settings.sceneCount" });
  }
  return {
    projectName: requiredString(settings.projectName, "settings.projectName"),
    topic: requiredString(settings.topic, "settings.topic"),
    genre: optionalString(settings.genre, "settings.genre"),
    mood: optionalString(settings.mood, "settings.mood"),
    character: optionalString(settings.character, "settings.character"),
    lore: optionalString(settings.lore, "settings.lore"),
    fullStory: optionalString(settings.fullStory, "settings.fullStory"),
    durationSeconds: settings.durationSeconds as number,
    sceneCount: 6,
    additionalNotes: optionalString(settings.additionalNotes, "settings.additionalNotes"),
    styleNotes: normalizedStyleNotes,
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
      duration_seconds: settings.durationSeconds,
      scene_count: 6,
      additional_notes: settings.additionalNotes,
      style_notes: styleNotes,
    },
  };
}
