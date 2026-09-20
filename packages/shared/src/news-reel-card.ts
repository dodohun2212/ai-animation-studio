import type { NewsReelCard, NewsReelTextField, NewsReelTextRefusal } from "./api.js";
import { NEWS_REEL_TEXT_BOXES, NEWS_REEL_TEXT_FIELDS } from "./api.js";

/**
 * How many characters a news reel card's boxes hold — counted in one place, for both sides.
 *
 * 🔴 **One counter, in `shared`, because two cannot be trusted to agree.** Exactly the move `checkNewsSummary`
 * made, and asked for here by name (Cowork Round 1028 §3): the screen shows what is left in a box while
 * somebody types, and the server refuses a card that does not fit. Those two answers must be the same answer.
 * A limit written down twice drifts, and the half that drifts is the half that stops blocking.
 *
 * 🔴 **Why a limit at all: 부탁은 안 지켜지고 칸이 지킨다.** Asking a model for a short headline produces a
 * long one; a box that refuses 16 characters produces 15. The numbers live in {@link NEWS_REEL_TEXT_BOXES}
 * with the measurement behind them.
 *
 * 🟠 **What this cannot see.** It counts code points and treats each as one Hangul square. Latin letters,
 * digits and spaces are narrower in the burning font, so a full box of those under-fills — the safe
 * direction. Nothing has been measured *wider* than a Hangul square, and nothing has ruled it out either: an
 * emoji is not in `NotoSansKR` at all and would be drawn from whatever the system falls back to. This is a
 * floor on overflow, not a promise about every string.
 */

/**
 * The number a box shows: code points, with the ends trimmed.
 *
 * 🔴 **Code points, not UTF-16 units.** `.length` counts a surrogate pair as two, which would refuse a
 * perfectly ordinary 14-character line for holding one character that is stored in two halves.
 *
 * 🟠 **Trimmed at the ends, and runs of spaces inside are *not* collapsed.** Trailing space is not ink, so
 * counting it would redden a line that fits. Doubled spaces inside are counted as they are written, which
 * over-counts slightly — and over-counting refuses, which is the direction this leans.
 */
export function countNewsReelText(value: string): number {
  return Array.from(value.trim()).length;
}

/**
 * One box, counted. What a screen calls on every keystroke — `remaining` is the number beside the field, and
 * the screen never writes the limit down itself.
 */
export interface NewsReelTextBox {
  field: NewsReelTextField;
  limit: number;
  count: number;
  /** `limit - count`. Negative when the box is over, which is how far over it is. */
  remaining: number;
  /** `null` when the box is usable as it stands. */
  refusal: NewsReelTextRefusal | null;
}

/**
 * Count one box.
 *
 * 🔴 **`null` and `""` are different for an optional box, and the same for a required one.** A `null`
 * `caption.line2` is a one-line caption and nothing is wrong with it; a `caption.line2` holding `""` is the
 * empty-string-as-value this contract refuses everywhere — it cannot be told apart from "not written yet".
 * For a required box both mean the same thing, so both are `missing` and there is nothing to distinguish.
 *
 * 🟠 A screen binding a text input to this passes `""` before anybody types, and gets `blank` back. That is
 * the intended answer, not a nuisance: the box is not yet in a state a card can be built from, and an empty
 * optional line has to become `null` somewhere — better here, loudly, than in the file.
 */
export function newsReelTextBox(field: NewsReelTextField, value: string | null): NewsReelTextBox {
  const { limit, required } = NEWS_REEL_TEXT_BOXES[field];
  const count = value === null ? 0 : countNewsReelText(value);
  const refusal: NewsReelTextRefusal | null =
    count > limit ? "too_long"
    : required && count === 0 ? "missing"
    : !required && value !== null && count === 0 ? "blank"
    : null;
  return { field, limit, count, remaining: limit - count, refusal };
}

/**
 * What a whole card's text does and does not fit.
 *
 * 🔴 **Not a verdict, the same way `NewsSummaryCheck` is not one.** `boxes` carries every box that was looked
 * at, refused or not: "four boxes, none over" and "nothing counted" are different facts, and a list of
 * failures alone cannot tell them apart.
 *
 * 🟠 **Text only.** Whether `creditText` is present when `creditRequired` is true is a rule about the picture,
 * not about character counts, and it is refused where the card is built — beside the picture that raised it.
 */
export interface NewsReelCardTextCheck {
  boxes: NewsReelTextBox[];
  /** Convenience over `boxes`, and required to agree with it — the ones whose `refusal` is not `null`. */
  refused: NewsReelTextBox[];
}

/** The value in a card for one named box, so the walk below never spells a field name twice. */
function textAt(card: NewsReelCard, field: NewsReelTextField): string | null {
  switch (field) {
    case "headline.line1": return card.headline.line1;
    case "headline.line2": return card.headline.line2;
    case "caption.line1": return card.caption.line1;
    case "caption.line2": return card.caption.line2;
  }
}

export function checkNewsReelCardText(card: NewsReelCard): NewsReelCardTextCheck {
  const boxes = NEWS_REEL_TEXT_FIELDS.map((field) => newsReelTextBox(field, textAt(card, field)));
  return { boxes, refused: boxes.filter((box) => box.refusal !== null) };
}

