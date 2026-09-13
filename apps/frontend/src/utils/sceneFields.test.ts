import { describe, expect, it } from "vitest";

import { longEpisodeFieldGroups, SCENE_FIELD_GROUPS, SCENE_FIELD_KEYS, videoRatioLabel } from "./sceneFields.js";

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
    // Nothing else may be optional by accident — every other field is required and a typo in `longOptional`
    // would silently widen what a malformed script is allowed to look like.
    expect(longFields.filter((field) => field.optional).map((field) => field.key)).toEqual(["narration"]);
    // The group is now rendered rather than dropped.
    expect(longEpisodeFieldGroups().map((group) => group.title)).toContain("내레이션 문장");
  });

  it("states an impact for every group and marks as free exactly the groups that cost nothing", () => {
    // A group with no stated impact would put an edit button in front of the user with no warning about what
    // it costs — the exact failure this grouping exists to prevent.
    for (const group of SCENE_FIELD_GROUPS) {
      expect(group.impact.length).toBeGreaterThan(0);
    }
    // 둘입니다: 화면 대본은 어디에도 안 들어가고, 「쓰이지 않는 메모」는 어떤 프롬프트도 안 읽습니다.
    const free = SCENE_FIELD_GROUPS.filter((group) => group.free).map((group) => group.title);
    expect(free).toEqual(["화면 대본", "쓰이지 않는 메모"]);
  });

  /**
   * 🔴 값이 붙은 짝입니다. 그림은 `start_motion` 에서 그려집니다 — `image-prompt.ts` 가 이미지 프롬프트의
   * `Scene:` 줄을 그 칸으로 씁니다(2026-09-11 에 `visual_action` 에서 옮겨졌습니다). 그런데 이 칸은 「움직임」
   * 무리에 있었고, 그 무리의 설명은 **「이미지는 그대로 쓸 수 있습니다」**였습니다.
   *
   * 2026-09-13 에 Cowork 가 이 무리 나누기를 믿고 그림을 바꾸려 「화면에 보이는 행동」을 고쳤습니다. 그 칸은
   * 아무것도 안 읽고, 그림을 정하는 칸은 안 고쳐졌습니다 — 그림은 그대로 나왔고 하루와 유료 호출이 쌓였습니다.
   *
   * 그래서 이 짝은 **칸이 어느 무리에 있는지**가 아니라 **그 무리가 뭐라고 말하는지**를 봅니다. 옮겨만 놓고
   * 설명을 안 고치면 통과해서는 안 됩니다.
   */
  it("warns that the picture must be remade for the field the picture is drawn from", () => {
    const groupOf = (key: string) => SCENE_FIELD_GROUPS.find((group) => group.fields.some((field) => field.key === key))!;

    const startMotion = groupOf("start_motion");
    expect(startMotion.impact).toContain("이미지를 다시 만들어야");
    expect(startMotion.impact, "그림을 그리는 칸을 두고 그림은 그대로라고 말하면 안 됩니다").not.toContain("이미지는 그대로");
    expect(startMotion.free).toBeFalsy();

    // 같은 무리의 나머지도 그림을 정합니다 — 하나만 맞고 나머지가 틀리면 그것도 거짓말입니다.
    for (const key of ["shot_size", "camera_angle", "composition", "lens_feel", "focus_subject"]) {
      expect(groupOf(key).impact, key).toContain("이미지를 다시 만들어야");
    }

    // 움직임 무리는 여전히 「이미지는 그대로」여야 합니다 — 거기 남은 칸들은 정말로 그림을 안 바꿉니다.
    const mainMotion = groupOf("main_motion");
    expect(mainMotion.impact).toContain("이미지는 그대로");
    expect(mainMotion.fields.some((field) => field.key === "start_motion"), "시작 동작이 여기 남아 있으면 안 됩니다").toBe(false);
  });

  /**
   * 🔴 `visual_action` 은 이미지 프롬프트에도(`image-prompt.ts`) 영상 프롬프트에도(`video-prompt-compiler.ts`
   * 의 Continuity cue · Starts at · Action · Performance · Ends at · Motivated camera · Environment · Pacing)
   * 없습니다. 그런데 제일 비싸 보이는 무리의 **첫 줄**에 있었습니다 — 아무것도 안 하는 칸이, 값이 제일 커
   * 보이는 자리에.
   */
  it("does not charge for a field no prompt reads", () => {
    const group = SCENE_FIELD_GROUPS.find((one) => one.fields.some((field) => field.key === "visual_action"))!;
    expect(group.free).toBe(true);
    expect(group.impact).toContain("읽지 않습니다");
    expect(group.impact, "안 읽는 칸에 재생성 경고를 붙이면 안 됩니다").not.toContain("다시 만들어야 합니다");
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
