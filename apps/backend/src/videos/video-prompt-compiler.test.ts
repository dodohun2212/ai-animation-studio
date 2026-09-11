import { VIDEO_MODELS } from "@ai-animation-studio/shared";
import { describe, expect, it } from "vitest";

import { compileVideoPrompt, promptFor, STABILITY_RULE, type StoredScene } from "./video-prompt-compiler.js";

/**
 * The pair for the one compile path.
 *
 * Two things are being held down here, and only one of them is about today. The first is that moving the
 * grammar into its own file changed no byte of what Runway is sent — 43 recorded prompts on disk were compiled
 * by the old code, and a prompt that renders differently now reports every one of them as 「장면 내용이 바뀌었다」
 * for a change no person made. The second is the assumption the staleness recompute quietly rests on.
 */
const scene = (overrides: Partial<StoredScene> = {}): StoredScene => ({
  number: 2,
  description: "골목",
  visual_action: "걷는다",
  start_motion: "문 앞에 선 자세",
  main_motion: "천천히 골목으로 들어선다",
  end_motion: "멈춰 서서 위를 본다",
  shot_size: "미디엄",
  camera_angle: "아이레벨",
  composition: "중앙",
  lens_feel: "35mm",
  focus_subject: "인물",
  camera_motion: "느린 푸시인",
  environment_motion: "간판이 흔들린다",
  motion_speed: "보통",
  motion_intensity: "약함",
  expression_change: "무표정에서 놀람으로",
  continuity_hint: "같은 골목",
  ...overrides,
});

describe("compiling one scene for one model", () => {
  it("sends Runway exactly what the single-dialect builder always sent", () => {
    const previous = scene({ number: 1, end_motion: "고개를 돌린다", continuity_hint: "같은 골목" });

    const compiled = compileVideoPrompt("gen4_turbo", { scene: scene(), previous, ratio: "720:1280", clipDurationSeconds: 5 });

    expect(compiled.prompt).toBe(promptFor(scene(), previous, "720:1280", 5).prompt);
    expect(compiled.prompt.split("\n")[0]).toBe("Create one continuous cinematic 5-second vertical image-to-video shot from the supplied exact first frame.");
    expect(compiled.prompt.split("\n").at(-1)).toBe(STABILITY_RULE);
    expect(compiled.omittedSections).toEqual([]);
  });

  it("still drops the continuity cue for scene 1 rather than sending an empty label", () => {
    const compiled = compileVideoPrompt("gen4_turbo", { scene: scene({ number: 1 }), previous: undefined, ratio: "1280:720", clipDurationSeconds: 10 });

    expect(compiled.prompt).not.toContain("Continuity cue");
    expect(compiled.prompt.split("\n")[0]).toContain("10-second horizontal");
  });

  it("never sends the negative phrasing the image side is built on — Runway reads it the opposite way", () => {
    // image-prompt.ts hands OpenAI an explicit `Avoid:` line on purpose. Runway's own Gen-4 guide says negative
    // phrasing "may produce unpredictable or even opposite results", so the two providers must not share one
    // builder. This asserts the prohibition rather than the file, so a future dialect cannot quietly import it.
    const compiled = compileVideoPrompt("gen4_turbo", { scene: scene(), previous: undefined, ratio: "720:1280", clipDurationSeconds: 5 });

    expect(compiled.prompt).not.toContain("Avoid");
    expect(compiled.prompt).not.toMatch(/\bno\b|\bnot\b|\bwithout\b/i);
  });

  it("every registered video model has a prompt compiler", () => {
    // The refusal inside compileVideoPrompt is for a gap this assertion is supposed to close first: a model
    // added to the contract without a dialect would otherwise be discovered by a paid request failing.
    for (const model of VIDEO_MODELS) {
      expect(() => compileVideoPrompt(model, { scene: scene(), previous: undefined, ratio: "720:1280", clipDurationSeconds: 5 }),
        `${model} has no compiler — add its dialect function, do not let it fall back to another model's grammar`).not.toThrow();
    }
  });

  /**
   * 🔴 This is a tripwire, not a preference. It is expected to fail, once, on the day a second model is added —
   * and what it is protecting is two lines of code elsewhere that will still typecheck, still pass their own
   * tests, and still be wrong.
   */
  it("holds the staleness recompute's assumption: one dialect, so 'today's model' and 'the recorded model' are the same answer", () => {
    expect(VIDEO_MODELS.length, [
      "A second video model is registered. Before shipping it, fix both staleness recomputes:",
      "  apps/backend/src/projects/scene-staleness.ts        (short project)",
      "  apps/backend/src/long-projects/episode-videos.service.ts#prompt (Long Episode)",
      "Both rebuild a recorded clip's prompt with the single dialect because the record does not say which",
      "model made it. With two dialects that comparison reports every clip made by the other model as",
      "「장면 내용이 바뀐 뒤로 다시 만들지 않았습니다」 — false for all of them. Record the selected model on the",
      "video generation record and recompute against that, or refuse to compare across dialects.",
    ].join("\n")).toBe(1);
  });
});
