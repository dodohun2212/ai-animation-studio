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
