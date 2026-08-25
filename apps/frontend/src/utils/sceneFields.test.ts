import { describe, expect, it } from "vitest";

import { longEpisodeFieldGroups, SCENE_FIELD_GROUPS, SCENE_FIELD_KEYS } from "./sceneFields.js";

/**
 * Every field on LongEpisodeScene (packages/shared/src/api.ts), which is also the list the long Episode's
 * stored script is validated against. Written out rather than derived: the point of this test is to fail when
 * the two sides drift, and a derived list would drift with them.
 */
const LONG_EPISODE_SCENE_FIELDS = [
  "description",
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

  it("keeps narration out of long Episodes, which have no narration or subtitles at all", () => {
    const longKeys = longEpisodeFieldGroups().flatMap((group) => group.fields.map((field) => field.key));

    expect(longKeys).not.toContain("narration");
    expect(SCENE_FIELD_KEYS).toContain("narration");
    // The group holding only narration is dropped rather than rendered empty.
    expect(longEpisodeFieldGroups().map((group) => group.title)).not.toContain("내레이션 문장");
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

  it("uses distinct short keys and never reuses one across groups", () => {
    expect(SCENE_FIELD_KEYS.length).toBe(new Set(SCENE_FIELD_KEYS).size);
    expect(SCENE_FIELD_KEYS.length).toBe(LONG_EPISODE_SCENE_FIELDS.length + 1);
  });
});
