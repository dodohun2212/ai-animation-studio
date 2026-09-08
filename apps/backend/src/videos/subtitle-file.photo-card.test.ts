import * as fs from "node:fs/promises";
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
    const [, bodyFont, bodySize, , , , , bodyBold] = styleRow(ass, "Body");
    expect(quoteFont).toBe("Noto Serif KR");
    expect(bodyFont).toBe("Noto Sans KR");
    expect(Number(bodySize)).toBe(Math.round(HEIGHT * PHOTO_CARD_SUBTITLE_SCALE.default)); // 52 at 1920
    expect(Number(quoteSize)).toBe(Math.round(Math.round(HEIGHT * PHOTO_CARD_SUBTITLE_SCALE.default) * 1.4)); // 73
    expect(quoteBold).toBe("-1");
    /*
     * 🟠 The body asks for bold too, and it did not used to. Both sans styles were flipped together on purpose:
     * SCENE_SUBTITLE_CSS_RATIO is DERIVED from the card body's, on the ground that the ratio is a property of
     * the face rather than of either layout. Bolding only the scene would have made that derivation false —
     * two layouts drawing in two different files behind one shared number — and the preview reading it would
     * have been wrong for whichever of them lost the coin toss.
     */
    expect(bodyBold).toBe("-1");
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
    // The weight 캡틴D picked off the reference, and the field that picks the FILE rather than a faked stroke.
    expect(styleRow(scene, "Default")[7]).toBe("-1");
    expect(cueY(scene, "Default")).toBe(Math.round(HEIGHT * SCENE_SUBTITLE_CENTER.default));
    expect(cueY(scene, "Default")).toBeGreaterThan(Math.round(HEIGHT * PHOTO_CARD_SUBTITLE_CENTER.default));
  });
});

/**
 * Every (family, weight) pair the renderer hands to libass, read off the files it actually writes.
 *
 * Read rather than listed, and that is the whole point: a hand-written list goes on checking the face the
 * subtitles used to ask for and says nothing about the one they ask for now — silently, which is the same way
 * libass fails when a name and a file disagree.
 */
function subtitleFontRequests(): { family: string; weight: number }[] {
  return [sceneSubtitleAss("불광불급\n미치지 않으면 미치지 못한다", 5, WIDTH, HEIGHT, "photo-card"), sceneSubtitleAss("장면 자막", 5, WIDTH, HEIGHT)]
    .flatMap((ass) => ass.split("\n").filter((line) => line.startsWith("Style: ")))
    .map((line) => {
      const [, family, , , , , , bold] = line.slice("Style: ".length).split(",");
      return { family: family!, weight: bold === "-1" ? ASS_WEIGHT.bold : ASS_WEIGHT.regular };
    });
}

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

    const requests = subtitleFontRequests();
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

  /**
   * The preview declares a real face for every weight the RENDER asks for, pointing at the same file.
   *
   * 🔴 This crosses into apps/frontend on purpose, because the defect it guards lives between the two and
   * neither side can see it alone. The preview exists to show what the video will look like; when it draws
   * with a different face than libass does, nothing is red anywhere and the difference surfaces only in a
   * finished video. That has already happened twice. The first time the preview named two families the
   * browser had never heard of and fell back to a system font, so `font-weight: 700` did nothing — 캡틴D saw
   * it as "글씨가 너무 얇아". The second time is the one this pair is written for: the scene style flipped to
   * `Bold: -1` (3a56577) and the render started drawing from a 700 file while styles.css declared only a 500.
   *
   * 🔴 And that second one is silent in the direction that matters. `font-synthesis: none` means the browser
   * does NOT fake the missing weight — it quietly keeps drawing the 500. So the preview looks fine, shows a
   * thinner line than the video, and the overflow warning it exists to raise comes late. Nothing throws.
   *
   * What is compared is the FILE, not the number. A declaration may say any weight it likes as long as it is
   * the weight the file actually is: asking for a weight no shipped face has puts the browser back on
   * nearest-match, which is the guess the render side deliberately stopped relying on (D-049).
   *
   * 🟠 If this goes red because the stylesheet moved or was renamed, that is not a false alarm to route
   * around — the invariant needs a new home, not a deleted pair.
   */
  it("declares a preview face for every weight the render asks for, from the same file", async () => {
    const root = path.resolve(import.meta.dirname, "../../../../fonts");
    const stylesheetPath = path.resolve(import.meta.dirname, "../../../../apps/frontend/src/styles.css");
    const stylesheet = await fs.readFile(stylesheetPath, "utf8").catch(() => undefined);
    expect(stylesheet, `${stylesheetPath} is where the subtitle preview declares its faces; it is not there any more`)
      .toBeDefined();

    /*
     * The three fields this guard needs, per @font-face block. Deliberately a small hand-rolled parse of a
     * file this repository writes and controls — the same reasoning font-file-tables.ts is written under.
     */
    const declared = [...stylesheet!.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((block) => ({
      family: /font-family:\s*"([^"]+)"/.exec(block[1]!)?.[1],
      weight: Number(/font-weight:\s*(\d+)/.exec(block[1]!)?.[1]),
      file: /src:\s*url\("[^"]*\/([^"/]+)"/.exec(block[1]!)?.[1],
    }));
    // Named, so a regex that quietly matched nothing cannot leave the loop below asserting about an empty list.
    expect(declared.map((face) => `${face.family} ${face.weight}`)).toEqual(["Noto Serif KR 700", "Noto Sans KR 500", "Noto Sans KR 700"]);

    // A face that fails to load is not faked either — which is what makes a missing declaration silent rather
    // than merely wrong, and is therefore part of what this pair is protecting.
    expect(stylesheet).toContain("font-synthesis: none");

    const names = await fs.readdir(root);
    for (const { family, weight } of subtitleFontRequests()) {
      const wanted = await fontFileForFamily(root, family, weight);
      // Which file in fonts/ the renderer resolved to, by its bytes rather than by a name written here.
      const wantedName = (await Promise.all(names.map(async (name) => ({ name, bytes: await fs.readFile(path.join(root, name)) }))))
        .find((candidate) => candidate.bytes.equals(wanted))!.name;
      const match = declared.find((face) => face.family === family && face.file === wantedName);
      expect(match, `the preview draws ${family} at weight ${weight} with something other than ${wantedName}, which is what the video is burned with`)
        .toBeDefined();
      expect(match!.weight, `${wantedName} is a ${usWeightClass(wanted)}, and the preview declares it as a ${match!.weight} — the browser will pick by proximity from here`)
        .toBe(usWeightClass(wanted));
    }
  });
});
