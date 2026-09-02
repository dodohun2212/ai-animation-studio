import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { PHOTO_CARD_SUBTITLE_CSS_RATIO } from "@ai-animation-studio/shared";

import { runMediaCommand } from "./ffmpeg-merge.service.js";
import { escapeForFfmpegFilterPath, sceneSubtitleAss } from "./subtitle-file.js";

/**
 * How wide the card's text actually is, read off a rendered frame.
 *
 * Two layers depend on this number and neither can see it. libass scales a font by its own vertical metrics,
 * so ASS `Fontsize` is not CSS `font-size` — the preview screen has to multiply by a ratio to draw the text at
 * the size the video will have, and a ratio that is merely believed produces a preview that wraps in different
 * places and warns about overflow the video does not have (Cowork Round 446 hit exactly that). Nothing in the
 * repository could check the number, so it is measured here against the real renderer and the real font files.
 *
 * The measurement uses two glyph counts and takes the difference, so the glyphs' own side bearings and the
 * outline cancel and what is left is the advance. Skipped, out loud, where FFmpeg is not installed.
 */
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 1920;
const fontsDirectory = path.resolve(import.meta.dirname, "../../../../fonts");

/** Whether any pixel differs from the same frame without text, inside one rectangle. */
async function hasInk(difference: string, x: number, width: number, band: { y: number; height: number }): Promise<boolean> {
  if (width <= 0) return false;
  const { stderr } = await runMediaCommand(["ffmpeg", "-i", difference,
    "-vf", `crop=${width}:${band.height}:${x}:${band.y},signalstats,metadata=print`, "-f", "null", "-"]);
  return Number(/signalstats.YMAX=(\d+)/.exec(stderr)?.[1] ?? "0") > 0;
}

/**
 * The width of the drawn text, to within a pixel.
 *
 * Binary search rather than a scan: "is there ink anywhere left of x" only ever turns true as x grows, so the
 * edge can be found in eight probes instead of two hundred. A per-column scan would also mistake the gap
 * between two glyphs for the end of the line.
 */
async function inkWidth(directory: string, label: string, text: string, band: { y: number; height: number }): Promise<number> {
  const plain = path.join(directory, "plain.png");
  const rendered = path.join(directory, `${label}.png`);
  const difference = path.join(directory, `${label}-diff.png`);
  const assPath = path.join(directory, `${label}.ass`);
  await fs.writeFile(assPath, sceneSubtitleAss(text, 5, FRAME_WIDTH, FRAME_HEIGHT, "photo-card", { scale: 0.027, center: 0.4 }), "utf8");
  await runMediaCommand(["ffmpeg", "-y", "-loglevel", "error", "-i", plain,
    "-vf", `subtitles='${escapeForFfmpegFilterPath(assPath)}':fontsdir='${escapeForFfmpegFilterPath(fontsDirectory)}'`,
    "-frames:v", "1", rendered]);
  await runMediaCommand(["ffmpeg", "-y", "-loglevel", "error", "-i", rendered, "-i", plain,
    "-filter_complex", "[0][1]blend=all_mode=difference,format=gray", "-frames:v", "1", difference]);
  if (!await hasInk(difference, 0, FRAME_WIDTH, band)) throw new Error(`no text drawn for ${label}`);

  // The first column with ink: the largest empty margin measured from the left.
  let low = 0; let high = FRAME_WIDTH;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (await hasInk(difference, 0, middle, band)) high = middle; else low = middle;
  }
  const left = low;
  // And from the right.
  low = 0; high = FRAME_WIDTH;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (await hasInk(difference, FRAME_WIDTH - middle, middle, band)) high = middle; else low = middle;
  }
  return FRAME_WIDTH - low - left;
}

describe("what a card's text really measures on the frame", () => {
  it("draws each face at the ratio the preview is told to use", async ({ skip }) => {
    const available = await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false);
    if (!available) skip();

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "subtitle-metrics-")); roots.push(root);
    await runMediaCommand(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
      "-i", `color=c=0x204060:s=${FRAME_WIDTH}x${FRAME_HEIGHT}`, "-frames:v", "1", path.join(root, "plain.png")]);
    const bodySize = Math.round(FRAME_HEIGHT * 0.027);
    const headSize = Math.round(bodySize * 1.4);

    // The heading cue sits above the body cue; each band is read on its own so one face cannot be measured
    // through the other.
    const headingBand = { y: 640, height: 130 };
    const bodyBand = { y: 720, height: 110 };
    const headingAdvance = (await inkWidth(root, "head16", `${"가".repeat(16)}\n.`, headingBand)
      - await inkWidth(root, "head10", `${"가".repeat(10)}\n.`, headingBand)) / 6;
    const bodyAdvance = (await inkWidth(root, "body16", `.\n${"가".repeat(16)}`, bodyBand)
      - await inkWidth(root, "body10", `.\n${"가".repeat(10)}`, bodyBand)) / 6;

    // Within a scan step of the published ratio. Wider than that and the preview is drawing a different video.
    expect(headingAdvance / headSize).toBeCloseTo(PHOTO_CARD_SUBTITLE_CSS_RATIO.heading, 1);
    expect(bodyAdvance / bodySize).toBeCloseTo(PHOTO_CARD_SUBTITLE_CSS_RATIO.body, 1);
    // And the two faces really are different widths — one ratio for both would be wrong for one of them.
    expect(headingAdvance / headSize).not.toBeCloseTo(bodyAdvance / bodySize, 2);
  }, 180000);
});
