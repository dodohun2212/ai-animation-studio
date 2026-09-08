import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runMediaCommand } from "./ffmpeg-merge.service.js";
import { ASS_WEIGHT, familyNames, fontFileForFamily, usWeightClass } from "./font-file-tables.js";
import { escapeForFfmpegFilterPath } from "./subtitle-file.js";

/**
 * Which FILE the renderer picks when one family name is shipped at two weights.
 *
 * 캡틴D wants the scene subtitle bold, and chose to ship a bold font file for it. The shipped Noto Sans KR
 * Medium declares "Noto Sans KR" as both its family (nameID 1) and its typographic family (nameID 16), so a
 * Bold of the same face cannot be given a family name nothing else claims — the way Noto Serif KR gets one by
 * being a different typeface. The two files have to live under one name, and the style's `Bold` field has to be
 * what tells them apart.
 *
 * `fontFileForFamily` refused exactly that arrangement, and said why: the choice would be fontconfig's weight
 * proximity, "which this app neither controls nor can test". This measures it instead of arguing with it, and
 * what it measures is not a preference — it is whether 캡틴D's quote cards keep the face they have today while
 * the scene subtitle gets a different one out of the same directory.
 *
 * 🟠 The bold file is synthesized here rather than waited for. Noto Serif KR Bold is already shipped at weight
 * 700; a copy of it renamed to claim the sans family gives a real two-weight directory whose two faces are
 * unmistakable on the frame, and it needs nothing that is not already in the repository. What it cannot answer
 * is anything about Noto Sans KR Bold's own metrics — that is measured in subtitle-font-metrics.test.ts, from
 * the real file, once it is here.
 */

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

const WIDTH = 1080;
const HEIGHT = 1920;
const SANS_FAMILY = "Noto Sans KR";
const fontsDirectory = path.resolve(import.meta.dirname, "../../../../fonts");

/**
 * The same file, claiming a different family.
 *
 * Every name record for the family (nameID 1) and the typographic family (nameID 16) is overwritten in place
 * and its length shortened, which works only downwards — the two shipped names differ by one character, and a
 * replacement that did not fit would throw here rather than produce a file that half-claims two families.
 */
function claimingFamily(file: Buffer, family: string): Buffer {
  const bytes = Buffer.from(file);
  const nameTable = tableOffset(bytes, "name");
  const count = bytes.readUInt16BE(nameTable + 2);
  const storage = nameTable + bytes.readUInt16BE(nameTable + 4);
  for (let index = 0; index < count; index += 1) {
    const record = nameTable + 6 + index * 12;
    const nameId = bytes.readUInt16BE(record + 6);
    if (nameId !== 1 && nameId !== 16) continue;
    const platform = bytes.readUInt16BE(record);
    const replacement = platform === 3 ? Buffer.from(family, "utf16le").swap16() : Buffer.from(family, "ascii");
    const length = bytes.readUInt16BE(record + 8);
    if (replacement.length > length) throw new Error(`"${family}" does not fit the name record it replaces`);
    replacement.copy(bytes, storage + bytes.readUInt16BE(record + 10));
    bytes.writeUInt16BE(replacement.length, record + 8);
  }
  return bytes;
}

/** The table directory lookup font-file-tables.ts keeps private; this file only needs it to find `name`. */
function tableOffset(file: Buffer, tag: string): number {
  const tableCount = file.readUInt16BE(4);
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    if (file.toString("ascii", record, record + 4) === tag) return file.readUInt32BE(record + 8);
  }
  throw new Error(`no ${tag} table`);
}

/**
 * One line of Hangul in one style, written by hand rather than through `sceneSubtitleAss`.
 *
 * The subject here is the renderer's font matching, and the scene layout has no Bold handle to drive it with —
 * so the flag is set directly. Nothing else about this file matters beyond drawing the same glyphs twice.
 */
