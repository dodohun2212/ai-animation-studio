import {
  NEWS_REEL_TEXT_BOXES,
  NEWS_REEL_TEXT_FIELDS,
  type NewsArticleInput,
  type NewsReelTextField,
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

/** The label each box answers under. Keyed by the contract's own field names, so a new box fails to compile here. */
const LABELS: Readonly<Record<NewsReelTextField, string>> = {
  "headline.line1": "제목1",
  "headline.line2": "제목2",
  "caption.line1": "자막1",
  "caption.line2": "자막2",
};

/** What each box is for, in the prompt's own words — beside its label, so the two cannot drift apart. */
const JOBS: Readonly<Record<NewsReelTextField, string>> = {
  "headline.line1": "무슨 일이 있었는지의 **배경·상황**. 사람이 이 줄만 보고 「무슨 얘긴지」 알 수 있어야 합니다.",
  "headline.line2": "그래서 **결국 어떻게 됐는지** 한 방으로. 이 줄이 노란색으로 나갑니다 — 제일 세게 남는 줄입니다.",
  "caption.line1": "지금 화면에서 **무엇이 보이는지**, 언제·어디인지를 짧은 문장으로.",
  "caption.line2": "자막이 한 줄로 모자랄 때만 씁니다. **모자라지 않으면 이 줄은 아예 쓰지 마십시오.**",
};

/**
 * 🟠 The limits come from the contract's table rather than being typed here.
 *
 * A number repeated in a prompt is a copy like any other, and this one would be the copy nobody notices: the
 * model would go on being asked for 15 characters long after the box held 13, and the refusal would arrive
 * after the money was spent.
 */
const limitLine = (field: NewsReelTextField): string =>
  `- **${LABELS[field]}**: ${NEWS_REEL_TEXT_BOXES[field].limit}자 이내. ${JOBS[field]}`;

export function newsReelCardPrompt(article: NewsArticleInput): string {
  return [
    "아래 기사로 **짧은 뉴스 릴 카드**에 얹을 글을 써 주세요.",
    "",
    "**요약문이 아닙니다.** 카드에는 제목 두 줄과 아래 자막만 들어갑니다. 한 문단을 쓰고 자르는 것이 아니라, 아래 네 줄을 각각 따로 써 주십시오.",
    "",
    ...NEWS_REEL_TEXT_FIELDS.map(limitLine),
    "",
    "**말은 새로 지어 주세요.** 기사의 문장을 그대로 옮기지 않습니다 — 통신사 문체가 그대로 따라옵니다.",
    "- 직함을 길게 붙이지 않습니다. 「…라고 밝혔다」, 「…한 것으로 전해졌다」 같은 끝맺음을 쓰지 않습니다.",
    "- 짧은 말로 끊습니다. 한 줄에 여러 사실을 밀어 넣지 않습니다.",
    "",
    "**그런데 숫자·날짜·인용문은 기사에 적힌 그대로만 씁니다.** 표현은 새로 짓되 **사실은 기사 안에서만** 가져옵니다. 기사에 없는 숫자·날짜·인용문은 절대 만들어 넣지 않습니다. 기사가 말하지 않은 원인이나 결과도 쓰지 않습니다.",
    "- 숫자는 그 줄에 **꼭 있어야 할 때만** 씁니다. 카드에서 숫자는 자리를 많이 먹습니다.",
    "",
    "출력은 아래 모양 그대로, 다른 말 없이 써 주세요. 머리말·따옴표·목록 기호를 붙이지 않습니다.",
    "",
    ...NEWS_REEL_TEXT_FIELDS.filter((field) => NEWS_REEL_TEXT_BOXES[field].required).map((field) => `${LABELS[field]}: `),
    "",
    `제목: ${article.title}`,
    "",
    "본문:",
    article.body,
  ].join("\n");
}

/**
 * What came back, read into the contract's boxes.
 *
 * 🔴 **Nothing is thrown away silently and nothing is guessed at.** The answer was paid for: refusing it
 * outright costs the money and returns nothing, so whatever arrived is handed back even when it is
 * incomplete, and the person can finish it by hand in the boxes that already count characters for them. That
 * is the same choice `CreateNewsSummaryResponse.tooLong` made — reported rather than trimmed.
 *
 * 🔴 **A label that came twice is `repeated`, not "the first one wins".** Which of the two the model meant is
 * not knowable from here, and picking one is the kind of quiet decision that shows up burned into a file.
 *
 * 🟠 **Length is not judged here.** `checkNewsReelCardText` does that, with the contract's own numbers, for
 * the screen and the server alike — a second opinion about length living in the parser is exactly the second
 * copy that contract keeps being careful to avoid.
 */
export interface NewsReelCardTextParse {
  /** Every box a label was found for, as written. Missing boxes are simply absent. */
  values: Partial<Record<NewsReelTextField, string>>;
  /** Required boxes no label arrived for. */
  missing: NewsReelTextField[];
  /** Boxes whose label arrived more than once — never chosen between. */
  repeated: NewsReelTextField[];
  /** Non-blank lines that carried no label. Kept so an answer is never quietly half-dropped. */
  ignored: string[];
}

/**
 * A line that looks like `<라벨>: <값>`, however the model dressed it up.
 *
 * 🔴 **A regex literal, not `new RegExp` over a template.** The first draft built this string with `\s` inside
 * a template literal — where `\s` is simply the letter `s` — so the pattern matched a class of `s`, `*`, `#`,
 * `>` and `-` with **no whitespace in it at all**. It read `제목1:` and not `- 제목2 : `, which is exactly the
 * shape a model answers in. The pair caught it; the escape would not have been visible in review.
 *
 * 🟠 The label is captured as whatever token sits there and then **looked up** in the table below, rather than
 * spelled into the pattern. One list of labels, and an unknown one falls through to `ignored` instead of
 * silently failing to match.
 */
const LABEL_PATTERN = /^[\s*#>-]*([^\s:：*]+)\s*\**\s*[:：]\s*(.*)$/;

const FIELD_BY_LABEL = new Map<string, NewsReelTextField>(
  NEWS_REEL_TEXT_FIELDS.map((field) => [LABELS[field], field]),
);

/**
 * 🟠 Only a wrapper around the **whole** value is stripped. A 「」 pair inside the line is the article's own
 * quotation and the checker looks for it word for word — peeling one off there would turn a quotation that
 * matches into one that does not.
 */
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

export function parseNewsReelCardText(text: string): NewsReelCardTextParse {
  const values: Partial<Record<NewsReelTextField, string>> = {};
  const seen = new Set<NewsReelTextField>();
  const repeated: NewsReelTextField[] = [];
  const ignored: string[] = [];

  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.trim() === "") continue;
    const match = LABEL_PATTERN.exec(line);
    const field = match ? FIELD_BY_LABEL.get(match[1]!) : undefined;
    if (!match || field === undefined) { ignored.push(line.trim()); continue; }
    const value = unwrap(match[2]!);
    // 🟠 A label with nothing after it is the model declining that box, not an empty value — the contract has
    // no empty strings in it, so it is recorded as absent and reported as missing if the box is required.
    if (value === "") continue;
    if (seen.has(field)) {
      if (!repeated.includes(field)) repeated.push(field);
      delete values[field];
      continue;
    }
    seen.add(field);
    values[field] = value;
  }

  return {
    values,
    missing: NEWS_REEL_TEXT_FIELDS.filter((field) => NEWS_REEL_TEXT_BOXES[field].required && values[field] === undefined),
    repeated,
    ignored,
  };
}