/**
 * One Hangul syllable's width, as a share of the font size — **measured, not assumed.**
 *
 * Drawn through ffmpeg into 1080×1920 with the bundled `NotoSansKR-*.ttf` and the ink counted in pixels, the
 * ratio came out **0.63 at five different sizes** (52 · 64 · 72 · 80 · 96), and bold changed it by 0.1px
 * (CLI Round 1021). A line with spaces in it measures *narrower* than this, so 0.63 is the worst case and the
 * right number to size a box against.
 *
 * 🟠 Two earlier values were guesses and both were wrong: 1.00 (assumed, never drawn) and 0.77 (measured, but
 * in the browser's preview font rather than the one that burns).
 */
export const HANGUL_WIDTH_RATIO = 0.63;

/** The share of the frame's width kept clear on each side. */
const SIDE_MARGIN_RATIO = 0.06;

/**
 * 🔴 **Nothing is drawn below this line.** Instagram's own caption, buttons and handle sit over the bottom of a
 * reel, which is why the photo card's own centre slider warns above 0.85 — the same frame, the same overlay.
 */
const BOTTOM_SAFE_RATIO = 0.84;

/** Every number a news reel card is drawn from, in output pixels. */
export interface NewsReelCardGeometry {
  /** Left and right margin. */
  margin: number;
  /** What a line actually has to fit in — the frame less both margins. */
  usableWidth: number;
  /** Horizontal centre; every line is placed by its own centre. */
  centerX: number;
  /** The publisher band across the top: it starts at y=0 and is this tall. */
  bandHeight: number;
  publisherSize: number;
  /** Vertical centre of the publisher's name inside the band. */
  publisherY: number;
  headlineSize: number;
  /** Vertical centre of each headline line. */
  headline1Y: number;
  headline2Y: number;
  captionSize: number;
  /** The caption band: this tall, with its top edge here. Its bottom sits on the safe line. */
  captionBandHeight: number;
  captionBandY: number;
  /** Vertical centre of each caption line. The second is only drawn when there is one. */
  caption1Y: number;
  caption2Y: number;
}

/**
 * Where a news reel card's bands and lines land.
 *
 * Here, beside the contract, for the reason `photoCardSubtitleGeometry` is: the renderer burns this into the
 * video and a preview draws it before anything is rendered, and a preview that re-implements the arithmetic is
 * a preview that can be wrong in silence — showing somebody a picture of a video that was never made.
 *
 * 🔴 **The font sizes are derived from the contract's own limits, never chosen.** A full line is exactly as
 * wide as the space it has: `size = usableWidth / (limit × 0.63)`. That makes the box and the frame unable to
 * disagree — change `headline.line1` to 13 characters and the letters grow so that 13 still fills the line,
 * with no second number to remember. Typing `96` here instead would be the copy that goes wrong the day the
 * limit moves, and it would go wrong *after* a reel had been made.
 *
 * 🟠 **The vertical placement is a choice, and is written here as one.** The band heights and the gap between
 * the two headline lines were picked to look like the reels 캡틴D pointed at (Cowork Round 1018), not measured
 * off a frame — what *is* pinned is that nothing overlaps, nothing leaves the frame, and nothing crosses
 * {@link BOTTOM_SAFE_RATIO}. Cowork measures the real vertical positions once the screen draws them.
 */
export function newsReelCardGeometry(width: number, height: number, captionLineCount: 1 | 2): NewsReelCardGeometry {
  const margin = Math.round(width * SIDE_MARGIN_RATIO);
  const usableWidth = width - margin * 2;
  const sizeFor = (limit: number): number => Math.floor(usableWidth / (limit * HANGUL_WIDTH_RATIO));

  const headlineSize = sizeFor(NEWS_REEL_TEXT_BOXES["headline.line1"].limit);
  const captionSize = sizeFor(NEWS_REEL_TEXT_BOXES["caption.line1"].limit);
  // 🟠 The publisher is a label, not a line of the card — it reads at a little under half the headline.
  const publisherSize = Math.round(headlineSize * 0.45);

  const bandHeight = Math.round(publisherSize * 2.4);
  const publisherY = Math.round(bandHeight / 2);

  // 🟠 1.15 rather than the 1.00 libass uses for its own wrapping: these two lines are placed individually and
  // are large, and at this size the auto spacing reads as one crowded block rather than two lines.
  const headlineGap = Math.round(headlineSize * 1.15);
  const headline1Y = bandHeight + Math.round(headlineSize * 1.1);
  const headline2Y = headline1Y + headlineGap;

  const captionGap = Math.round(captionSize * 1.25);
  const captionPad = Math.round(captionSize * 0.7);
  const captionBandHeight = captionPad * 2 + captionSize + (captionLineCount === 2 ? captionGap : 0);
  const captionBandBottom = Math.round(height * BOTTOM_SAFE_RATIO);
  const captionBandY = captionBandBottom - captionBandHeight;
  const caption1Y = captionBandY + captionPad + Math.round(captionSize / 2);

  return {
    margin,
    usableWidth,
    centerX: Math.round(width / 2),
    bandHeight,
    publisherSize,
    publisherY,
    headlineSize,
    headline1Y,
    headline2Y,
    captionSize,
    captionBandHeight,
    captionBandY,
    caption1Y,
    caption2Y: caption1Y + captionGap,
  };
}
