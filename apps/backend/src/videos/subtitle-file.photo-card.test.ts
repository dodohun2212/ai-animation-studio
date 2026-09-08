import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { PHOTO_CARD_SUBTITLE_CENTER, PHOTO_CARD_SUBTITLE_SCALE, SCENE_SUBTITLE_CENTER } from "@ai-animation-studio/shared";

import { ASS_WEIGHT, fontFileForFamily, usWeightClass } from "./font-file-tables.js";
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

  /**
   * A scene now positions its text the same WAY a card does, and is still not a card.
   *
   * 🔴 This test used to assert `not.toContain("pos(")` — that a scene was bottom-aligned, with no positioning
   * at all. That was the defect: the block sat inside the bottom eighth of the frame, under the caption and
   * buttons Reels draws there, which is the exact thing the card layout above exists to avoid (Cowork Round
   * 664 ①). A scene got the mechanism; what it did not get is the card's numbers, and that is what is checked
   * here. Its centre stays below the action rather than across it, which is the other true reason this is a branch.
   */
  it("gives a scene the card's positioning but not the card's look or its centre", () => {
    const scene = sceneSubtitleAss("장면 자막", 5, WIDTH, HEIGHT);

    expect(scene).toContain("Noto Sans KR");
    expect(scene).not.toContain("Noto Serif KR");
    expect(cueY(scene, "Default")).toBe(Math.round(HEIGHT * SCENE_SUBTITLE_CENTER.default));
    expect(cueY(scene, "Default")).toBeGreaterThan(Math.round(HEIGHT * PHOTO_CARD_SUBTITLE_CENTER.default));
  });
});

describe("the fonts this app ships", () => {
  /**
   * Every face the subtitles ask for is shipped, unambiguously, and heavy enough for the weight it was asked at.
   *
   * This used to check only that a file with the right family name existed — and it passed for two years while
   * both shipped files were the lightest instance in their family: Noto Serif KR ExtraLight 200 and Noto Sans
   * KR Thin 100. Captain D saw it as "글씨가 너무 얇아" in a finished video, which is the only place it was
   * visible, because `Bold: -1` was already set on the Quote style and libass was faking weight from a 200.
   *
   * 🟠 A request is a family AND a Bold flag, which is what changed here. The rule used to be one file per
   * family, on the ground that a second one left the choice to fontconfig; measured, that choice turns out to be
   * the style's own Bold flag (subtitle-font-weight.test.ts), and requiring one file per family would refuse the
   * two-weight directory 캡틴D's bold scene subtitle needs. `fontFileForFamily` still refuses what a request
   * genuinely cannot decide.
   *
   * 🔴 The floor is per request, and that is the half that was missing before: a bold style answered by a
   * lighter file is not refused, it is faked — which is the defect above, in the form it actually shipped in.
   * So the day the scene style asks for bold, this pair demands a real bold file in `fonts/` and stays red
   * until one is there.
   */
  it("ships one real weight for each face the subtitles ask for", async () => {
    const root = path.resolve(import.meta.dirname, "../../../../fonts");

    /*
     * The requests are read off the files the renderer hands to libass, not listed here. A hand-written list
     * would go on checking the face the subtitles used to ask for and say nothing about the one they ask for
     * now — silently, which is the same way libass fails when a name and a file disagree.
     */
    const requests = [sceneSubtitleAss("불광불급\n미치지 않으면 미치지 못한다", 5, WIDTH, HEIGHT, "photo-card"), sceneSubtitleAss("장면 자막", 5, WIDTH, HEIGHT)]
      .flatMap((ass) => ass.split("\n").filter((line) => line.startsWith("Style: ")))
      .map((line) => {
        const [, family, , , , , , bold] = line.slice("Style: ".length).split(",");
        return { family: family!, weight: bold === "-1" ? ASS_WEIGHT.bold : ASS_WEIGHT.regular };
      });
    // Named, because a parse that quietly returned nothing would leave this whole pair asserting about an empty
    // list. Three is what the two layouts write today: a scene's Default, and the card's Quote and Body.
    expect(requests.map((request) => request.family)).toEqual([QUOTE_FONT_FAMILY, FONT_FAMILY, FONT_FAMILY]);

    for (const { family, weight } of requests) {
      // Throws when nothing claims the family, and when two files are equally close to the requested weight.
      const face = await fontFileForFamily(root, family, weight);
      const floor = weight === ASS_WEIGHT.bold ? 700 : 500;
      expect(usWeightClass(face), `${family} at weight ${weight} is answered by a face libass would have to fake`)
        .toBeGreaterThanOrEqual(floor);
    }
  });
});
