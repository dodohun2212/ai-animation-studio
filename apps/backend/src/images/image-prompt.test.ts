import { describe, expect, it } from "vitest";
import { NO_LEGIBLE_TEXT_RULE, imagePromptDrift, imagePromptFor, imagePromptForRequest } from "./image-prompt.js";

const scene = { visual_action: "walks toward the gate", start_motion: "stands still at the door, facing it", shot_size: "", camera_angle: "", composition: "", lens_feel: "", focus_subject: "" };

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

/**
 * The picture is the first frame Runway is handed, and `promptFor` says so in the request's own first line
 * ("from the supplied exact first frame") before naming what it shows (`Starts at: {start_motion}`). Drawing it
 * from `visual_action` — the scene's whole action — meant the app told Runway "this is the beginning" while
 * handing it the end, and the clip had nothing to do for five seconds. Found by opening 캡틴D's 꽃말_해바라기
 * reel frame by frame: scene 2's still already had both cotyledons up, and scene 2's clip ended where it began.
 */
describe("the still is the scene's first frame, not its finished action", () => {
  it("draws the start, not the whole action", () => {
    const built = imagePromptFor(scene, "");

    expect(built).toContain("Scene: stands still at the door, facing it");
    expect(built, "the completed action belongs to the clip, not to its first frame").not.toContain("walks toward the gate");
  });

  /**
   * 🔴 One request must not hold two orders. Sending both fields would say "the action is X, now draw the moment
   * before X", which is the shape this repository already paid for — the flower prompt that forbade people four
   * lines before demanding a 대표 캐릭터. The subject survives because focus_subject and composition carry it.
   */
  it("replaces rather than adds, so the frame is described once", () => {
    const lines = imagePromptFor({ ...scene, focus_subject: "the gate" }, "").split("\n");

    expect(lines.filter((line) => line.startsWith("Scene: ")), "exactly one Scene line").toHaveLength(1);
    expect(lines).toContain("Focus: the gate");
  });
});

/**
 * The half that protects every picture already on disk.
 *
 * Measured before it was written: 20 recorded image prompts across 5 projects on this machine, and all 20 open
 * with `Scene: {visual_action}`. The badge asks whether the *scene* changed since the picture was made, and for
 * every one of those the answer is no — a person edited nothing; the builder moved.
 */
describe("a picture made by the older builder is not blamed on its scene", () => {
  const legacyRecord = (subject: unknown) => imagePromptFor(subject, "").replace(
    "Scene: stands still at the door, facing it", "Scene: walks toward the gate");

  it("reads a pre-2026-09-11 record as current, not as a scene edit", () => {
    expect(imagePromptDrift(legacyRecord(scene), scene, "")).toBe("current");
  });

  it("still reports an edit to the field that picture was actually drawn from", () => {
    const edited = { ...scene, visual_action: "turns back from the gate" };

    expect(imagePromptDrift(legacyRecord(scene), edited, "")).toBe("scene");
  });

  /**
   * 🔴 The blind spot, asserted so it is a known shape rather than a surprise.
   *
   * A pre-2026-09-11 record does not contain `start_motion` anywhere — the builder never wrote it — so editing
   * only that field leaves nothing in the record to compare against, and this reports 「current」 for a picture
   * that a regeneration genuinely would change.
   *
   * Kept rather than closed, because the alternative is worse in the direction that costs money: reporting all
   * 20 existing records as 「장면 내용이 바뀐 뒤로」 sends someone to redraw 20 pictures whose scenes nobody
   * touched. This blind spot needs a legacy record AND a start_motion-only edit, and it closes permanently the
   * first time that scene's picture is regenerated.
   */
  it("cannot see a start_motion-only edit on a legacy record, because that record never held the field", () => {
    const edited = { ...scene, start_motion: "already through the gate, walking away" };

    expect(imagePromptDrift(legacyRecord(scene), edited, "")).toBe("current");
    expect(imagePromptDrift(imagePromptFor(scene, ""), edited, ""), "and a record written by today's builder does see it").toBe("scene");
  });

  it("does not swallow a change to any other line", () => {
    const recomposed = { ...scene, focus_subject: "the lock" };

    expect(imagePromptDrift(legacyRecord(scene), recomposed, "")).toBe("scene");
  });

  it("leaves the style arm alone, which answers a different question", () => {
    expect(imagePromptDrift(imagePromptFor(scene, "Style: ink"), scene, "Style: wash")).toBe("style");
  });
});
