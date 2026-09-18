import { describe, expect, it } from "vitest";

import { PROJECT_LOCKED_MESSAGE } from "./projectLockedError.js";
import { ImageGenerationApiError, toImageGenerationDisplayError } from "./imageGenerationApi.js";
import { ImageReviewApiError, toImageReviewDisplayError } from "./imageReviewApi.js";
import { LongProjectsApiError, toLongProjectDisplayError } from "./longProjectsApi.js";
import { NarrationApiError, toNarrationDisplayError } from "./narrationApi.js";
import { StoryPromptApiError, toStoryDisplayError } from "./storyPromptApi.js";
import { VideoWorkflowApiError, toVideoWorkflowDisplayError } from "./videoWorkflowApi.js";

/**
 * The pair that holds one code to one sentence across every module that renders it.
 *
 * 🔴 This is not a tidiness test. The copies had already drifted: five modules said 「이 프로젝트에서 다른 작업이
 * 진행 중입니다」 and `videoWorkflowApi.ts` said 「다른 창에서」 — a claim about the reader's browser that the
 * lock cannot support, since its usual holder is a timer tick inside the one window they have open
 * (`project-lock.ts`, docs/06_DECISIONS.md D-005). Nobody wrote that difference on purpose; it is what six
 * hand-typed copies of one sentence turn into. A test that reads each module's own output is the only thing
 * that notices the seventh copy going in slightly different.
 *
 * 🟠 Deliberately asserted through each module's public display-error mapper rather than by importing the
 * tables. A table entry that exists but never gets reached says the right thing to nobody, and that is a real
 * failure mode here: `PROJECT_LOCKED` arrives on codes these modules did not originally list, which is how it
 * used to land in the unknown-error fallback (imageReviewApi's own pair records that).
 */
const RENDERERS: Array<{ module: string; render: () => { code: string; message: string } }> = [
  { module: "imageGenerationApi", render: () => toImageGenerationDisplayError(new ImageGenerationApiError("PROJECT_LOCKED", "raw backend detail")) },
  { module: "imageReviewApi", render: () => toImageReviewDisplayError(new ImageReviewApiError("PROJECT_LOCKED", "raw backend detail")) },
  { module: "longProjectsApi", render: () => toLongProjectDisplayError(new LongProjectsApiError("PROJECT_LOCKED", "raw backend detail")) },
  { module: "narrationApi", render: () => toNarrationDisplayError(new NarrationApiError("PROJECT_LOCKED", "raw backend detail")) },
  { module: "storyPromptApi", render: () => toStoryDisplayError(new StoryPromptApiError("PROJECT_LOCKED", "raw backend detail")) },
  /* 🔴 The sixth — the copy that had drifted. Cowork left this module alone in Round 920 because CLI was
     inside the file at the time; it joins here with the line that replaced 「다른 창에서」, so the pair now
     covers the module the whole finding came from rather than only the five that agreed. */
  { module: "videoWorkflowApi", render: () => toVideoWorkflowDisplayError(new VideoWorkflowApiError("PROJECT_LOCKED", "raw backend detail")) },
];

describe("PROJECT_LOCKED is one sentence everywhere it is shown", () => {
  it.each(RENDERERS)("$module renders the shared sentence", ({ render }) => {
    const displayed = render();

    expect(displayed.code).toBe("PROJECT_LOCKED");
    expect(displayed.message).toBe(PROJECT_LOCKED_MESSAGE);
  });

  it.each(RENDERERS)("$module never falls through to the unknown-error fallback", ({ render }) => {
    expect(render().code).not.toBe("CLIENT_UNKNOWN_ERROR");
  });

  it.each(RENDERERS)("$module never surfaces the backend's raw message", ({ render }) => {
    expect(render().message).not.toContain("raw backend detail");
  });

  /*
   * The half of the sentence that is about money, asserted on the constant so it holds for every module at once.
   * The generic fallback this code replaces says 「잠시 후 다시 시도해 주세요」, and here that means "send the
   * second request the lock exists to refuse" — the one that was charged twice on 2026-09-05 (D-010). A wording
   * change that quietly restores "retry" would pass every other test in this file.
   */
  it("tells the reader not to press again, and never suggests retrying", () => {
    expect(PROJECT_LOCKED_MESSAGE).toContain("다시 누르지 마세요");
    expect(PROJECT_LOCKED_MESSAGE).not.toContain("다시 시도");
  });

  /*
   * 🔴 Pins the removed claim, not the kept wording. 「다른 창에서」 sent a person looking for a second tab that
   * usually does not exist — the lock is held by a timer tick, a concurrent poll, or two backend processes
   * overlapping across a watch-restart, all of which happen with one window open. The server's own message says
   * "Another process" (`video-workflow-api.error.ts:49`); only the translation invented the window. Asserted as
   * an absence because that is what regressed: someone rewriting this sentence reaches for the concrete image
   * first, and the concrete image is the false one.
   */
  it("does not tell the reader another window is responsible", () => {
    expect(PROJECT_LOCKED_MESSAGE).not.toContain("창");
  });

  /*
   * Not-pressing has to read as "this finishes on its own", or it reads as "you are stuck" — and a person who
   * believes they are stuck reloads and presses anyway, which is the same second request by another route.
   */
  it("says the wait resolves itself", () => {
    expect(PROJECT_LOCKED_MESSAGE).toContain("자동으로 반영됩니다");
  });
});
