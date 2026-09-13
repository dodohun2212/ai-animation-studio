import { describe, expect, it } from "vitest";

import { ASPECT_RATIOS, IMAGE_SIZE_FOR_ASPECT, isAspectRatio, MERGE_FRAME_FOR_ASPECT, RUNWAY_RATIO_FOR_ASPECT, RUNWAY_VIDEO_RATIOS, VIDEO_MODEL_OPTIONS, videoModelTakesAspect } from "./index.js";

/*
 * Item 6: a project's shape reaches the image model, the video model and the merge, each in its own spelling. The
 * image is bought first and the video is billed against it, so the three disagreeing is a paid-for picture in one
 * shape and a paid-for clip in another — the way the short project's orientation bug surfaced (project-aspect.ts).
 */
const orientation = (width: number, height: number) => Math.sign(width - height);
const parts = (text: string, separator: string) => text.split(separator).map(Number) as [number, number];

describe("a project's shape in every vocabulary", () => {
  it("names each shape the same way to the image size, the video ratio and the merge frame", () => {
    for (const aspect of ASPECT_RATIOS) {
      const [w, h] = parts(aspect, ":");
      const expected = orientation(w, h);
      expect(orientation(...parts(IMAGE_SIZE_FOR_ASPECT[aspect], "x")), aspect).toBe(expected);
      expect(orientation(...parts(RUNWAY_RATIO_FOR_ASPECT[aspect], ":")), aspect).toBe(expected);
      expect(orientation(MERGE_FRAME_FOR_ASPECT[aspect].width, MERGE_FRAME_FOR_ASPECT[aspect].height), aspect).toBe(expected);
    }
    expect(IMAGE_SIZE_FOR_ASPECT["1:1"]).toBe("1024x1024");
    expect(RUNWAY_RATIO_FOR_ASPECT["1:1"]).toBe("960:960");
    expect(MERGE_FRAME_FOR_ASPECT["1:1"]).toEqual({ width: 1080, height: 1080 });
  });

  it("accepts the listed shapes only, spelled exactly", () => {
    for (const aspect of ["9:16", "16:9", "1:1"]) expect(isAspectRatio(aspect), aspect).toBe(true);
    for (const value of ["4:5", "16 : 9", "1:1 ", "", undefined, null]) expect(isAspectRatio(value), String(value)).toBe(false);
  });

  it("lets a model that is told a ratio make only the ones it lists, and a model told none follow the picture", () => {
    const option = (id: string) => VIDEO_MODEL_OPTIONS.find((candidate) => candidate.id === id)!;
    expect(ASPECT_RATIOS.map((aspect) => videoModelTakesAspect(option("gen4_turbo"), aspect))).toEqual([true, true, true]);
    // Runway's OpenAPI gives Gemini Omni Flash 720:1280 and 1280:720 and nothing square.
    expect(ASPECT_RATIOS.map((aspect) => videoModelTakesAspect(option("gemini_omni_flash"), aspect))).toEqual([true, true, false]);
    expect(ASPECT_RATIOS.map((aspect) => videoModelTakesAspect(option("wan3_720p"), aspect))).toEqual([true, true, true]);
    for (const candidate of VIDEO_MODEL_OPTIONS) {
      for (const ratio of candidate.ratios) expect((RUNWAY_VIDEO_RATIOS as readonly string[]).includes(ratio), `${candidate.id} ${ratio}`).toBe(true);
      if (candidate.frameShape === "requested") expect(candidate.ratios, candidate.id).toEqual(expect.arrayContaining(["720:1280", "1280:720"]));
    }
  });
});
