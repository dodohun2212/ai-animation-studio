import { describe, expect, it } from "vitest";

import { createStoredProject } from "./project.mapper.js";
import { applyShortProjectSettings, parseShortProjectSettings, toShortProjectSettings } from "./project-settings.js";

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
  additionalNotes: "무서운 장면 제외",
  styleNotes: { visualStyle: "수채화", lighting: "달빛", aspect: "16:9" },
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
      style_notes: { visual_style: "수채화", lighting: "달빛", aspect: "16:9" },
    });
    expect(toShortProjectSettings(updated)).toEqual(settings);
  });

  it("rejects missing required fields, invalid duration/scene count, and unknown fields", () => {
    expect(() => parseShortProjectSettings({ ...settings, projectName: "" })).toThrow();
    expect(() => parseShortProjectSettings({ ...settings, durationSeconds: 0 })).toThrow();
    expect(() => parseShortProjectSettings({ ...settings, sceneCount: 5 })).toThrow();
    expect(() => parseShortProjectSettings({ ...settings, unexpected: true })).toThrow();
    expect(() => parseShortProjectSettings({ ...settings, styleNotes: { unknown: "x" } })).toThrow();
  });

  it("trims strings and omits blank optional style entries", () => {
    const parsed = parseShortProjectSettings({
      ...settings,
      projectName: "  별의 지도  ",
      topic: "  별을 찾는 아이  ",
      styleNotes: { lighting: "  달빛  ", color: "  " },
    });
    expect(parsed.projectName).toBe("별의 지도");
    expect(parsed.topic).toBe("별을 찾는 아이");
    expect(parsed.styleNotes).toEqual({ lighting: "달빛" });
  });
});
