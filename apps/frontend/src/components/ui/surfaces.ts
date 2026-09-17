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
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 transition-[color,background-color,border-color,transform] hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/5 disabled:opacity-50 disabled:hover:translate-y-0";

/** The one call to action per screen, carrying §2.5's glow-cta. */
export const primaryButton =
  "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] transition-[opacity,transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-8px_rgba(236,72,153,0.55)] disabled:opacity-50 disabled:hover:translate-y-0";

/** A second, weaker call to action — an alternative to the primary, not an ordinary control. */
export const secondaryButton =
  "rounded-full border border-violet-400/30 px-4 py-2 text-sm text-violet-300 transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-violet-500/10";

/**
 * The gold accent — 디자인 톤 B의 유일한 포인트 색. §2.1의 보라·핑크와 부딪히지 않도록, 화면 하나에 한
 * 군데(단 하나의 강조 배지나 버튼)에만 쓴다. 다른 곳에서 또 쓰고 싶어지면 그건 강조가 아니라 팔레트가 된
 * 것이니 §2.1로 돌아갈 것.
 */
export const goldButton =
  "rounded-full bg-gradient-to-br from-[#f3d9a4] to-gold px-4 py-2 text-sm font-semibold text-gold-ink transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0";

/**
 * A card that enters once with a soft rise, then sits completely still — the shine on hover is the only thing
 * that ever moves again. Pair with an `animationDelay` inline style (index * ~60ms) when several of these render
 * in one list, so they arrive in the same order the eye reads them rather than all at once.
 */
export const riseInCard =
  "effect-card opacity-0 [animation:rise-in_0.45s_ease_forwards] motion-reduce:opacity-100 motion-reduce:[animation:none]";

/** A single status dot that pulses — only for a thing that is actually happening right now, never a finished one. */
export const pulseDot =
  "inline-block h-1.5 w-1.5 rounded-full bg-current [animation:pulse-dot_1.4s_ease-in-out_infinite] motion-reduce:[animation:none]";

/**
 * A list whose length the user does not control — search results over the whole image library, or every
 * project ever made.
 *
 * 🔴 캡틴D hit this while picking a 분위기 image: the search returns every stored asset, each as a full-width
 * row, so twenty-odd images pushed the search box and every section below it off the screen. The list was not
 * wrong about its contents; it just had no ceiling.
 *
 * `AssetLibraryScreen`'s 에셋 목록 already did this by hand and is deliberately left taller — that list is the
 * whole screen's subject, not one field inside a form.
 *
 * Lists the user built themselves — the images they actually picked — are NOT capped. Their length is the
 * user's own doing, and folding their own choices out of sight is a different and worse problem.
 */
export const scrollList = "max-h-64 space-y-1 overflow-y-auto pr-1";
