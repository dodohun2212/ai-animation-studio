import { describe, expect, it } from "vitest";

import {
  DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT,
  isPhotoCardSubtitleLayout,
  PHOTO_CARD_SUBTITLE_CENTER,
  PHOTO_CARD_SUBTITLE_SCALE,
  photoCardSubtitleGeometry,
  splitPhotoCardSubtitle,
} from "./domain.js";

const WIDTH = 1080;
const HEIGHT = 1920;
const geometry = (text: string, layout = DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT) => {
  const { heading, body } = splitPhotoCardSubtitle(text);
  return photoCardSubtitleGeometry(WIDTH, HEIGHT, layout, body.length, heading !== undefined);
};

/**
 * This lives in shared because two things draw from it — FFmpeg burning the text into the video, and the screen
 * previewing it before anything is rendered. A preview computed separately is a preview that can be wrong while
 * looking right (Cowork Round 440 wrote that copy and asked for this).
 */
describe("photo card subtitle geometry", () => {
  it("treats the first line as a heading only when a line follows it", () => {
    expect(splitPhotoCardSubtitle("불광불급\n미치지 않으면 미치지 못한다")).toEqual({ heading: "불광불급", body: ["미치지 않으면 미치지 못한다"] });
    expect(splitPhotoCardSubtitle("미치지 않으면 미치지 못한다")).toEqual({ body: ["미치지 않으면 미치지 못한다"] });
    // Blank lines are not a heading either — they are how a person types, not what they meant.
    expect(splitPhotoCardSubtitle("\n\n한 줄\n\n")).toEqual({ body: ["한 줄"] });
  });

  it("centres the whole block on the chosen fraction of the frame", () => {
    const two = geometry("불광불급\n미치지 않으면 미치지 못한다");
    expect(Math.round((two.headingY + two.bodyY) / 2)).toBe(Math.round(HEIGHT * PHOTO_CARD_SUBTITLE_CENTER.default));

    const one = geometry("미치지 않으면 미치지 못한다");
    expect(one.bodyY).toBe(Math.round(HEIGHT * PHOTO_CARD_SUBTITLE_CENTER.default));
  });

  it("derives the heading size from the body, so the pair always fits together", () => {
    const small = geometry("불광불급\n본문", { scale: PHOTO_CARD_SUBTITLE_SCALE.min, center: 0.4 });
    const large = geometry("불광불급\n본문", { scale: PHOTO_CARD_SUBTITLE_SCALE.max, center: 0.4 });

    expect(small.headSize).toBe(Math.round(small.bodySize * 1.4));
    expect(large.headSize).toBe(Math.round(large.bodySize * 1.4));
    expect(large.bodySize).toBeGreaterThan(small.bodySize);
  });

  it("moves the block with the centre it is given, keeping the heading above the body", () => {
    const high = geometry("불광불급\n본문", { scale: 0.027, center: PHOTO_CARD_SUBTITLE_CENTER.min });
    const low = geometry("불광불급\n본문", { scale: 0.027, center: PHOTO_CARD_SUBTITLE_CENTER.max });

    expect(high.headingY).toBeLessThan(low.headingY);
    expect(high.headingY).toBeLessThan(high.bodyY);
    expect(low.headingY).toBeLessThan(low.bodyY);
  });

  it("keeps a margin for the wrap, whatever the text size", () => {
    expect(geometry("한 줄").margin).toBe(Math.round(WIDTH * 0.07));
    expect(geometry("한 줄").centerX).toBe(WIDTH / 2);
  });
});

describe("photo card subtitle bounds", () => {
  // The server refuses on this and the screen's own control is built from the same numbers, so they cannot
  // disagree about what is allowed.
  it("accepts the defaults and both ends of each range", () => {
    expect(isPhotoCardSubtitleLayout(DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT)).toBe(true);
    expect(isPhotoCardSubtitleLayout({ scale: PHOTO_CARD_SUBTITLE_SCALE.min, center: PHOTO_CARD_SUBTITLE_CENTER.min })).toBe(true);
    expect(isPhotoCardSubtitleLayout({ scale: PHOTO_CARD_SUBTITLE_SCALE.max, center: PHOTO_CARD_SUBTITLE_CENTER.max })).toBe(true);
  });

  it("refuses anything outside them, and anything that is not a number at all", () => {
    expect(isPhotoCardSubtitleLayout({ scale: PHOTO_CARD_SUBTITLE_SCALE.max + 0.001, center: 0.4 })).toBe(false);
    expect(isPhotoCardSubtitleLayout({ scale: 0.027, center: PHOTO_CARD_SUBTITLE_CENTER.min - 0.001 })).toBe(false);
    expect(isPhotoCardSubtitleLayout({ scale: Number.NaN, center: 0.4 })).toBe(false);
    expect(isPhotoCardSubtitleLayout({ scale: "0.03", center: 0.4 })).toBe(false);
    expect(isPhotoCardSubtitleLayout(null)).toBe(false);
    expect(isPhotoCardSubtitleLayout({ scale: 0.027 })).toBe(false);
  });
});
