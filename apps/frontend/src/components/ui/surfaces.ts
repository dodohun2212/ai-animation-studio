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

/**
 * 🔴 `disabled:hover:*` 세 줄에 대하여 — **꺼진 버튼은 마우스가 올라가도 밝아지면 안 됩니다.**
 *
 * hover 는 「이건 누를 수 있다」는 약속입니다. 꺼진 버튼이 그 약속을 하면 사람은 누르고, 아무 일도 안
 * 일어나고, **화면이 고장 난 줄 압니다.** `disabled:opacity-50` 은 흐리게만 할 뿐 hover 를 막지 않습니다.
 *
 * 🟠 `MappingReviewScreen` 의 지역 사본에만 이 조각(`disabled:hover:bg-transparent`)이 있었습니다 — 거기
 * 사람이 한 번 겪고 고친 것으로 보입니다. **한 화면이 겪은 것을 모든 화면이 물려받게** 여기로 올립니다.
 */
/**
 * 확인 상자 — 「아직 요청이 가지 않았습니다. 정말 하시겠습니까?」
 *
 * 🔴 2026-09-20: **서른두 벌이 열여덟 파일에 인라인**으로 적혀 있었습니다. 이름이 없어서 짝의 표에도
 * 안 걸렸고, 손으로 세어야 했습니다.
 *
 * 🟠 크기가 셋이었는데 **둘만 남깁니다**: 화면 폭을 쓰는 상자(`confirmPanel`)와 줄 안에 들어가는 상자
 * (`confirmPanelTight`). 🔴 셋째(`p-2.5`)는 **한 군데뿐이고 `p-3` 과 2px 차이**입니다 — 누가 정한 값이
 * 아니라 그때 적힌 값으로 보여 `tight` 로 보냅니다.
 *
 * 🔴 **색은 이번에 안 바꿉니다.** 지금 이 둘은 옛 차가운 그라데이션(`from-slate-900/80 to-slate-900/55`)
 * 그대로이고, `cardSection` 은 9/19 에 **따뜻한 한 겹**으로 옮겨 갔습니다(*「카드가 여섯 장 쌓이면 여섯 번의
 * 밝기 변화가 화면을 줄무늬로 만든다」*). 🟢 **모으는 것과 바꾸는 것을 한 번에 하지 않습니다** — 모아 두면
 * 그 변경은 **이 두 줄**이 됩니다. 서른두 군데를 한꺼번에 바꾸면서 그게 잘 보이는지 묻는 것과, 한 줄을
 * 바꾸고 묻는 것은 다른 일입니다.
 *
 * 🟠 테두리의 호박색은 유지합니다 — 「지금 당신의 답을 기다린다」는 뜻이고, 그건 상자의 역할입니다.
 */
export const confirmPanel =
  "space-y-3 rounded-xl border border-amber-400/40 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-4";

/** 줄 안에 들어가는 확인 상자 — 장면 한 줄, 판본 한 줄처럼 이미 좁은 자리. */
export const confirmPanelTight =
  "space-y-2 rounded-xl border border-amber-400/40 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-3";

/** The ordinary button: everything that is not the one thing the screen wants you to press. */
export const outlineButton =
  "rounded border border-line-strong px-4 py-2 text-sm text-bone-dim transition-[color,background-color,border-color] hover:border-bone-faint hover:bg-ground-raised hover:text-bone disabled:opacity-50 disabled:hover:border-line-strong disabled:hover:bg-transparent disabled:hover:text-bone-dim";

/**
 * 줄 안에 들어가는 작은 ordinary 버튼 — 표의 한 칸, 카드 머리, 목록의 한 줄.
 *
 * 🔴 2026-09-20: 이 이름이 **열한 파일에 저마다 적혀 있었고, 몸통이 네 가지**였습니다 — `py-1` 다섯,
 * `py-1.5` 넷, 그리고 `bg-white/[0.06]` 에 `font-medium` 까지 붙은 것 둘. **같은 이름이 네 가지로 보였습니다.**
 *
 * 🟠 열한 개가 전부 `text-slate-300`·`text-slate-100`(차가운 회색 계단)에 머물러 있었습니다. 위의
 * `outlineButton` 은 따뜻한 검정·뼈색으로 옮겨 갔는데 이것만 안 따라온 것이라, 한 화면에 큰 버튼과 작은
 * 버튼이 **서로 다른 색 계통**으로 나란히 있었습니다.
 *
 * 🟢 높이는 `py-1` 로 맞춥니다 — 다섯 파일이 이미 그 값이고, 줄이 촘촘한 표에서 넘치지 않는 쪽입니다.
 */
