import {
  NEWS_REEL_TEXT_BOXES,
  type NewsArticleInput,
  type NewsReelHeadline,
  type NewsReelTextField,
  type NewsReelTextSlot,
} from "@ai-animation-studio/shared";

/**
 * What the model is asked for when the answer is a **card**, not a summary.
 *
 * 🔴 **The prompt is not what makes this safe.** A model told to use only the article's figures uses fewer
 * invented ones and still invents some — `checkNewsSummary` runs on what comes back, exactly as it does for
 * the summary, and nothing here should be read as making that check less necessary. The instructions shift
 * the odds; the check is what refuses.
 *
 * 🔴 **Why this exists at all: the first real reel came out wrong, and the prompt was half of why.** The
 * summary prompt says 「요약해 주세요」, so the model wrote a wire-service paragraph — 271 characters in one
 * run, into a line that holds 15 (docs/06_DECISIONS.md D-052). Asking one question and cutting the answer into three
 * pieces cannot produce three things that do different jobs.
 *
 * 🔴 **Three values, three jobs** (read off MBC's own reels — docs/06_DECISIONS.md D-052):
 *
 * ```
 * 제목 1줄   상황 · 맥락      「이 대통령 회견 하루 만에」
 * 제목 2줄   한 방 · 결과      「김승원 자진 사퇴」        ← 노란 줄
 * 자막       지금 보이는 것     「9월 19일 북항 친수공원」   ← 캡틴D: 「상황 설명」이라 이쪽이 조금 더 문장
 * ```
 *
 * 🔴 **Two rules that pull against each other, so they are stated together.** The wording must be *new* —
 * copying the article's sentences is what produced the wire-service voice — while the **figures, dates and
 * quotations must be the article's, word for word**, because those are what gets checked and what a reader
 * is being told is true. 「기사에 있는 내용만 쓰라」 alone does not say this: it bounds the *facts* and says
 * nothing about the *wording*, and the two are different things (docs/06_DECISIONS.md D-052).
 */

/**
 * One label per box. A caption label carries its picture: 「자막2-1」 is the first line under the second picture.
 * 🟠 One scheme for every count — a one-picture reel is 「자막1-1」 too — so the parser never has to guess which
 * scheme an answer used.
 */
const HEADLINE_LABELS = { "headline.line1": "제목1", "headline.line2": "제목2" } as const;
const captionLabel = (scene: number, line: 1 | 2): string => `자막${scene + 1}-${line}`;

const JOBS: Readonly<Record<NewsReelTextField, string>> = {
  "headline.line1": "무슨 일이 있었는지의 **배경·상황**. 사람이 이 줄만 보고 「무슨 얘긴지」 알 수 있어야 합니다.",
  "headline.line2": "그래서 **결국 어떻게 됐는지** 한 방으로. 이 줄이 노란색으로 나갑니다 — 제일 세게 남는 줄입니다.",
  "caption.line1": "그 그림이 떠 있는 동안 아래에 깔리는 자막. **무엇이 있었는지**, 언제·어디인지를 짧은 문장으로.",
  "caption.line2": "자막이 한 줄로 모자랄 때만 씁니다. **모자라지 않으면 이 줄은 아예 쓰지 마십시오.**",
};

const limitOf = (field: NewsReelTextField): number => NEWS_REEL_TEXT_BOXES[field].limit;

/**
 * 🔴 캡틴D, 2026-09-22: 「릴스가 몇 장면 몇 분인 줄 알고 이렇게 적음?」 — the card now has a caption per picture,
 * so the model is told how many pictures there are and asked for that many captions, each saying something the
 * others do not, in the order the article tells it.
 */
export function newsReelCardPrompt(article: NewsArticleInput, sceneCount: number): string {
  const scenes = Array.from({ length: sceneCount }, (_, scene) => scene);
  return [
    "아래 기사로 **짧은 뉴스 릴 카드**에 얹을 글을 써 주세요.",
    "",
    `**요약문이 아닙니다.** 릴은 그림 ${sceneCount}장이 차례로 넘어가고, 위에는 제목 두 줄이 릴 내내 고정으로, 아래에는 **그림마다 다른 자막**이 깔립니다. 한 문단을 쓰고 자르는 것이 아니라, 아래 줄을 각각 따로 써 주십시오.`,
    "",
    `- **${HEADLINE_LABELS["headline.line1"]}**: ${limitOf("headline.line1")}자 이내. ${JOBS["headline.line1"]}`,
    `- **${HEADLINE_LABELS["headline.line2"]}**: ${limitOf("headline.line2")}자 이내. ${JOBS["headline.line2"]}`,
    `- **자막N-1** (N = 1부터 ${sceneCount}까지, N번째 그림): ${limitOf("caption.line1")}자 이내. ${JOBS["caption.line1"]}`,
    `- **자막N-2**: ${limitOf("caption.line2")}자 이내. ${JOBS["caption.line2"]}`,
    ...(sceneCount > 1
      ? ["- 자막은 **그림마다 다른 사실**을 씁니다. 같은 말을 되풀이하지 않고, 기사가 전하는 순서대로 이어지게 씁니다."]
      : []),
    "",
    "**말은 새로 지어 주세요.** 기사의 문장을 그대로 옮기지 않습니다 — 통신사 문체가 그대로 따라옵니다.",
    "- 직함을 길게 붙이지 않습니다. 「…라고 밝혔다」, 「…한 것으로 전해졌다」 같은 끝맺음을 쓰지 않습니다.",
    "- 짧은 말로 끊습니다. 한 줄에 여러 사실을 밀어 넣지 않습니다.",
    "",
    "**그런데 숫자·날짜·인용문은 기사에 적힌 그대로만 씁니다.** 표현은 새로 짓되 **사실은 기사 안에서만** 가져옵니다. 기사에 없는 숫자·날짜·인용문은 절대 만들어 넣지 않습니다. 기사가 말하지 않은 원인이나 결과도 쓰지 않습니다.",
    "- 숫자는 그 줄에 **꼭 있어야 할 때만** 씁니다. 카드에서 숫자는 자리를 많이 먹습니다.",
    "",
    "출력은 아래 모양 그대로, 다른 말 없이 써 주세요. 머리말·따옴표·목록 기호를 붙이지 않습니다. 자막N-2 는 필요할 때만 덧붙입니다.",
    "",
    `${HEADLINE_LABELS["headline.line1"]}: `,
    `${HEADLINE_LABELS["headline.line2"]}: `,
    ...scenes.map((scene) => `${captionLabel(scene, 1)}: `),
    "",
    `제목: ${article.title}`,
    "",
    "본문:",
    article.body,
  ].join("\n");
}

