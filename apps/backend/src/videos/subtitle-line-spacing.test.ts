import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { photoCardSubtitleGeometry } from "@ai-animation-studio/shared";

import { runMediaCommand } from "./ffmpeg-merge.service.js";
import { escapeForFfmpegFilterPath, sceneSubtitleAss } from "./subtitle-file.js";

/**
 * How far apart the card actually draws its lines, read off a rendered frame.
 *
 * 🔴 **This is the pair that was missing while the number was wrong.** A card's body travels as one
 * `\N`-joined cue, so **libass, not this app, decides the spacing** — and `lineGap` is this app's description
 * of that spacing, used for two things that both fail silently when the description is false:
 *
 *   - the preview places each body line at `bodyY + index * lineGap` directly, and
 *   - `bodySpan` feeds `headingY`/`bodyY`, so it positions the whole block.
 *
 * It said `bodySize * 1.5`, and nothing in the repository ever compared it to a frame. Measured against the
 * real renderer and the bundled fonts, the spacing is the font size **exactly**:
 *
 *     ASS Fontsize   38    52    80    96
 *     spacing      38.5  52.0  80.0  96.0     ← ratio 1.00 at every size
 *
 * So a three-line card previewed 26px wider than it rendered, and a card **with a heading** was centred as
 * though its body were half again as tall — landing 14.5px above the centre its own slider promises (753.5
 * against 768.0 at `center 0.40`). With `lineGap` at 1.0 the same frame measures 768.0.
 *
 * 🟠 It went unfound because the error cancels in the common case: with no heading, `headingY` subtracts
 * `blockHeight / 2` and `bodyY` adds `bodySpan / 2`, so the span drops out and the block sits right whatever
 * `lineGap` says. Only a heading makes it observable. That is the same shape as every other bug this file was
 * written for — a number two layers depend on and neither can see.
 *
 * Measured rather than derived from the formula, because the formula was the thing that was wrong.
 */
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 1920;
const fontsDirectory = path.resolve(import.meta.dirname, "../../../../fonts");
/** 캡틴D's defaults, so these numbers describe the card that actually ships. */
const CARD_LAYOUT = { scale: 0.027, center: 0.4 } as const;
/** Long enough that the reveal and the hold are both visible in one render. */
const CARD_SECONDS = 5;

async function plainFrame(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "subtitle-spacing-"));
  roots.push(root);
  await runMediaCommand(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
    "-i", `color=c=0x204060:s=${FRAME_WIDTH}x${FRAME_HEIGHT}`, "-frames:v", "1", path.join(root, "plain.png")]);
  return root;
}

/**
 * The vertical centre of every band of ink, top to bottom.
 *
 * One render collapsed to a single column of row averages rather than probing rows one at a time — the same
 * question `subtitle-font-metrics.test.ts` asks column by column, answered in one pass, because a per-row scan
 * of 1920 rows would be 1920 processes.
 */
async function inkRowCentres(directory: string, label: string, text: string, atSeconds = CARD_SECONDS - 1, reveal = true): Promise<number[]> {
  const plain = path.join(directory, "plain.png");
  const rendered = path.join(directory, `${label}.png`);
  const column = path.join(directory, `${label}.raw`);
  const assPath = path.join(directory, `${label}.ass`);

  await fs.writeFile(assPath, sceneSubtitleAss(text, CARD_SECONDS, FRAME_WIDTH, FRAME_HEIGHT, "photo-card", { card: CARD_LAYOUT }, undefined, reveal), "utf8");
  /*
   * 🔴 The moment is now part of the measurement, and saying so is the point. A card's body lines arrive
   * in turn, so "what does this card look like" has no answer without a time attached — these pairs read the
   * settled frame, a second before the end, which is the state the one static cue used to hold for the whole
   * clip and the state the preview draws.
   */
  await runMediaCommand(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-framerate", "30", "-t", String(CARD_SECONDS), "-i", plain,
    "-vf", `subtitles='${escapeForFfmpegFilterPath(assPath)}':fontsdir='${escapeForFfmpegFilterPath(fontsDirectory)}'`,
    "-ss", String(atSeconds), "-frames:v", "1", rendered]);
  // Against the untouched frame, so the background's own texture cannot be read as a line of text.
  await runMediaCommand(["ffmpeg", "-y", "-loglevel", "error", "-i", rendered, "-i", plain,
    "-filter_complex", `[0][1]blend=all_mode=difference,format=gray,scale=1:${FRAME_HEIGHT}:flags=area`,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", column]);

  const rows = [...await fs.readFile(column)];
  const bands: number[][] = [];
  rows.forEach((value, y) => {
    // 2 rather than 0: `area` scaling smears a little of each glyph into the rows above and below it.
    if (value <= 2) return;
    const last = bands.at(-1);
    if (last && y - last.at(-1)! <= 6) last.push(y); else bands.push([y]);
  });
  return bands.filter((band) => band.length > 3).map((band) => (band[0]! + band.at(-1)!) / 2);
}

/** The same measurement with the reveal switched off — what pictures 2..N of a card are given. */
async function inkRowCentresWithoutReveal(directory: string, label: string, text: string, atSeconds: number): Promise<number[]> {
  return inkRowCentres(directory, label, text, atSeconds, false);
}

const CARD_TEXT = "제목 줄입니다\n첫째 줄입니다\n둘째 줄입니다\n셋째 줄입니다";
/** A heading and exactly one body line — nothing to put in order, so nothing should wait. */
const SINGLE_LINE_CARD = "제목 줄입니다\n한 줄뿐입니다";

describe("how far apart the card really draws its lines", () => {
  it("spaces body lines by lineGap, which the preview and the block position both assume", async ({ skip }) => {
    if (!await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false)) skip();
    const root = await plainFrame();

    const geometry = photoCardSubtitleGeometry(FRAME_WIDTH, FRAME_HEIGHT, CARD_LAYOUT, 3, true);
    const centres = await inkRowCentres(root, "three-lines", CARD_TEXT);

    // Four bands: the heading, then the three body lines.
    expect(centres).toHaveLength(4);
    const body = centres.slice(1);

    /**
     * 🟠 Measured across the outer lines and divided, not line to line.
     *
     * A band's centre is a proxy for the baseline, and the proxy carries each line's own glyphs with it: 「첫째」
     * and 「셋째」 reach different heights, so consecutive gaps measure 54.5 and 49.5 while the spacing they are
     * both made of is 52. Spanning the block divides that error by the number of steps and leaves the number
     * being asked about — the same trick `subtitle-font-metrics.test.ts` uses when it subtracts two glyph counts
     * so the side bearings cancel. Loosening the tolerance instead would have hidden a real 26px error inside it.
     */
    const spacing = (body[2]! - body[0]!) / 2;
    expect(Math.abs(spacing - geometry.lineGap)).toBeLessThanOrEqual(1);
    // And the body block sits where the geometry put it — the half that carries the heading with it.
    expect(Math.abs((body[0]! + body[2]!) / 2 - geometry.bodyY)).toBeLessThanOrEqual(2);
  }, 180000);

  /**
   * 🔴 The consequence, asserted where somebody would look for it: **the text lands on the centre the slider
   * names**. This is what the old number missed by 14.5px, and it is observable only with a heading — without
   * one the span cancels and the block is centred correctly whatever `lineGap` says, which is precisely why
   * this went unnoticed.
   */
  it("puts a heading-and-body card on the centre its own slider promises", async ({ skip }) => {
    if (!await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false)) skip();
    const root = await plainFrame();

    const centres = await inkRowCentres(root, "centred", CARD_TEXT);
    const drawn = (centres[0]! + centres.at(-1)!) / 2;
    // 8px of slack at 1920 — under half a line — because a band's edge is where a glyph's outline fades, and
    // the heading and the last body line do not fade by the same amount. The error this catches is twice that.
    expect(Math.abs(drawn - FRAME_HEIGHT * CARD_LAYOUT.center)).toBeLessThanOrEqual(8);
  }, 180000);
});

