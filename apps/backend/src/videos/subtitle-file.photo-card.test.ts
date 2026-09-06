import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { PHOTO_CARD_SUBTITLE_CENTER, PHOTO_CARD_SUBTITLE_SCALE } from "@ai-animation-studio/shared";

import { familyNames, usWeightClass } from "./font-file-tables.js";
import { FONT_FAMILY, QUOTE_FONT_FAMILY, sceneSubtitleAss } from "./subtitle-file.js";

const HEIGHT = 1920;
const WIDTH = 1080;

function styleRow(ass: string, name: string): string[] {
  const row = ass.split("\n").find((line) => line.startsWith(`Style: ${name},`));
  if (!row) throw new Error(`no style ${name} in:\n${ass}`);
  return row.slice("Style: ".length).split(",");
}

function cueY(ass: string, styleName: string): number {
  const row = ass.split("\n").find((line) => line.startsWith("Dialogue: ") && line.includes(`,${styleName},,`));
  if (!row) throw new Error(`no ${styleName} cue in:\n${ass}`);
  const match = /\\pos\((\d+),(\d+)\)/.exec(row);
  if (!match) throw new Error(`no pos in: ${row}`);
  return Number(match[2]);
}

describe("photo card subtitles", () => {
  const card = (text: string) => sceneSubtitleAss(text, 5, WIDTH, HEIGHT, "photo-card");

  /**
   * The reason this layout exists: at the bottom the text is simply not visible on the platform it is made for.
   * Reels put the caption, the account name and the buttons over the bottom fifth of the frame, and the scene
   * layout's MarginV is 0.042 of the height — inside it (Cowork Round 434, 캡틴D: "자막이 너무 아래다").
   */
  it("puts the text where the platform's own UI does not cover it", () => {
    const ass = card("불광불급(不狂不及)\n미치지 않으면 미치지 못한다");

    const quoteY = cueY(ass, "Quote");
    const bodyY = cueY(ass, "Body");
    expect(quoteY).toBeLessThan(bodyY);
    expect(bodyY).toBeLessThan(HEIGHT * 0.5);
    // The block is centred on the chosen fraction, not merely somewhere above the middle.
    expect(Math.round((quoteY + bodyY) / 2)).toBe(Math.round(HEIGHT * PHOTO_CARD_SUBTITLE_CENTER.default));
  });

  it("sets the two faces 캡틴D asked for, and the heading derived from the body size", () => {
    const ass = card("불광불급\n미치지 않으면 미치지 못한다");

    const [, quoteFont, quoteSize, , , , , quoteBold] = styleRow(ass, "Quote");
    const [, bodyFont, bodySize] = styleRow(ass, "Body");
    expect(quoteFont).toBe("Noto Serif KR");
    expect(bodyFont).toBe("Noto Sans KR");
    expect(Number(bodySize)).toBe(Math.round(HEIGHT * PHOTO_CARD_SUBTITLE_SCALE.default)); // 52 at 1920
    expect(Number(quoteSize)).toBe(Math.round(Math.round(HEIGHT * PHOTO_CARD_SUBTITLE_SCALE.default) * 1.4)); // 73
    expect(quoteBold).toBe("-1");
  });

  // The quote is typed by hand, so "the first line is the idiom" is an assumption and not a fact. Assuming it
  // renders a one-line card entirely in serif, which nobody asked for.
  it("uses one face for a card with no line break, rather than inventing a heading", () => {
    const ass = card("미치지 않으면 미치지 못한다");

    expect(ass).not.toContain("Quote,,");
    expect(cueY(ass, "Body")).toBe(Math.round(HEIGHT * PHOTO_CARD_SUBTITLE_CENTER.default));
  });

  it("keeps a long line off the edges of the frame even though the lines are positioned", () => {
    const [, , , , , , , , , , , , , , , , , , , marginL, marginR] = styleRow(card("긴 문장\n" + "가".repeat(60)), "Body");
    expect(Number(marginL)).toBe(Math.round(WIDTH * 0.07));
    expect(Number(marginR)).toBe(Math.round(WIDTH * 0.07));
  });

  // Raising a scene's subtitle to the middle would sit it over the action the shot exists to show.
  it("leaves the scene layout where it was", () => {
    const scene = sceneSubtitleAss("장면 자막", 5, WIDTH, HEIGHT);

    expect(scene).toContain("Noto Sans KR");
    expect(scene).not.toContain("Noto Serif KR");
    expect(scene).not.toContain("pos(");
  });
});

describe("the fonts this app ships", () => {
  /**
   * Every family the subtitles name is shipped, exactly once, and by a face that is not the family's thinnest.
   *
   * This used to check only that a file with the right family name existed — and it passed for two years while
   * both shipped files were the lightest instance in their family: Noto Serif KR ExtraLight 200 and Noto Sans
   * KR Thin 100. Captain D saw it as "글씨가 너무 얇아" in a finished video, which is the only place it was
   * visible, because `Bold: -1` was already set on the Quote style and libass was faking weight from a 200.
   *
   * Two rules, and the second is the one that was missing. Exactly one file per family, because two files
   * claiming the same typographic family leaves the choice to fontconfig's weight proximity — something this
   * app neither controls nor can test. And a real weight, because a family whose only face is Thin cannot be
   * made bold by asking.
   */
  it("ships one real weight for each family the subtitles ask for", async () => {
    const root = path.resolve(import.meta.dirname, "../../../../fonts");
    const files = (await fs.readdir(root)).filter((name) => name.toLowerCase().endsWith(".ttf"));

    const byFamily = new Map<string, { file: string; weight: number }[]>();
    for (const file of files) {
      const bytes = await fs.readFile(path.join(root, file));
      const weight = usWeightClass(bytes);
      for (const family of new Set(familyNames(bytes))) {
        byFamily.set(family, [...(byFamily.get(family) ?? []), { file, weight }]);
      }
    }

    // Read from the code rather than repeated here: a hand-written list would go on checking the family the
    // subtitles used to name, and say nothing about the one they name now — silently, which is the same way
    // libass fails when the name and the file disagree.
    for (const family of new Set([FONT_FAMILY, QUOTE_FONT_FAMILY])) {
      const faces = byFamily.get(family) ?? [];
      expect(faces.map((face) => face.file), `${family} must be shipped by exactly one file`).toHaveLength(1);
      expect(faces[0]!.weight, `${family} is shipped as ${faces[0]?.file}, which is too light to read on a card`)
        .toBeGreaterThanOrEqual(500);
    }
  });
});
