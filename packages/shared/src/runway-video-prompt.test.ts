import { describe, expect, it } from "vitest";
import {
  NO_LEGIBLE_TEXT_VIDEO_RULE,
  RUNWAY_PROMPT_AUTHORING_LIMIT,
  RUNWAY_PROMPT_MAX_LENGTH,
  runwayVideoPromptText,
  runwayVideoTextRuleFor,
} from "./domain.js";

describe("Runway prompt composition", () => {
  it("returns and composes the model-specific suffix the provider adapter sends", () => {
    const authored = "  A fox walks through a snowy forest.  ";
    const seedance = "seedance2_720p" as const;

    expect(runwayVideoTextRuleFor("gen4_turbo")).toBe(NO_LEGIBLE_TEXT_VIDEO_RULE);
    expect(runwayVideoPromptText(authored, "gen4_turbo"))
      .toBe(`${authored.trim()}\n${NO_LEGIBLE_TEXT_VIDEO_RULE}`);
    expect(runwayVideoPromptText(authored, seedance))
      .toBe(`${authored.trim()}\nAvoid generating subtitles, logos, watermarks or any readable text.`);
  });

  it("keeps the longest accepted authored prompt within the provider limit for every model", () => {
    const authored = "x".repeat(RUNWAY_PROMPT_AUTHORING_LIMIT);
    for (const model of ["gen4_turbo", "seedance2_720p"] as const) {
      expect(runwayVideoPromptText(authored, model).length).toBeLessThanOrEqual(RUNWAY_PROMPT_MAX_LENGTH);
    }
  });
});
