import { describe, expect, it } from "vitest";
import { toApiEpisodeScript } from "./episode-script-format.js";

const scene = (overrides: Record<string, unknown> = {}) => ({
  number: 1, description: "d", visual_action: "v", start_motion: "s", main_motion: "m", end_motion: "e",
  shot_size: "s", camera_angle: "c", composition: "c", lens_feel: "l", focus_subject: "f", camera_motion: "c",
  environment_motion: "e", motion_speed: "n", motion_intensity: "m", expression_change: "x", continuity_hint: "h",
  ...overrides,
});

describe("toApiEpisodeScript", () => {
  it("returns undefined for an empty or malformed stored script", () => {
    expect(toApiEpisodeScript({})).toBeUndefined();
    expect(toApiEpisodeScript({ title: "t" })).toBeUndefined();
    expect(toApiEpisodeScript(null)).toBeUndefined();
  });

  it("carries a scene's narration through when present, snake_case or camelCase", () => {
    const snakeCase = toApiEpisodeScript({ title: "t", synopsis: "s", ending: "e", scenes: [scene({ narration: "고친 내레이션" })] });
    expect(snakeCase?.scenes[0]?.narration).toBe("고친 내레이션");

    const camelScene = { number: 1, description: "d", visualAction: "v", startMotion: "s", mainMotion: "m", endMotion: "e", shotSize: "s", cameraAngle: "c", composition: "c", lensFeel: "l", focusSubject: "f", cameraMotion: "c", environmentMotion: "e", motionSpeed: "n", motionIntensity: "m", expressionChange: "x", continuityHint: "h", narration: "camel narration" };
    const camelCase = toApiEpisodeScript({ title: "t", synopsis: "s", ending: "e", scenes: [camelScene] });
    expect(camelCase?.scenes[0]?.narration).toBe("camel narration");
  });

  it("omits narration when the stored scene never had it (scripts stored before the field existed)", () => {
    const result = toApiEpisodeScript({ title: "t", synopsis: "s", ending: "e", scenes: [scene()] });
    expect(result?.scenes[0]?.narration).toBeUndefined();
    expect("narration" in result!.scenes[0]!).toBe(false);
  });
});