describe("how a card's lines arrive", () => {
  /**
   * 🔴 **The feature, measured on frames rather than asserted on the file.** The lines arrive in turn, so
   * this counts bands of ink at four moments and expects the count to climb and then hold.
   *
   * 🟠 Counted, not matched to exact times. The *order* is the promise — more text as the card plays, all
   * of it up well before the end — and pinning "the third line appears at 1.67s" would make a pair that breaks
   * when somebody changes the share for a good reason, which is how a pair gets deleted instead of read.
   */
  it("shows more lines as the card plays, and has them all up long before it ends", async ({ skip }) => {
    if (!await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false)) skip();
    const root = await plainFrame();

    const at = async (seconds: number, label: string) => (await inkRowCentres(root, label, CARD_TEXT, seconds)).length;
    const start = await at(0.1, "t0");
    const early = await at(1.2, "t1");
    const settled = await at(2.6, "t2");
    const end = await at(CARD_SECONDS - 0.2, "t3");

    // The heading and the first body line are there from the start — nothing begins blank.
    expect(start).toBeGreaterThanOrEqual(2);
    expect(early).toBeGreaterThan(start);
    // Four bands is everything: the heading and three body lines.
    expect(settled).toBe(4);
    // 🔴 And they stay. A reveal that finishes and then loses a line would be a cue whose end was computed
    // from its start rather than from the card.
    expect(end).toBe(4);
  }, 180000);

  /**
   * 🟠 A single body line has nothing to sequence, so it must not wait. Somebody looking at a one-line
   * quote card should see the same card they saw before this existed — the animation is for text that has an
   * order, and a lone line does not.
   */
  it("does not make a one-line card wait for anything", async ({ skip }) => {
    if (!await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false)) skip();
    const root = await plainFrame();

    const first = await inkRowCentres(root, "single-start", SINGLE_LINE_CARD, 0.1);
    const later = await inkRowCentres(root, "single-late", SINGLE_LINE_CARD, CARD_SECONDS - 0.2);
    expect(first).toHaveLength(2);
    expect(later).toEqual(first);
  }, 180000);
});

describe("a card with several pictures reveals once, not once per picture", () => {
  /**
   * 🔴 **The interaction found before this feature was built, not after.** Subtitles are burned per scene, so
   * a card holding several pictures would replay the line-by-line reveal on each one: read three lines, watch
   * them vanish, read them again. The reveal exists to keep pace with somebody reading, and restarting it
   * takes their place away.
   *
   * The text stays on every picture — in a news reel the text *is* the content, and losing it halfway is worse
   * than any animation. So the first picture reveals and the rest open with everything already up.
   *
   * Measured on frames rather than on the `.ass` file, because what is being promised is what a person sees.
   */
  it("shows the whole text from the first frame of a later picture", async ({ skip }) => {
    if (!await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false)) skip();
    const root = await plainFrame();

    // The first picture: at 0.1s only the heading and the first line are up.
    const first = await inkRowCentres(root, "reveal-first", CARD_TEXT, 0.1);
    // A later picture carries the same text with reveal off — everything is there immediately.
    const later = await inkRowCentresWithoutReveal(root, "reveal-later", CARD_TEXT, 0.1);

    expect(first.length).toBeLessThan(4);
    expect(later).toHaveLength(4);
    // 🔴 And in the same places: the block does not move because the reveal was switched off.
    const settled = await inkRowCentres(root, "reveal-settled", CARD_TEXT);
    expect(later).toEqual(settled);
  }, 180000);
});
