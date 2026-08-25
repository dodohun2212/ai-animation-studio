import { describe, expect, it } from "vitest";

import { createStoredProject } from "./project.mapper.js";
import { applyShortProjectSettings, parseShortProjectSettings, toShortProjectSettings } from "./project-settings.js";

// The full settings shape as returned by the API — durationSeconds is included here (it is a real field on the
// response type) but is always derived server-side as sceneCount * clipDurationSeconds, never accepted as input.
const settings = {
  projectName: "별의 지도",
  topic: "별을 찾는 아이",
  genre: "판타지",
  mood: "따뜻하고 신비로움",
  character: "아이",
  lore: "별이 사라진 세계",
  fullStory: "아이가 별을 되찾는다.",
  durationSeconds: 30,
  sceneCount: 6 as const,
  clipDurationSeconds: 5 as const,
  additionalNotes: "무서운 장면 제외",
  styleNotes: { visualStyle: "수채화", lighting: "달빛", aspect: "16:9" },
  narrationEnabled: true,
};

// What a client actually sends in a request body: no durationSeconds field (SETTINGS_KEYS rejects it as unsupported).
const settingsRequest = {
  projectName: settings.projectName,
  topic: settings.topic,
  genre: settings.genre,
  mood: settings.mood,
  character: settings.character,
  lore: settings.lore,
  fullStory: settings.fullStory,
  sceneCount: settings.sceneCount,
  clipDurationSeconds: settings.clipDurationSeconds,
  additionalNotes: settings.additionalNotes,
  styleNotes: settings.styleNotes,
  narrationEnabled: settings.narrationEnabled,
};

describe("short project settings", () => {
  it("uses the Python Wizard defaults for a minimal existing project", () => {
    const result = toShortProjectSettings(createStoredProject("sample", "topic", "2026-08-22T00:00:00.000Z"));
    expect(result).toMatchObject({
      projectName: "단편 프로젝트",
      topic: "topic",
      genre: "미스터리",
      mood: "시네마틱",
      durationSeconds: 30,
      sceneCount: 6,
      clipDurationSeconds: 5,
      narrationEnabled: false,
    });
  });

  it("maps camelCase API settings to the Python snake_case storage fields without dropping existing data", () => {
    const stored = createStoredProject("sample", "old topic", "2026-08-22T00:00:00.000Z");
    stored.character_profile = { cast: [{ asset_id: "asset-1" }] };
    stored.lore_context = { unrelated_legacy_field: true };
    const updated = applyShortProjectSettings(stored, settings, "2026-08-22T01:00:00.000Z");

    expect(updated.topic).toBe(settings.topic);
    expect(updated.style_profile).toEqual({ genre: "판타지", mood: "따뜻하고 신비로움" });
    expect(updated.character_profile).toEqual({ cast: [{ asset_id: "asset-1" }], name: "아이" });
    expect(updated.lore_context).toMatchObject({
      unrelated_legacy_field: true,
      project_name: "별의 지도",
      full_story: "아이가 별을 되찾는다.",
      duration_seconds: 30,
      scene_count: 6,
      clip_duration_seconds: 5,
      style_notes: { visual_style: "수채화", lighting: "달빛", aspect: "16:9" },
    });
    expect(toShortProjectSettings(updated)).toEqual(settings);
  });

  it("rejects missing required fields, invalid clip duration/scene count, and unknown fields", () => {
    expect(() => parseShortProjectSettings({ ...settingsRequest, projectName: "" })).toThrow();
    expect(() => parseShortProjectSettings({ ...settingsRequest, clipDurationSeconds: 7 })).toThrow();
    expect(() => parseShortProjectSettings({ ...settingsRequest, sceneCount: 1 })).toThrow();
    expect(() => parseShortProjectSettings({ ...settingsRequest, sceneCount: 13 })).toThrow();
    expect(() => parseShortProjectSettings({ ...settingsRequest, sceneCount: 4.5 })).toThrow();
    expect(() => parseShortProjectSettings({ ...settingsRequest, unexpected: true })).toThrow();
    expect(() => parseShortProjectSettings({ ...settingsRequest, durationSeconds: 30 })).toThrow();
    expect(() => parseShortProjectSettings({ ...settingsRequest, styleNotes: { unknown: "x" } })).toThrow();
    expect(() => parseShortProjectSettings({ ...settingsRequest, narrationEnabled: "true" })).toThrow();
    const { narrationEnabled, ...withoutNarration } = settingsRequest;
    expect(() => parseShortProjectSettings(withoutNarration)).toThrow();
  });

  it("defaults narrationEnabled to false for existing projects and round-trips true/false through settings", () => {
    expect(toShortProjectSettings(createStoredProject("sample", "topic", "2026-08-22T00:00:00.000Z")).narrationEnabled).toBe(false);
    expect(parseShortProjectSettings({ ...settingsRequest, narrationEnabled: true }).narrationEnabled).toBe(true);
    expect(parseShortProjectSettings({ ...settingsRequest, narrationEnabled: false }).narrationEnabled).toBe(false);
  });

  it("accepts a scene count anywhere in the supported 2-12 range, not just 6", () => {
    expect(parseShortProjectSettings({ ...settingsRequest, sceneCount: 4 }).sceneCount).toBe(4);
    expect(parseShortProjectSettings({ ...settingsRequest, sceneCount: 12 }).sceneCount).toBe(12);
  });

  it("accepts both Runway-supported clip durations and derives durationSeconds from sceneCount * clipDurationSeconds", () => {
    expect(parseShortProjectSettings({ ...settingsRequest, sceneCount: 4, clipDurationSeconds: 5 })).toMatchObject({ clipDurationSeconds: 5, durationSeconds: 20 });
    expect(parseShortProjectSettings({ ...settingsRequest, sceneCount: 4, clipDurationSeconds: 10 })).toMatchObject({ clipDurationSeconds: 10, durationSeconds: 40 });
  });

  it("trims strings and omits blank optional style entries", () => {
    const parsed = parseShortProjectSettings({
      ...settingsRequest,
      projectName: "  별의 지도  ",
      topic: "  별을 찾는 아이  ",
      styleNotes: { lighting: "  달빛  ", color: "  " },
    });
    expect(parsed.projectName).toBe("별의 지도");
    expect(parsed.topic).toBe("별을 찾는 아이");
    expect(parsed.styleNotes).toEqual({ lighting: "달빛" });
  });
});