export interface NewsReelCardTextParse {
  headline: Partial<NewsReelHeadline>;
  /** `sceneCount` long; an entry is empty when nothing arrived for that picture. */
  captions: Partial<{ line1: string; line2: string }>[];
  missing: NewsReelTextSlot[];
  repeated: NewsReelTextSlot[];
  ignored: string[];
}

const LABEL_PATTERN = /^[\s*#>-]*([^\s:：*]+)\s*\**\s*[:：]\s*(.*)$/;

function unwrap(value: string): string {
  const trimmed = value.trim().replace(/^\*+|\*+$/g, "").trim();
  const pairs: readonly [string, string][] = [["\"", "\""], ["'", "'"], ["「", "」"], ["“", "”"], ["‘", "’"]];
  for (const [open, close] of pairs) {
    if (trimmed.length >= 2 && trimmed.startsWith(open) && trimmed.endsWith(close) && !trimmed.slice(1, -1).includes(close)) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/** The slot a label names, for this many pictures — or undefined for a label that is not one of ours. */
function slotsFor(sceneCount: number): Map<string, NewsReelTextSlot> {
  const slots = new Map<string, NewsReelTextSlot>([
    [HEADLINE_LABELS["headline.line1"], { field: "headline.line1" }],
    [HEADLINE_LABELS["headline.line2"], { field: "headline.line2" }],
  ]);
  for (let scene = 0; scene < sceneCount; scene++) {
    slots.set(captionLabel(scene, 1), { field: "caption.line1", scene });
    slots.set(captionLabel(scene, 2), { field: "caption.line2", scene });
  }
  return slots;
}

const slotKey = (slot: NewsReelTextSlot): string => `${slot.field}@${slot.scene ?? ""}`;

/**
 * Read the labelled lines back into boxes.
 *
 * 🔴 **A label that arrives twice fills neither.** Which one was meant is not knowable here, and choosing would
 * burn a guess under a real publisher's name; the screen says so and a person writes it. 🟠 A caption label for a
 * picture that does not exist (「자막4-1」 on a three-picture reel) is not ours, so it is reported in `ignored`
 * rather than silently dropped — the call was paid for.
 */
export function parseNewsReelCardText(text: string, sceneCount: number): NewsReelCardTextParse {
  const slots = slotsFor(sceneCount);
  const values = new Map<string, { slot: NewsReelTextSlot; value: string }>();
  const repeated = new Map<string, NewsReelTextSlot>();
  const ignored: string[] = [];

  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.trim() === "") continue;
    const match = LABEL_PATTERN.exec(line);
    const slot = match ? slots.get(match[1]!) : undefined;
    if (!match || slot === undefined) { ignored.push(line.trim()); continue; }
    const value = unwrap(match[2]!);
    if (value === "") continue;
    const key = slotKey(slot);
    if (values.has(key) || repeated.has(key)) {
      repeated.set(key, slot);
      values.delete(key);
      continue;
    }
    values.set(key, { slot, value });
  }

  const headline: Partial<NewsReelHeadline> = {};
  const captions: Partial<{ line1: string; line2: string }>[] = Array.from({ length: sceneCount }, () => ({}));
  for (const { slot, value } of values.values()) {
    if (slot.field === "headline.line1") headline.line1 = value;
    else if (slot.field === "headline.line2") headline.line2 = value;
    else if (slot.field === "caption.line1") captions[slot.scene!]!.line1 = value;
    else captions[slot.scene!]!.line2 = value;
  }

  const required = [...slots.values()].filter((slot) => NEWS_REEL_TEXT_BOXES[slot.field].required);
  return {
    headline,
    captions,
    missing: required.filter((slot) => !values.has(slotKey(slot)) ),
    repeated: [...repeated.values()],
    ignored,
  };
}
