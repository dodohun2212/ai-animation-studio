import { newsReelCardGeometry, type NewsReelCard } from "@ai-animation-studio/shared";

import { assColour, type Rgb } from "./card-palette.js";
import { FONT_FAMILY, escapeDialogueText, timestamp } from "./subtitle-file.js";

/**
 * A news reel card's whole overlay — both bands and all four lines — as one `.ass` file.
 *
 * 🔴 **Everything is in the subtitle file, including the two coloured bands.** They could have been `drawbox`
 * steps in the filter graph instead, and then one visual element would live in two places: the band in the
 * graph, the text over it in the `.ass`, and any preview would have to redraw both. Drawn here, the merge is
 * not touched at all — it already burns an `.ass` — which is the same move the multi-picture photo card made
 * when it turned out `merge()` needed no change.
 *
 * 🔴 **The two headline lines are two cues in two colours, because that is what they are.** White carries the
 * situation, yellow carries how it ended (read off the reels 캡틴D pointed at — docs/06_DECISIONS.md D-055). A single
 * cue with a line break in it could not be two colours, which is the same reason the contract holds them as
 * two fields rather than one string.
 */

/** The band behind the publisher's name. Dark navy, as the reels 캡틴D pointed at use. */
const BAND_COLOUR: Rgb = { r: 11, g: 30, b: 58 };
/** The publisher's name, and both caption lines. */
const ON_BAND_COLOUR: Rgb = { r: 255, g: 255, b: 255 };
/** The headline's first line. */
const HEADLINE_COLOUR: Rgb = { r: 255, g: 255, b: 255 };
/**
 * The headline's second line.
 *
 * 🟠 Yellow is not decoration — it is which half of the headline lands. Named here once so the pair that reads
 * it and the style that writes it cannot drift apart.
 */
const HEADLINE_ACCENT_COLOUR: Rgb = { r: 255, g: 212, b: 0 };
/**
 * The caption band.
 *
 * 🟠 Not fully opaque: the picture under it is most of what the frame has, and a solid bar across the bottom
 * fifth throws away more of it than the caption is worth. `0x50` leaves the picture visible and still carries
 * white text — the one thing that must not be traded away.
 */
const CAPTION_BAND_ALPHA = 0x50;

/**
 * A filled rectangle, in ASS's own drawing mode.
 *
 * 🟠 `String.raw` throughout, and that is not a style choice: an override tag in a plain template literal
 * loses its backslash — `\an7` becomes `an7` — and libass then reads the whole thing as ordinary text. It
 * happened here, and the pairs that read the file passed anyway because **the test's own expectation lost the
 * same backslash and matched**. Only a rendered frame said otherwise.
 *
 * 🟠 `\an7\pos(0,0)` puts the drawing's own origin at the frame's top-left, so the coordinates below are
 * absolute pixels rather than an offset from wherever libass would have placed a line of text.
 */
function band(style: string, y: number, height: number, width: number, durationSeconds: number): string {
  const draw = String.raw`{\an7\pos(0,0)\p1}` + `m 0 ${y} l ${width} ${y} ${width} ${y + height} 0 ${y + height}` + String.raw`{\p0}`;
  return `Dialogue: 0,${timestamp(0)},${timestamp(durationSeconds)},${style},,0,0,0,,${draw}`;
}

export function newsReelCardAss(card: NewsReelCard, durationSeconds: number, width: number, height: number): string {
  const captionLineCount = card.caption.line2 === null ? 1 : 2;
  const g = newsReelCardGeometry(width, height, captionLineCount);

  /**
   * 🔴 `MarginL`/`MarginR` are the frame's own margins, so a line that somehow runs long wraps **inside the
   * picture** rather than off the side of it. The contract is what stops a line running long; this is what
   * happens if it ever fails to.
   */
  const style = (name: string, size: number, primary: string, bold: 0 | -1, outline: number, shadow: number) =>
    `Style: ${name},${FONT_FAMILY},${size},${primary},&H000000FF,&H00000000,&H80000000,${bold},0,0,0,100,100,0,0,1,${outline},${shadow},5,${g.margin},${g.margin},0,1`;

  const cue = (styleName: string, y: number, content: string, layer = 1) =>
    `Dialogue: ${layer},${timestamp(0)},${timestamp(durationSeconds)},${styleName},,0,0,0,,` + String.raw`{\an5\pos(` + `${g.centerX},${y}` + String.raw`)}` + escapeDialogueText(content);

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // 🟠 The bands carry no outline or shadow of their own — a drawn rectangle with a border is a rectangle
    // with a seam down its edge.
    style("Band", 1, assColour(BAND_COLOUR), 0, 0, 0),
    style("CaptionBand", 1, assColour(BAND_COLOUR, CAPTION_BAND_ALPHA), 0, 0, 0),
    style("Publisher", g.publisherSize, assColour(ON_BAND_COLOUR), -1, 0, 0),
    style("Headline", g.headlineSize, assColour(HEADLINE_COLOUR), -1, 4, 2),
    style("HeadlineAccent", g.headlineSize, assColour(HEADLINE_ACCENT_COLOUR), -1, 4, 2),
    style("Caption", g.captionSize, assColour(ON_BAND_COLOUR), -1, 2, 1),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    // Layer 0 for both bands, so every line below is drawn over them whatever order they are listed in.
    band("Band", 0, g.bandHeight, width, durationSeconds),
    band("CaptionBand", g.captionBandY, g.captionBandHeight, width, durationSeconds),
    cue("Publisher", g.publisherY, card.publisher),
    cue("Headline", g.headline1Y, card.headline.line1),
    cue("HeadlineAccent", g.headline2Y, card.headline.line2),
    cue("Caption", g.caption1Y, card.caption.line1),
    ...(card.caption.line2 === null ? [] : [cue("Caption", g.caption2Y, card.caption.line2)]),
    "",
  ].join("\n");
}
