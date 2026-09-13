import { describe, expect, it } from "vitest";

import { CLIP_DURATION_CHOICES, CLIP_DURATION_LIMITS, clipDurationSecondsPerScene, isClipDurationSeconds, RUNWAY_CLIP_DURATIONS, VIDEO_MODEL_OPTIONS, videoModelTakesDuration, videoSceneEstimatedCostUsd } from "./index.js";

/**
 * How long one scene's clip is, for an Episode that only stores its total — and therefore what it costs.
 *
 * Two Episode services each wrote this expression out, one with a comment saying it matched the other. Runway
 * bills by the second, so the halves that would disagree after a single edit are the price shown before the
 * button and the length actually sent to the provider.
 */
describe("one scene's clip length, derived from an Episode's total", () => {
  it("gives back the Episode's own whole length when its total divides evenly (B1-b)", () => {
    // An Episode saved since per-Episode settings stores sceneCount × clipDurationSeconds, so this is exact.
    for (const [total, scenes, expected] of [[30, 6, 5], [60, 6, 10], [42, 6, 7], [90, 6, 15], [180, 6, 30], [6, 6, 1], [120, 12, 10]] as const) {
      expect(clipDurationSecondsPerScene(total, scenes), `${total}/${scenes}`).toBe(expected);
    }
  });

  it("gives an older Episode whose total does not divide evenly one of the two lengths it was quoted under", () => {
    // Never something in between: a fraction reaches the adapter as a duration the provider rejects, after the
    // preflight has already quoted it. Nor a whole number past the limits, which no model makes.
    for (const [total, scenes] of [[45, 6], [44, 6], [10, 6], [200, 6]] as const) {
      expect(RUNWAY_CLIP_DURATIONS, `${total}/${scenes}`).toContain(clipDurationSecondsPerScene(total, scenes));
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

/*
 * A short project's scene length (B1): a whole number of seconds within CLIP_DURATION_LIMITS, which is exactly the
 * union of the catalogue models' own ranges — so no model's range pokes outside what a setting may hold, and the
 * limits are not wider than any model can use.
 */
describe("scene lengths the models make", () => {
  it("gives every model a whole-second range inside the limits, and the limits are exactly their union", () => {
    for (const option of VIDEO_MODEL_OPTIONS) {
      expect(Number.isInteger(option.minDurationSeconds) && Number.isInteger(option.maxDurationSeconds), option.id).toBe(true);
      expect(option.minDurationSeconds, option.id).toBeGreaterThanOrEqual(CLIP_DURATION_LIMITS.min);
      expect(option.maxDurationSeconds, option.id).toBeLessThanOrEqual(CLIP_DURATION_LIMITS.max);
      expect(option.minDurationSeconds, option.id).toBeLessThanOrEqual(option.maxDurationSeconds);
    }
    expect(Math.min(...VIDEO_MODEL_OPTIONS.map((option) => option.minDurationSeconds))).toBe(CLIP_DURATION_LIMITS.min);
    expect(Math.max(...VIDEO_MODEL_OPTIONS.map((option) => option.maxDurationSeconds))).toBe(CLIP_DURATION_LIMITS.max);
  });

  it("accepts whole seconds inside the limits only", () => {
    for (const value of [1, 5, 7, 15, 30]) expect(isClipDurationSeconds(value), String(value)).toBe(true);
    for (const value of [0, 7.5, 31, "5", null]) expect(isClipDurationSeconds(value), String(value)).toBe(false);
    for (const value of CLIP_DURATION_CHOICES) expect(isClipDurationSeconds(value), String(value)).toBe(true);
  });

  it("asks each model for its own range, at both ends", () => {
    const h3 = VIDEO_MODEL_OPTIONS.find((option) => option.id === "h3_max_768p")!;
    expect([4, 5, 15, 16].map((seconds) => videoModelTakesDuration(h3, seconds))).toEqual([false, true, true, false]);
    const gen4 = VIDEO_MODEL_OPTIONS.find((option) => option.id === "gen4_turbo")!;
    expect([1, 2, 10, 11].map((seconds) => videoModelTakesDuration(gen4, seconds))).toEqual([false, true, true, false]);
  });
});
