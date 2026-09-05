import { describe, expect, it } from "vitest";

import { clipDurationSecondsPerScene, RUNWAY_CLIP_DURATIONS, videoSceneEstimatedCostUsd } from "./index.js";

/**
 * How long one scene's clip is, for an Episode that only stores its total — and therefore what it costs.
 *
 * Two Episode services each wrote this expression out, one with a comment saying it matched the other. Runway
 * bills by the second, so the halves that would disagree after a single edit are the price shown before the
 * button and the length actually sent to the provider.
 */
describe("one scene's clip length, derived from an Episode's total", () => {
  it("gives back one of the two lengths Runway offers, never something in between", () => {
    // A number that is neither 5 nor 10 reaches the adapter as a duration Runway rejects, after the preflight
    // has already quoted it.
    for (const [total, scenes] of [[30, 6], [60, 6], [45, 6], [44, 6], [120, 12], [10, 6]] as const) {
      expect(RUNWAY_CLIP_DURATIONS).toContain(clipDurationSecondsPerScene(total, scenes));
    }
  });

  it("rounds to the nearer of the two, so exactly 7.5 seconds a scene is a ten", () => {
    // Not a floor. An Episode at 45/6 is closer to ten than to five, and quoting five would price a clip
    // shorter than the one being made — money quoted low, the one direction this must never be wrong in.
    expect(clipDurationSecondsPerScene(45, 6)).toBe(10);
    expect(clipDurationSecondsPerScene(44, 6)).toBe(5);
  });

  it("carries straight through to what a scene is quoted at", () => {
    // The reason this lives in the contract rather than in either service: the length is the price.
    expect(videoSceneEstimatedCostUsd(clipDurationSecondsPerScene(60, 6))).toBe(0.5);
    expect(videoSceneEstimatedCostUsd(clipDurationSecondsPerScene(30, 6))).toBe(0.25);
  });
});
