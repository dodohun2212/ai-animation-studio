import { describe, expect, it } from "vitest";

import { DEFAULT_SCENE_COUNT, MAX_SCENE_COUNT, MIN_SCENE_COUNT, sceneNumbersFor } from "./domain.js";

/**
 * The count a record that does not say is assumed to have.
 *
 * A short project whose stored count fails validation and an Episode written before `scene_count` existed both
 * fall back to it, and each had written the number down for itself. What that pair of copies risks is not a
 * disagreement about six — it is a default that stops being a legal count while both bounds move without it.
 */
describe("the scene count a record that does not say has", () => {
  it("stays inside the bounds every other count is checked against", () => {
    // A default outside them is a project that cannot be opened: the fallback itself would fail the validation
    // that sent us to the fallback.
    expect(DEFAULT_SCENE_COUNT).toBeGreaterThanOrEqual(MIN_SCENE_COUNT);
    expect(DEFAULT_SCENE_COUNT).toBeLessThanOrEqual(MAX_SCENE_COUNT);
  });

  it("numbers its scenes 1..n like any other count", () => {
    expect(sceneNumbersFor(DEFAULT_SCENE_COUNT)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