function ass(bold: 0 | -1): string {
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${WIDTH}`, `PlayResY: ${HEIGHT}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${SANS_FAMILY},100,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,${bold},0,0,0,100,100,0,0,1,0,0,5,10,10,0,1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\an5\\pos(540,960)}${"가".repeat(8)}`,
    "",
  ].join("\n");
}

/**
 * The same question asked of our own reader, which has to answer it identically.
 *
 * `fontFileForFamily` is how the preview's size ratio finds the face it is describing. If it picked a different
 * file from the one the render picked, the preview would be measuring a font the video does not use — the
 * failure PHOTO_CARD_SUBTITLE_CSS_RATIO carries the full account of.
 */
describe("fontFileForFamily", () => {
  it("answers a bold request with the heavier file and a regular one with the lighter, from the same directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "font-pick-")); roots.push(root);
    const medium = await fs.readFile(path.join(fontsDirectory, "NotoSansKR-Medium.ttf"));
    await fs.writeFile(path.join(root, "medium.ttf"), medium);
    await fs.writeFile(path.join(root, "bold.ttf"), claimingFamily(await fs.readFile(path.join(fontsDirectory, "NotoSerifKR-Bold.ttf")), SANS_FAMILY));

    expect(usWeightClass(await fontFileForFamily(root, SANS_FAMILY, ASS_WEIGHT.regular))).toBe(500);
    expect(usWeightClass(await fontFileForFamily(root, SANS_FAMILY, ASS_WEIGHT.bold))).toBe(700);
    // The default is the regular request, so every caller that does not care about weight keeps today's answer.
    expect(usWeightClass(await fontFileForFamily(root, SANS_FAMILY))).toBe(500);
  });

  /**
   * 🔴 The refusal that survives the change above: two files a request cannot choose between.
   *
   * Weight is what separates two faces of one family. Two files at the SAME weight leave the decision to
   * whatever order the directory happens to list them in — an answer that can differ between machines while
   * looking perfectly stable on the one it was written on.
   */
  it("refuses a family when two files are equally close to the weight asked for", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "font-tie-")); roots.push(root);
    const medium = await fs.readFile(path.join(fontsDirectory, "NotoSansKR-Medium.ttf"));
    await fs.writeFile(path.join(root, "one.ttf"), medium);
    await fs.writeFile(path.join(root, "two.ttf"), medium);

    await expect(fontFileForFamily(root, SANS_FAMILY)).rejects.toThrow(/answered by 2 files/);
    await expect(fontFileForFamily(root, "No Such Family")).rejects.toThrow(/no file/);
  });
});

describe("which font file a subtitle style resolves to", () => {
  it("gives a bold style the bold file and leaves every other style on the one it has today", async ({ skip }) => {
    const available = await runMediaCommand(["ffmpeg", "-version"]).then(() => true).catch(() => false);
    if (!available) skip();

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "subtitle-weight-")); roots.push(root);
    const medium = await fs.readFile(path.join(fontsDirectory, "NotoSansKR-Medium.ttf"));
    const bold = claimingFamily(await fs.readFile(path.join(fontsDirectory, "NotoSerifKR-Bold.ttf")), SANS_FAMILY);
    // The fixture is only worth rendering if it really is one family at two weights.
    expect([...new Set(familyNames(bold))]).toEqual([SANS_FAMILY]);
    expect(usWeightClass(medium)).toBe(500);
    expect(usWeightClass(bold)).toBe(700);

    const directories = { mediumOnly: "500", boldOnly: "700", both: "both" };
    for (const directory of Object.values(directories)) await fs.mkdir(path.join(root, directory));
    await fs.writeFile(path.join(root, directories.mediumOnly, "medium.ttf"), medium);
    await fs.writeFile(path.join(root, directories.boldOnly, "bold.ttf"), bold);
    await fs.writeFile(path.join(root, directories.both, "medium.ttf"), medium);
    await fs.writeFile(path.join(root, directories.both, "bold.ttf"), bold);

    const frame = async (directory: string, weight: 0 | -1): Promise<Buffer> => {
      const label = `${directory}-${weight}`;
      const assPath = path.join(root, `${label}.ass`);
      const rendered = path.join(root, `${label}.png`);
      await fs.writeFile(assPath, ass(weight), "utf8");
      await runMediaCommand(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=black:s=${WIDTH}x${HEIGHT}`,
        "-vf", `subtitles='${escapeForFfmpegFilterPath(assPath)}':fontsdir='${escapeForFfmpegFilterPath(path.join(root, directory))}'`,
        "-frames:v", "1", rendered]);
      return fs.readFile(rendered);
    };

    const [onlyMedium, onlyBold, fakedBold, bothRegular, bothBold] = await Promise.all([
      frame(directories.mediumOnly, 0),
      frame(directories.boldOnly, -1),
      frame(directories.mediumOnly, -1),
      frame(directories.both, 0),
      frame(directories.both, -1),
    ]);

    // Without this the three comparisons below would all hold for a directory whose files draw the same thing.
    expect(onlyMedium.equals(onlyBold)).toBe(false);

    // 🔴 The one that protects what already works: the photo card's body and today's scene subtitle are
    // non-bold styles on this family, and a bold file arriving in the directory must not touch them.
    expect(bothRegular.equals(onlyMedium)).toBe(true);
    // And the reason the arrangement is usable at all — a bold style draws the 700 file itself.
    expect(bothBold.equals(onlyBold)).toBe(true);

    /**
     * 🔴 Why the Bold flag and the font file have to ship together, in one frame.
     *
     * A bold style with no bold file is not refused; libass fakes the weight from whichever face it has, and
     * the result is neither of the real ones. That is 캡틴D's 「글씨가 너무 얇아」 in its earlier form — the
     * shipped faces were the thinnest in their families and `Bold: -1` was quietly synthesizing over them.
     */
    expect(fakedBold.equals(onlyMedium)).toBe(false);
    expect(fakedBold.equals(onlyBold)).toBe(false);
  }, 180000);
});
