import { describe, expect, it } from "vitest";

import { LONG_EPISODE_OPTIONAL_FIELD_KEYS, longEpisodeFieldGroups, SCENE_FIELD_GROUPS, SCENE_FIELD_KEYS, videoRatioLabel } from "./sceneFields.js";

/**
 * Every field on LongEpisodeScene (packages/shared/src/api.ts), which is also the list the long Episode's
 * stored script is validated against. Written out rather than derived: the point of this test is to fail when
 * the two sides drift, and a derived list would drift with them. `narration` is on this list even though the
 * contract types it optional — the question here is which keys exist, not which are required.
 */
const LONG_EPISODE_SCENE_FIELDS = [
  "description",
  "narration",
  "visualAction",
  "startMotion",
  "mainMotion",
  "endMotion",
  "shotSize",
  "cameraAngle",
  "composition",
  "lensFeel",
  "focusSubject",
  "cameraMotion",
  "environmentMotion",
  "motionSpeed",
  "motionIntensity",
  "expressionChange",
  "continuityHint",
];

describe("sceneFields", () => {
  it("covers every long Episode script field exactly once, with nothing left over", () => {
    // The short project and long Episodes were built separately and their screens drifted apart. This is the
    // pin that says they describe the same scene: if either side gains or renames a field, this fails.
    const mapped = longEpisodeFieldGroups().flatMap((group) => group.fields.map((field) => field.key));

    expect([...mapped].sort()).toEqual([...LONG_EPISODE_SCENE_FIELDS].sort());
    expect(mapped.length).toBe(new Set(mapped).size);
  });

  it("gives long Episodes narration too, but only as a field their stored scripts may omit", () => {
    // Narration used to be short-project-only, and this test used to assert its absence. It is now on both
    // sides — but every Episode script written before the field existed has no such key, so anything reading a
    // stored script must accept "absent or string". A required narration here would reject those scripts and
    // lock the user out of Episodes they already wrote.
    const longFields = longEpisodeFieldGroups().flatMap((group) => group.fields);

    expect(longFields.map((field) => field.key)).toContain("narration");
    expect(longFields.find((field) => field.key === "narration")?.optional).toBe(true);
    expect(LONG_EPISODE_OPTIONAL_FIELD_KEYS).toEqual(["narration"]);
    // Nothing else may be optional by accident — every other field is required and a typo in `longOptional`
    // would silently widen what a malformed script is allowed to look like.
    expect(longFields.filter((field) => field.optional).map((field) => field.key)).toEqual(["narration"]);
    // The group is now rendered rather than dropped.
    expect(longEpisodeFieldGroups().map((group) => group.title)).toContain("내레이션 문장");
  });

  it("states an impact for every group and marks only the free one as free", () => {
    // A group with no stated impact would put an edit button in front of the user with no warning about what
    // it costs — the exact failure this grouping exists to prevent.
    for (const group of SCENE_FIELD_GROUPS) {
      expect(group.impact.length).toBeGreaterThan(0);
    }
    const free = SCENE_FIELD_GROUPS.filter((group) => group.free).map((group) => group.title);
    expect(free).toEqual(["화면 대본"]);
  });

  it("names the video ratio in the shape the user chose, keeping the exact value too", () => {
    // "720:1280" is what Runway wants; "9:16" is what the person picked in settings. Showing only the former
    // makes a wrong orientation impossible to notice before paying for six clips.
    expect(videoRatioLabel("720:1280")).toBe("세로형 9:16 (720:1280)");
    expect(videoRatioLabel("1280:720")).toBe("가로형 16:9 (1280:720)");
    // An unfamiliar value is passed through rather than mislabelled as one of the two known shapes.
    expect(videoRatioLabel("1024:1024")).toBe("1024:1024");
  });

  it("uses distinct short keys and never reuses one across groups", () => {
    expect(SCENE_FIELD_KEYS.length).toBe(new Set(SCENE_FIELD_KEYS).size);
    // Now equal, not off by one: both sides carry the same seventeen fields since narration crossed over.
    expect(SCENE_FIELD_KEYS.length).toBe(LONG_EPISODE_SCENE_FIELDS.length);
  });
});
