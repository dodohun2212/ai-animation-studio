import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";
import { describe, expect, it } from "vitest";

import { imagePromptFor } from "../images/image-prompt.js";
import { SCENE_FIELDS } from "../videos/video-preview.service.js";
import { STORY_SCENE_FIELDS } from "./openai-story-adapter.js";
import { CLIP_DURATION_PLACEHOLDER, FIRST_FRAME_IS_START_MOTION_RULE, NO_TEXT_AS_EVENT_RULE, ONE_PACE_ACROSS_A_PROCESS_RULE, ONE_PACE_RULE, SUBJECT_SURVIVES_RULE, shotBudgetRule } from "./motion-field-rules.js";

/**
 * Two prompts ask for the same eighteen scene fields, and only one of them is a file.
 *
 * Episode 6 scene 6 failed at Runway on 2026-09-06 because nothing told the model how long the shot it was
 * writing would be, or that the video request would demand the subject survive it. The first fix went into
 * prompts/story/story_generation.txt — which a long project's Episode does not read. The place that was fixed
 * and the place that broke were different ones, and the whole suite was green either way.
 *
 * The service now builds its lines from motion-field-rules.ts, so that half cannot drift. This pair is the other
 * half: a .txt cannot import a constant, but it can be held to one. Editing either sentence in one place only
 * turns this red.
 */
describe("the motion-field rules both script prompts carry", () => {
  async function template(): Promise<string> {
    const repositoryRoot = url.fileURLToPath(new URL("../../../../", import.meta.url));
    return fsPromises.readFile(path.join(repositoryRoot, "prompts", "story", "story_generation.txt"), "utf8");
  }

  it("states the shot budget in the story template in the same words the Episode prompt uses", async () => {
    // The template writes the placeholder where the service interpolates a number, so one is rendered from the
    // other rather than compared with the seconds cut out — a comparison that ignored the length would not
    // notice the length going missing.
    const expected = shotBudgetRule(5).replace("5초", CLIP_DURATION_PLACEHOLDER + "초");

    expect(await template()).toContain(expected);
  });

  it("states the identity rule in the story template in the same words the Episode prompt uses", async () => {
    expect(await template()).toContain(SUBJECT_SURVIVES_RULE);
  });

  /**
   * These two were bought on 2026-09-05 — a scene refused twice for $0.50 because readable writing was its
   * event, and Episode 5 scene 6 blowing out to white at 3.7s because its pace changed mid-shot — and the fix
   * went into the Episode prompt only. A short project could still write either of them, on the same video
   * model, for the same money. Nothing said so, because nothing compared the two prompts.
   */
  it("states the pace rule and the no-text-as-event rule in the story template too", async () => {
    const rendered = await template();

    expect(rendered).toContain(ONE_PACE_RULE);
    expect(rendered).toContain(NO_TEXT_AS_EVENT_RULE);
  });

  /**
   * The two added on 2026-09-11 with the image builder that draws a scene's still from start_motion.
   *
   * They are here for the same reason as the four above: an Episode reads none of this template, and a rule put
   * in only one of the two prompts is a rule half the app does not have.
   */
  it("states the first-frame rule and the one-pace-across-a-process rule in both prompts", async () => {
    const rendered = await template();

    expect(rendered).toContain(FIRST_FRAME_IS_START_MOTION_RULE);
    expect(rendered).toContain(ONE_PACE_ACROSS_A_PROCESS_RULE);
  });

  /**
   * 🔴 The first-frame rule is a claim about another file, so it is checked against that file rather than
   * trusted. It says start_motion is what gets drawn; image-prompt.ts is what draws it. If that builder ever
   * goes back to another field, this sentence becomes a lie told to the model that writes the scene, and a lie
   * in a prompt costs a paid image and then a paid clip built on it.
   */
  it("is telling the truth about which field the image builder draws", () => {
    const scene = { visual_action: "the whole action, finished", start_motion: "the first moment, still" };

    expect(imagePromptFor(scene, "")).toContain("Scene: the first moment, still");
    expect(FIRST_FRAME_IS_START_MOTION_RULE).toContain("start_motion");
  });

  /** Both rules are about the motion fields, so both must name them — a rule that names nothing is advice. */
  it("names the fields it governs", () => {
    for (const field of ["start_motion", "main_motion", "end_motion", "camera_motion", "environment_motion"]) {
      expect(shotBudgetRule(5)).toContain(field);
    }
    expect(SUBJECT_SURVIVES_RULE).toContain("움직임 항목");
    expect(SUBJECT_SURVIVES_RULE).toContain("description");
  });
});

/**
 * The three lists of scene field names, which have to agree because the same scene travels through all three.
 *
 * STORY_SCENE_FIELDS is what the model is required to return. SCENE_FIELDS is what the video prompt reads and
 * what both video paths validate against. They differ by exactly one name — narration, which only narration/TTS
 * uses — and that difference is a decision, not drift. Stating it here means adding a field to one list and not
 * the other stops being silent: today it would have left a scene passing validation with a field the video
 * prompt then renders empty.
 */
describe("the scene field lists the pipeline shares", () => {
  it("differ from each other by narration and nothing else", () => {
    const story = [...STORY_SCENE_FIELDS] as string[];
    const video = [...SCENE_FIELDS] as string[];

    expect(story.filter((field) => !video.includes(field))).toEqual(["narration"]);
    expect(video.filter((field) => !story.includes(field))).toEqual([]);
  });
});
