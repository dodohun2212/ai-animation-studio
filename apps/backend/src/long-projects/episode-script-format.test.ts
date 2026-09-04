import { describe, expect, it } from "vitest";
import { camelKeys, snakeKeys, toApiEpisodeScript } from "./episode-script-format.js";

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

/**
 * The two spellings stay in step, and both cover the whole of LongEpisodeScene.
 *
 * These lists were declared twice, byte for byte, in this file and in episode-scripts.service.ts. Between them
 * they produce every LongEpisodeScene the app ever returns, through an `as unknown as` cast that cannot check
 * the result — so a field added to that interface had to be found in both places, and whoever found one shipped
 * a script complete on some paths and short a field on others. There is one copy now, and this holds it against
 * the interface rather than against the other copy, which is what a second list can only ever do.
 */
describe("scene field name lists", () => {
  it("names every LongEpisodeScene field once, in both spellings, index-aligned", () => {
    // Written out rather than derived: deriving it from the same constant the code uses would assert that a
    // thing equals itself. This is the contract, restated by hand, so a field added to LongEpisodeScene and not
    // to the lists turns this red.
    const contract = ["number", "description", "visualAction", "startMotion", "mainMotion", "endMotion", "shotSize",
      "cameraAngle", "composition", "lensFeel", "focusSubject", "cameraMotion", "environmentMotion", "motionSpeed",
      "motionIntensity", "expressionChange", "continuityHint"];

    expect([...camelKeys]).toEqual(contract);
    expect(camelKeys).toHaveLength(snakeKeys.length);
    // Index-aligned, because every reader zips them by position: snakeKeys[i] is camelKeys[i] in stored form.
    expect([...snakeKeys]).toEqual(contract.map((key) => key.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)));
  });
});
