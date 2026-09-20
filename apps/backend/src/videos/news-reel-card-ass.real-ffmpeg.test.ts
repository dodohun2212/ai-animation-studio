import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { newsReelCardGeometry, type NewsReelCard } from "@ai-animation-studio/shared";
import { afterAll, describe, expect, it } from "vitest";

import { newsReelCardAss } from "./news-reel-card-ass.js";
import { escapeForFfmpegFilterPath } from "./subtitle-file.js";

/**
 * Whether libass actually draws what the file says.
 *
 * 🔴 **The other pairs read the `.ass` text, which proves the text and nothing else.** A drawing command with
 * the wrong origin, a band on a layer that lands over the letters, a style whose colour never reaches the
 * frame — every one of those leaves the file looking exactly right. The only way to know is to render a frame
 * and read the pixels out of it, which is how the 0.63 width ratio was settled in the first place
 * (docs/06_DECISIONS.md D-053): the app cannot see its own output, so something has to look.
 *
 * One frame, one grey background, no provider and no money.
 */
const WIDTH = 1080;
const HEIGHT = 1920;
const DURATION = 10;

const CARD: NewsReelCard = {
  publisher: "연합뉴스",
  headline: { line1: "검찰청 폐지 하루 만에", line2: "후속 법률 51건 통과" },
  caption: { line1: "9월 17일 국회 본회의", line2: "개정법은 10월 2일부터" },
  creditRequired: false,
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "news-reel-ass-"));
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

const fontsDir = path.resolve(import.meta.dirname, "..", "..", "..", "..", "fonts");

function renderFrame(card: NewsReelCard): string {
  const assPath = path.join(root, "card.ass");
  fs.writeFileSync(assPath, newsReelCardAss(card, DURATION, WIDTH, HEIGHT), "utf8");
  const framePath = path.join(root, "frame.png");
  // 🟠 Mid grey, so both a dark band and white letters are a long way from the background either way.
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=0x808080:s=${WIDTH}x${HEIGHT}:d=1`, "-vf",
    // 🟠 Both paths quoted, exactly as the merge writes them — unquoted, the filter parser reads the second
    // path's own slashes as more options and fails with no frame and a confusing message.
    `subtitles='${escapeForFfmpegFilterPath(assPath)}':fontsdir='${escapeForFfmpegFilterPath(fontsDir)}'`,
    "-frames:v", "1", framePath], { stdio: "pipe" });
  return framePath;
}

/** One pixel, read straight out of the frame as three bytes. */
function pixel(frame: string, x: number, y: number): { r: number; g: number; b: number } {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", frame, "-vf", `crop=1:1:${x}:${y}`,
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 20 });
  return { r: raw[0]!, g: raw[1]!, b: raw[2]! };
}

/** How many pixels in a row are close to a colour — enough to tell letters from the band they sit on. */
function countNear(frame: string, y: number, want: { r: number; g: number; b: number }, tolerance = 40): number {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", frame, "-vf", `crop=${WIDTH}:1:0:${y}`,
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 22 });
  let found = 0;
  for (let index = 0; index + 2 < raw.length; index += 3) {
    if (Math.abs(raw[index]! - want.r) <= tolerance && Math.abs(raw[index + 1]! - want.g) <= tolerance && Math.abs(raw[index + 2]! - want.b) <= tolerance) found += 1;
  }
  return found;
}

describe("news reel card, rendered", () => {
  const g = newsReelCardGeometry(WIDTH, HEIGHT, 2);

  it("paints the publisher band across the top, in the colour the style names", () => {
    const frame = renderFrame(CARD);
    // 🟠 Off to the side of the name, so this reads the band and not a letter.
    // 🟠 Within a point or two: the frame is encoded as yuv420p on the way out and read back as rgb, and
    // that round trip moves a channel by one. What is being asked is "the band's colour", not "the exact bytes".
    const band = pixel(frame, 40, Math.round(g.bandHeight / 2));
    for (const [channel, want] of [["r", 11], ["g", 30], ["b", 58]] as const) {
      expect(Math.abs(band[channel] - want), `${channel} 채널`).toBeLessThanOrEqual(2);
    }
    // 🔴 And it stops where the geometry says it does — a band that ran on would swallow the headline.
    const below = pixel(frame, 40, g.bandHeight + 10);
    expect(below.r, "띠 아래는 바탕입니다").toBeGreaterThan(100);
  });

  /** 🔴 노란 줄이 어느 줄인지가 이 카드 설계의 절반이다. 파일에 적혀 있는 것과 프레임에 칠해진 것은 다르다. */
  it("paints the second headline line yellow and the first one white", () => {
    const frame = renderFrame(CARD);
    /* 🟠 100 is not a magic number so much as a floor well clear of noise: a scanline through the middle of
       fifteen 100px characters crosses dozens of strokes, and stray anti-aliasing cannot reach three figures. */
    expect(countNear(frame, g.headline2Y, { r: 255, g: 212, b: 0 }), "둘째 줄에 노란 글자가 있습니다").toBeGreaterThan(100);
    expect(countNear(frame, g.headline1Y, { r: 255, g: 212, b: 0 }), "첫 줄에는 노란 글자가 없습니다").toBe(0);
    expect(countNear(frame, g.headline1Y, { r: 255, g: 255, b: 255 }, 10), "첫 줄은 흰 글자입니다").toBeGreaterThan(100);
  });

  /** 🟠 아래 띠는 비쳐야 한다 — 바탕이 살아 있으면서 어두워진다. */
  it("lets the picture through the caption band instead of covering it", () => {
    const frame = renderFrame(CARD);
    const inBand = pixel(frame, 20, g.captionBandY + 8);
    const outside = pixel(frame, 20, g.captionBandY - 8);
    expect(inBand.r, "띠 안은 바탕보다 어둡습니다").toBeLessThan(outside.r);
    expect(inBand.r, "그래도 완전히 덮지는 않습니다").toBeGreaterThan(11);
  });

  it("writes the line the contract allows without it leaving the frame", () => {
    const limit = "가".repeat(15);
    const frame = renderFrame({ ...CARD, headline: { line1: limit, line2: limit } });
    // 🔴 A line that overran would draw into the margin; the margin is what the size was derived to protect.
    expect(countNear(frame, g.headline1Y, { r: 255, g: 255, b: 255 }, 10), "글자가 그려졌습니다").toBeGreaterThan(100);
    for (const x of [2, WIDTH - 3]) {
      const edge = pixel(frame, x, g.headline1Y);
      expect(edge.r, `x=${x} 는 여백입니다`).toBeGreaterThan(100);
    }
  });
});
