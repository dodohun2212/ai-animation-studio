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

/**
 * A card. The default: a heading and a few rows.
 *
 * 🟠 2026-09-19: 파랑 쪽 먹색 그라데이션(`slate-900`)에서 **따뜻한 검정 한 겹**으로 바꿨습니다. 그라데이션은
 * 카드 하나를 볼 때는 예뻤지만, 카드가 여섯 장 쌓이면 여섯 번의 밝기 변화가 화면을 줄무늬로 만들었습니다.
 * 카드를 구분하는 일은 **선**이 합니다 — 그게 선이 하는 일입니다.
 */
export const cardSection =
  "space-y-3 rounded-lg border border-line bg-ground-raised p-5";

/** A card whose rows are controls rather than text, and so need more air between them. */
export const cardSectionWide =
  "space-y-4 rounded-lg border border-line bg-ground-raised p-5";

/** A card that is the whole screen's subject — used where one card carries the screen. */
export const cardSectionRoomy =
  "space-y-4 rounded-lg border border-line bg-ground-raised p-6";

/** The ordinary button: everything that is not the one thing the screen wants you to press. */
export const outlineButton =
  "rounded border border-line-strong px-4 py-2 text-sm text-bone-dim transition-[color,background-color,border-color] hover:border-bone-faint hover:bg-ground-raised hover:text-bone disabled:opacity-50";

/**
 * The one call to action per screen.
 *
 * 🔴 2026-09-19: 보라→자홍 그라데이션에 형광 그림자까지 얹혀 있던 버튼을 **뼈색 판에 검은 글자**로
 * 바꿨습니다. 어두운 화면에서 제일 강한 대비는 색이 아니라 **밝기의 반전**이고, 반전은 화면에 딱 하나만
 * 있을 수 있어서 「이 화면의 한 가지 행동」이라는 뜻이 저절로 지켜집니다. 형광 그림자는 색을 하나 더 쓰면
 * 쓸수록 약해지는 종류의 강조였습니다.
 *
 * 🟠 눌리는 느낌은 뜨는 것(`-translate-y`)이 아니라 **살짝 어두워지는 것**으로 바꿨습니다. 목록 화면에서
 * 마우스만 지나가도 버튼이 떠오르면, 가만히 있어야 할 도록 위에서 그것만 계속 움직입니다.
 */
export const primaryButton =
  "rounded bg-bone px-4 py-2 text-sm font-semibold text-ground transition-colors hover:bg-[#cfc8bb] disabled:opacity-40";

/** A second, weaker call to action — an alternative to the primary, not an ordinary control. */
export const secondaryButton =
  "rounded border border-bone-faint/60 px-4 py-2 text-sm text-bone transition-colors hover:bg-ground-raised";

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


/**
 * `riseInCard` 의 **빛 없는 판**. 도착은 같은 순서로 하되, 그 뒤로는 아무것도 움직이지 않습니다.
 *
 * 🔴 콘택트 시트에는 `effect-card` 의 스치는 빛을 쓰지 않습니다. 프레임 안에 있는 것이 **실제 사진**이라,
 * 그 위로 흰 띠가 지나가면 사진에 그런 빛이 있는 것처럼 보입니다. 화면이 내용에 대해 거짓말을 하는 쪽이라
 * 값이 마이너스입니다. 빈 카드 위의 빛과 사진 위의 빛은 다른 물건입니다.
 */
export const riseIn =
  "opacity-0 [animation:rise-in_0.45s_ease_forwards] motion-reduce:opacity-100 motion-reduce:[animation:none]";
