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
  subtitlesEnabled: true,
  sceneImageContinuityEnabled: false,
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
  subtitlesEnabled: settings.subtitlesEnabled,
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
      subtitlesEnabled: false,
      sceneImageContinuityEnabled: false,
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
    expect(() => parseShortProjectSettings({ ...settingsRequest, subtitlesEnabled: "true" })).toThrow();
    const { subtitlesEnabled, ...withoutSubtitles } = settingsRequest;
    expect(() => parseShortProjectSettings(withoutSubtitles)).toThrow();
  });

  it("defaults narrationEnabled to false for existing projects and round-trips true/false through settings", () => {
    expect(toShortProjectSettings(createStoredProject("sample", "topic", "2026-08-22T00:00:00.000Z")).narrationEnabled).toBe(false);
    expect(parseShortProjectSettings({ ...settingsRequest, narrationEnabled: true }).narrationEnabled).toBe(true);
    expect(parseShortProjectSettings({ ...settingsRequest, narrationEnabled: false }).narrationEnabled).toBe(false);
  });

  /**
   * The one settings field a request may leave out, and the reason is today's other lesson: it arrived after
   * pages were already running, so requiring it would have made every save from an existing page fail on a name
   * that page has never heard of — the shape that cost 캡틴D the whole video step when a client guard was one
   * clip length behind the contract. Absent means off. A present non-boolean is still refused, because 「the
   * client did not know about this」 and 「the client sent something else」 are different things.
   */
  it("accepts a request that omits sceneImageContinuityEnabled, reads it as off, and still refuses a non-boolean", () => {
    // settingsRequest is what an existing page sends: it has never carried this field.
    expect(parseShortProjectSettings(settingsRequest).sceneImageContinuityEnabled).toBe(false);
    expect(parseShortProjectSettings({ ...settingsRequest, sceneImageContinuityEnabled: true }).sceneImageContinuityEnabled).toBe(true);
    expect(() => parseShortProjectSettings({ ...settingsRequest, sceneImageContinuityEnabled: "true" })).toThrow();
  });

  /*
   * The preset mark (Cowork Round 787): which built-in form wrote these settings, at which revision — so an approval
   * screen can say "this project was made from an older preset" before 캡틴D pays for a Story built on old text.
   */
  it("stores a preset mark a save carries, reads it back, and keeps it through a save that does not carry one", () => {
    const stored = createStoredProject("flower", "topic", "2026-08-22T00:00:00.000Z");
    const marked = applyShortProjectSettings(stored, parseShortProjectSettings({ ...settingsRequest, preset: { id: "flower_meaning", revision: 3 } }), "2026-09-12T00:00:00.000Z");
    expect(toShortProjectSettings(marked).preset).toEqual({ id: "flower_meaning", revision: 3 });

    // A settings screen that never heard of presets saves without the field; that must not erase the mark.
    const resaved = applyShortProjectSettings(marked, parseShortProjectSettings(settingsRequest), "2026-09-12T01:00:00.000Z");
    expect(toShortProjectSettings(resaved).preset).toEqual({ id: "flower_meaning", revision: 3 });

    // And a project no preset made carries no mark at all.
    expect(toShortProjectSettings(stored)).not.toHaveProperty("preset");
  });

  it("refuses a preset mark it does not know, and reads a malformed stored one as none", () => {
    for (const preset of [{ id: "other", revision: 1 }, { id: "flower_meaning", revision: 0 }, { id: "flower_meaning", revision: 1.5 }, { id: "flower_meaning" }, { id: "flower_meaning", revision: 1, extra: true }, "flower_meaning"]) {
      expect(() => parseShortProjectSettings({ ...settingsRequest, preset }), JSON.stringify(preset)).toThrow();
    }
    const stored = createStoredProject("bent", "topic", "2026-08-22T00:00:00.000Z");
    stored.lore_context = { settings_preset: { id: "flower_meaning", revision: "3" } };
    expect(toShortProjectSettings(stored)).not.toHaveProperty("preset");
  });

  /** A project stored before the field existed is off, and nothing older is read as meaning the same thing. */
  it("reads a project that predates the field as having the chain off", () => {
    const stored = createStoredProject("old", "topic", "2026-08-22T00:00:00.000Z");
    stored.lore_context = { narration_enabled: true, subtitles_enabled: true };

    expect(toShortProjectSettings(stored).sceneImageContinuityEnabled).toBe(false);
  });

  it("round-trips subtitlesEnabled true/false through settings independently of narrationEnabled", () => {
    expect(parseShortProjectSettings({ ...settingsRequest, narrationEnabled: false, subtitlesEnabled: true }).subtitlesEnabled).toBe(true);
    expect(parseShortProjectSettings({ ...settingsRequest, narrationEnabled: true, subtitlesEnabled: false }).subtitlesEnabled).toBe(false);
  });

  it("falls back subtitlesEnabled to narrationEnabled's stored value for a project that predates the subtitlesEnabled field", () => {
    const stored = createStoredProject("sample", "topic", "2026-08-22T00:00:00.000Z");
    stored.lore_context = { narration_enabled: true }; // legacy project: no subtitles_enabled key at all
    expect(toShortProjectSettings(stored).subtitlesEnabled).toBe(true);

    stored.lore_context = { narration_enabled: false };
    expect(toShortProjectSettings(stored).subtitlesEnabled).toBe(false);

    // Once the key IS present, it wins even if it disagrees with narrationEnabled — the fallback is only for its absence.
    stored.lore_context = { narration_enabled: true, subtitles_enabled: false };
    expect(toShortProjectSettings(stored).subtitlesEnabled).toBe(false);
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
