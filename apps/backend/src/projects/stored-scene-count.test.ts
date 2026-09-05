import { describe, expect, it } from "vitest";
import { DEFAULT_SCENE_COUNT, MAX_SCENE_COUNT } from "@ai-animation-studio/shared";

import { storedSceneCount } from "./stored-scene-count.js";

/**
 * How many scenes a stored record has.
 *
 * Seven services wrote this same ternary out, each with its own literal 6. The digit was never the risk — this
 * answer decides how many scenes get walked. A service that answers 6 for a twelve-scene Episode stops halfway
 * and reports the rest as absent; one that answers 12 for a six-scene Episode looks for files nobody made.
 * Seven places deciding that separately is seven chances for two screens to disagree about how long an Episode
 * is.
 */
describe("how many scenes a stored record has", () => {
  it("takes the record at its word when it says", () => {
    expect(storedSceneCount({ scene_count: 12 })).toBe(12);
    expect(storedSceneCount({ scene_count: 2 })).toBe(2);
  });

  it("falls back to the contract's default when the record predates the field", () => {
    // Not a literal here: the default lives beside the bounds every count is checked against, because a
    // fallback outside them fails the same validation that sent us to the fallback.
    expect(storedSceneCount({})).toBe(DEFAULT_SCENE_COUNT);
    expect(storedSceneCount({ scene_count: undefined })).toBe(DEFAULT_SCENE_COUNT);
  });

  it("falls back on anything that is not a whole number, rather than passing it on", () => {
    // A non-integer reaching sceneNumbersFor would build a scene list nothing on disk matches.
    expect(storedSceneCount({ scene_count: "6" })).toBe(DEFAULT_SCENE_COUNT);
    expect(storedSceneCount({ scene_count: 6.5 })).toBe(DEFAULT_SCENE_COUNT);
    expect(storedSceneCount({ scene_count: null })).toBe(DEFAULT_SCENE_COUNT);
  });

  it("does not validate a count it was told, deliberately", () => {
    // Whether a number is allowed is asked where a count is chosen, not where an old record is read. Refusing
    // here would make an out-of-range record unopenable instead of merely wrong.
    expect(storedSceneCount({ scene_count: MAX_SCENE_COUNT + 5 })).toBe(MAX_SCENE_COUNT + 5);
  });
});
