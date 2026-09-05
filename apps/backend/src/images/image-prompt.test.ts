import { describe, expect, it } from "vitest";
import { NO_LEGIBLE_TEXT_RULE, imagePromptFor, imagePromptForRequest } from "./image-prompt.js";

const scene = { visual_action: "walks toward the gate", shot_size: "", camera_angle: "", composition: "", lens_feel: "", focus_subject: "" };

describe("what goes to the provider, and what goes on the record", () => {
  /**
   * The provider's two documented causes for a refused clip are text on the input frame and a prompt asking for
   * text. Episode 5 scene 3 met the first — its first frame was a close-up of a tape label — and was refused
   * twice for $0.50. Two scenes that did get through hold a caption board for the whole five seconds.
   */
  it("tells the model not to draw readable writing", () => {
    expect(imagePromptForRequest(scene, "")).toContain(NO_LEGIBLE_TEXT_RULE);
    expect(NO_LEGIBLE_TEXT_RULE.toLowerCase(), "the words the provider's own guidance names").toContain("logos");
  });

  /**
   * And keeps it off the record, which is the half that protects every picture already made.
   *
   * Staleness compares a recorded prompt against a recomputed one, so a constant line added to the record marks
   * every scene ever generated as behind its own script — thirty pictures on this machine, none of them
   * changed. styleStale's own doc comment describes that trap; this is the same trap from the other side.
   */
  it("keeps the rule out of the prompt staleness is measured against", () => {
    const recorded = imagePromptFor(scene, "");
    expect(recorded).not.toContain(NO_LEGIBLE_TEXT_RULE);
    expect(imagePromptForRequest(scene, "").startsWith(recorded), "the record is a prefix of what was sent").toBe(true);
  });

  /** Reference notes were already handled this way; the new rule joins them rather than inventing a second habit. */
  it("adds the rule after the reference notes, not instead of them", () => {
    const sent = imagePromptForRequest(scene, "Style: ink", "References: 주인공");
    expect(sent).toContain("References: 주인공");
    expect(sent).toContain("Style: ink");
    expect(sent.endsWith(NO_LEGIBLE_TEXT_RULE)).toBe(true);
  });
});
