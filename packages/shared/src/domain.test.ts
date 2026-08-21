import { describe, expect, it } from "vitest";

import { assertExactlySixScenes, type Scene } from "./domain.js";

function scenes(): Scene[] {
  return [1, 2, 3, 4, 5, 6].map((number) => ({
    number: number as Scene["number"],
    script: `Scene ${number}`,
    imagePrompt: `Image ${number}`,
    motionPrompt: `Motion ${number}`,
    imageReview: "pending",
    videoReview: "pending",
  }));
}

describe("scene validation", () => {
  it("accepts exactly six ordered scenes", () => {
    expect(() => assertExactlySixScenes(scenes())).not.toThrow();
  });

  it("rejects missing or incorrectly ordered scenes", () => {
    expect(() => assertExactlySixScenes(scenes().slice(0, 5))).toThrow();
    const unordered = scenes();
    unordered[1] = { ...unordered[1]!, number: 3 };
    expect(() => assertExactlySixScenes(unordered)).toThrow();
  });
});
