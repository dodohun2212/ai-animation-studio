import { describe, expect, it } from "vitest";
import { RUNWAY_CLIP_DURATIONS, VIDEO_SECOND_ESTIMATED_COST_USD, videoModelOption, videoSceneEstimatedCostUsd } from "./domain.js";

describe("what one generated scene is quoted at", () => {
  /**
   * A 10-second project buys twice the video. It used to be quoted the same price.
   *
   * `VIDEO_SCENE_ESTIMATED_COST_USD` was flat at $0.25 while RUNWAY_CLIP_DURATIONS has always offered 5 and 10,
   * and the number fed the preflight that decides whether to spend, the confirmation panel, the preview, the
   * retry notice and the workflow guide. Ten-second projects exist on this machine.
   */
  it("doubles with the clip length, because that is what is being bought", () => {
    expect(videoSceneEstimatedCostUsd(5), "unchanged from the flat number it replaces").toBe(0.25);
    expect(videoSceneEstimatedCostUsd(10)).toBe(0.5);
  });

  /** Every length the app offers has to be priced — a duration with no price is a duration quoted at nothing. */
  it("prices every clip length the app lets someone choose", () => {
    for (const seconds of RUNWAY_CLIP_DURATIONS) {
      expect(videoSceneEstimatedCostUsd(seconds), `${seconds}s`).toBeCloseTo(seconds * VIDEO_SECOND_ESTIMATED_COST_USD, 8);
      expect(videoSceneEstimatedCostUsd(seconds)).toBeGreaterThan(0);
    }
  });

  /**
   * Rounded to cents, and never below the true rate for the lengths that exist.
   *
   * Quoting money low is the one direction this must never be wrong in — local-video-workflow.service.ts says
   * so about the same number. Rounding is what would do it silently.
   */
  it("never rounds a quote below the per-second rate", () => {
    for (const seconds of RUNWAY_CLIP_DURATIONS) {
      expect(videoSceneEstimatedCostUsd(seconds)).toBeGreaterThanOrEqual(seconds * VIDEO_SECOND_ESTIMATED_COST_USD);
    }
  });
});

describe("pricing a model the contract has not heard of", () => {
  /**
   * Found by Cowork's own card pair, and it was a real hole.
   *
   * Given an id it does not list, this used to fall back to the first option and quote that model's rate — so a
   * picker showing a second model priced every row at the default's $0.05. That is precisely the failure the
   * whole shape exists to prevent: a price that does not move with the model. Answering about a different model
   * is worse than the flat constant this replaced, because it looks like it moved.
   */
  it("prices an option from the option, not from whatever the contract happens to list first", () => {
    const hypothetical = { id: "gen4_turbo" as const, label: "Later", pricePerSecondUsd: 0.12, ratios: ["720:1280"], maxDurationSeconds: 10, acceptsLastFrame: false, frameShape: "requested" as const };

    expect(videoSceneEstimatedCostUsd(5, hypothetical), "its own rate").toBe(0.6);
    expect(videoSceneEstimatedCostUsd(10, hypothetical)).toBe(1.2);
    expect(videoSceneEstimatedCostUsd(5, "gen4_turbo"), "and a listed name still prices from the list").toBe(0.25);
  });

  /*
   * 🔴 Two charges that "seconds × rate" cannot state, and the order they combine in (Cowork Round 771/772). Nothing
   * in today's catalogue has a per-generation charge, and none has both, so these use hypothetical options — the
   * order has to be fixed before the first model that needs it, not discovered by it.
   */
  const base = { id: "gen4_turbo" as const, label: "Hypothetical", ratios: ["720:1280"], maxDurationSeconds: 15, acceptsLastFrame: false, frameShape: "requested" as const };

  it("adds a per-generation charge once, never multiplied by the length", () => {
    const perGeneration = { ...base, pricePerSecondUsd: 0.1, perGenerationUsd: 0.01 };
    expect(videoSceneEstimatedCostUsd(5, perGeneration)).toBe(0.51);
    expect(videoSceneEstimatedCostUsd(10, perGeneration) - videoSceneEstimatedCostUsd(5, perGeneration), "five more seconds cost five seconds").toBeCloseTo(0.5, 8);
    expect(videoSceneEstimatedCostUsd(10, perGeneration)).not.toBe(2 * videoSceneEstimatedCostUsd(5, perGeneration));
  });

  it("quotes the minimum for a clip short enough to fall under it, and the seconds above it", () => {
    const minimum = { ...base, pricePerSecondUsd: 0.16, minimumChargeUsd: 0.64 };
    expect(videoSceneEstimatedCostUsd(3, minimum), "3 s × $0.16 is $0.48, billed at $0.64").toBe(0.64);
    expect(videoSceneEstimatedCostUsd(5, minimum)).toBe(0.8);
  });

  it("bounds only the seconds by the minimum, then adds the per-generation charge, so neither swallows the other", () => {
    const both = { ...base, pricePerSecondUsd: 0.16, minimumChargeUsd: 0.64, perGenerationUsd: 0.01 };
    expect(videoSceneEstimatedCostUsd(3, both), "max(0.48, 0.64) + 0.01 — not max(0.49, 0.64)").toBe(0.65);
  });

  it("prices the catalogue's own minimums: Seedance 2.0 Mini and 2.5 clear them at five seconds", () => {
    expect(videoSceneEstimatedCostUsd(5, "seedance2_mini")).toBe(0.8);
    expect(videoSceneEstimatedCostUsd(3, "seedance2_mini"), "and would be billed the $0.64 minimum below it").toBe(0.64);
    expect(videoSceneEstimatedCostUsd(3, "seedance2_5_480p")).toBe(0.8);
  });

  it("quotes the catalogue's per-scene charges once: Gemini Omni Flash and Grok bill the first-frame image", () => {
    expect(videoSceneEstimatedCostUsd(5, "gemini_omni_flash"), "10 credits/s x 5 + 1 credit").toBe(0.51);
    expect(videoSceneEstimatedCostUsd(10, "gemini_omni_flash")).toBe(1.01);
    expect(videoSceneEstimatedCostUsd(5, "grok_imagine_1080p"), "29 credits/s x 5 + 1 credit").toBe(1.46);
  });

  it("refuses a model name it does not list, instead of quoting the cheapest model", () => {
    expect(() => videoSceneEstimatedCostUsd(5, "gen4.5")).toThrow();
    expect(() => videoModelOption("seedance")).toThrow();
  });
});
