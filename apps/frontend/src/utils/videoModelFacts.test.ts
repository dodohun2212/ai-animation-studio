import { describe, expect, it } from "vitest";
import { ASPECT_RATIOS, RUNWAY_RATIO_FOR_ASPECT, VIDEO_MODEL_OPTIONS } from "@ai-animation-studio/shared";

import { aspectForRunwayRatio, frameFitOutcome, videoSetupIssues } from "./videoModelFacts.js";

const option = (id: string) => VIDEO_MODEL_OPTIONS.find((candidate) => candidate.id === id)!;

/*
 * Whether a clip lands in the reel's frame without bars is not the model's property alone — the project's shape
 * decides it too (CLI Round 860). With only 9:16 and 16:9 the two always agreed, which is why the screens could
 * read `frameShape` and be right; 1:1 and 4:5 are where they part.
 */
describe("frameFitOutcome — a model's clip against this project's frame", () => {
  it("answers each shape from the shared tables: square fits both kinds, 4:5 turns them round", () => {
    const table = (id: string) => ASPECT_RATIOS.map((aspect) => `${aspect} ${frameFitOutcome(option(id), aspect)}`);
    // Told a ratio: its request is the frame, except 4:5, which no model takes by name (3:4 goes out instead).
    expect(table("gen4_turbo")).toEqual(["9:16 same", "16:9 same", "1:1 same", "4:5 differs"]);
    // Told none: the picture's shape — 2:3 and 3:2 in the two video frames, but square and 4:5 exactly.
    expect(table("wan3_720p")).toEqual(["9:16 differs", "16:9 differs", "1:1 same", "4:5 same"]);
    // Never measured: never claimed either way.
    expect(table("h3_max_480p")).toEqual(["9:16 unknown", "16:9 unknown", "1:1 unknown", "4:5 unknown"]);
  });

  it("reads a request's ratio back as the shape it stands for", () => {
    for (const aspect of ASPECT_RATIOS) expect(aspectForRunwayRatio(RUNWAY_RATIO_FOR_ASPECT[aspect])).toBe(aspect);
    expect(aspectForRunwayRatio("1584:672")).toBe("9:16");
  });

  it("warns before sending only where the clip will not fit, whichever way round that is", () => {
    const ratioIssue = (id: string, ratio: string) =>
      videoSetupIssues(option(id), { durationSeconds: 5, sceneCount: 1, ratio: ratio as never }).find((issue) => issue.id === "ratio");
    expect(ratioIssue("gen4_turbo", "720:1280")).toBeUndefined();
    expect(ratioIssue("gen4_turbo", "832:1104")?.text).toContain("832:1104");
    expect(ratioIssue("wan3_720p", "720:1280")?.text).toContain("그대로 내보냅니다");
    expect(ratioIssue("wan3_720p", "960:960"), "a square picture in a square reel has no bars").toBeUndefined();
    expect(ratioIssue("wan3_720p", "832:1104"), "a 4:5 picture in a 4:5 reel has no bars").toBeUndefined();
    expect(ratioIssue("h3_max_480p", "960:960")?.text).toContain("확인되지 않았습니다");
  });
});
