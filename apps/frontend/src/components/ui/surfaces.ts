/**
 * The class strings every screen was already writing out by hand.
 *
 * 🔴 These are not new styles. `outlineButton` was written identically in 21 files, `primaryButton` in 15 and
 * `cardSection` in 19 — and the copies had already begun to disagree: three of them sat on `text-slate-200`,
 * a shade §2.1 does not have. A shared constant is the only version of "every screen looks the same" that
 * stays true after the next screen is added.
 *
 * What changed while gathering them is deliberately small: a card is a gentle vertical gradient rather than
 * one flat fill, so a stack of cards reads as separate surfaces instead of one long slab, and the outline
 * button's border brightens on hover so it answers the pointer. Both stay inside §2.1's palette — no new
 * colour, and no fourth glow beyond the three §2.5 allows.
 */

/** A card. The default: a heading and a few rows. */
export const cardSection =
  "space-y-3 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-5";

/** A card whose rows are controls rather than text, and so need more air between them. */
export const cardSectionWide =
  "space-y-4 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-5";

/** A card that is the whole screen's subject — used where one card carries the screen. */
export const cardSectionRoomy =
  "space-y-4 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-6";

/** The ordinary button: everything that is not the one thing the screen wants you to press. */
export const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:border-white/20 hover:bg-white/5 disabled:opacity-50";

/** The one call to action per screen, carrying §2.5's glow-cta. */
export const primaryButton =
  "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] transition-opacity disabled:opacity-50";

/** A second, weaker call to action — an alternative to the primary, not an ordinary control. */
export const secondaryButton =
  "rounded-full border border-violet-400/30 px-4 py-2 text-sm text-violet-300 transition-colors hover:bg-violet-500/10";