export const smallOutlineButton =
  "rounded border border-line-strong px-3 py-1 text-xs text-bone-dim transition-[color,background-color,border-color] hover:border-bone-faint hover:bg-ground-raised hover:text-bone disabled:opacity-50 disabled:hover:border-line-strong disabled:hover:bg-transparent disabled:hover:text-bone-dim";

/**
 * 되돌릴 수 없는 행동 — 지우기 · 끊기 · 원본 파일 삭제.
 *
 * 🔴 2026-09-20: 네 파일에 저마다 적혀 있었고 **몸통이 둘**이었습니다. 다른 하나는 `AssetLibraryScreen` 의
 * 것으로, 채워진 배경(`bg-rose-500/10`)에 `font-medium` 과 `shadow-sm` 까지 붙어 **혼자 더 컸습니다.**
 *
 * 🟠 **왜 다른지 찾아봤습니다**(998 §2 에서 하마터면 쓸모 있는 차이를 버릴 뻔했으므로). 답: 그 파일의
 * **예전 `outlineButton` 도 똑같이** `bg-white/[0.06] font-medium shadow-sm` 였습니다. 즉 **위험 버튼이라서**
 * 다른 게 아니라 **그 파일 전체가 옛 모양**이었고, 997 에서 ordinary 쪽만 옮겨 이것만 남은 것입니다.
 * **차이가 역할이 아니라 파일을 따라갑니다** — 그러면 지워도 되는 차이입니다.
 *
 * 🟠 장미색은 여기 하나뿐입니다. 위험은 **드물어야 눈에 띄므로**, 한 화면에 여러 개가 필요해지면 그건
 * 버튼 문제가 아니라 그 화면이 위험한 일을 너무 많이 모아 둔 것입니다.
 */
export const dangerOutlineButton =
  "rounded border border-rose-400/40 px-4 py-2 text-sm text-rose-300 transition-[color,background-color,border-color] hover:border-rose-400/60 hover:bg-rose-500/10 hover:text-rose-200 disabled:opacity-50 disabled:hover:border-rose-400/40 disabled:hover:bg-transparent disabled:hover:text-rose-300";

/**
 * 줄 안에 들어가는 작은 위험 버튼 — 「삭제」 · 「제거」 · 「지우기」 · 「폴더에서 빼기」.
 *
 * 🔴 2026-09-20: 일곱 벌이 있었고 **이름이 다섯, 몸통이 넷**이었습니다(`smallDangerButton` ·
 * `smallRemoveButton` · `dangerButton` · 인라인 둘). 🟠 이름이 제각각이라 **이름으로 찾는 방법에 안 걸렸고**,
 * 999 를 서버에서 확인하다 「폴더 삭제」 옆의 「폴더에서 빼기」가 혼자 알약인 걸 보고 알았습니다.
 *
 * 🟢 다섯을 여기로 모읍니다. 🔴 **나머지 둘은 안 모읍니다** — `AudioLibraryScreen` 의 삭제 확인과
 * `StoryPromptScreen` 의 `confirm-regenerate` 는 **확인 상자 안에서 실제로 그 일을 하는 버튼**이고,
 * `font-semibold` 는 그래서 붙어 있습니다. **차이가 파일이 아니라 역할을 따라가므로 남깁니다**(Round 999 §2).
 * 그쪽은 별도의 `dangerConfirmButton` 자리이고, 앱의 확인 상자를 전부 센 다음에 할 일입니다.
 */
export const smallDangerOutlineButton =
  "rounded border border-rose-400/40 px-3 py-1 text-xs text-rose-300 transition-[color,background-color,border-color] hover:border-rose-400/60 hover:bg-rose-500/10 hover:text-rose-200 disabled:opacity-50 disabled:hover:border-rose-400/40 disabled:hover:bg-transparent disabled:hover:text-rose-300";

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
