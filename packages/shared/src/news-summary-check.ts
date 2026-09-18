import type { NewsClaimCheck, NewsClaimKind, NewsSummaryCheck } from "./api.js";

/**
 * Does the summary say anything the article does not?
 *
 * 🔴 **One checker, in `shared`, because two cannot be trusted to agree.** The server gates with this — a
 * summary with anything unverified is refused and no card can be built from it — and the screen previews with
 * it before a paid call goes out. Those two answers must be the same answer. They were not: this existed twice
 * for one evening, and **the same false pass appeared independently in both copies** (substring search, so `40`
 * passed an article saying `4,000`). Each side found it separately. A second copy of a safety check is not
 * redundancy, it is a second thing to get wrong, and the half that drifts is the half that stops blocking.
 * Same move `photoCardSubtitleGeometry` made for the preview and the render.
 *
 * 🔴 **The bias is toward refusing.** A wrong refusal costs one article, and the person can see exactly which
 * span caused it. A wrong pass ships a sentence nobody wrote, under a real publisher's name, with this app's
 * word behind it. Every judgement below leans that way.
 *
 * 🟠 **What it cannot do, which is why there is no `verified` flag anywhere in the contract.** It compares
 * spans. It cannot tell whether "A 때문에 B" is supported, whether a quotation is attributed to the right
 * person, or whether a real figure has been attached to the wrong thing — an article saying `51%` will pass a
 * summary saying `51건`, because the figure is genuinely there and the unit is a meaning error of the kind
 * nothing here can see. `NEWS_CHECK_SCOPE_NOTICE` exists so a screen says this out loud every time, including
 * when nothing is missing. This is the floor, not the ceiling.
 */

/**
 * The sentence a screen shows beside any check result — **including when nothing is missing.**
 *
 * 🔴 Not decoration, and not optional. A green result with no sentence beside it reads as "this summary is
 * true", which is a guarantee nothing here gives: the pair named "floor, not a guarantee" holds a case where a
 * real figure attached to the wrong thing passes. The wording names that failure specifically rather than
 * hedging in the abstract, and ends with the one thing the person can actually do about it.
 *
 * It lives beside the checker, in one place, so the words cannot drift between the screens that show a check.
 * 🟠 It went missing once: it was written in `newsApi.ts`, which came back out when the client landed ahead of
 * its server (Round 910), and for a day the comment above pointed at a constant that did not exist (Cowork
 * Round 913 found that). The wording below is theirs — it says what cannot be caught, not merely what was.
 */
export const NEWS_CHECK_SCOPE_NOTICE =
  "이 대조는 기사에 없는 숫자·날짜·인용문만 잡습니다. 기사에 있는 값을 엉뚱한 곳에 붙였거나 뜻을 뒤집은 것은 못 잡습니다 — 올리기 전에 기사와 한 번 읽어 봐 주세요.";

/** Spaces, including the wide ones Korean text picks up from the web, are never the difference between two claims. */
const collapseSpace = (value: string): string => value.replace(/[\s ​]+/g, " ").trim();

const squeeze = (value: string): string => value.replace(/\s+/g, "");

/**
 * Digit grouping is presentation: `4,000` and `4000` are one number written twice, and refusing over the comma
 * would be a refusal about typography. Quotation marks are normalised to `"` for the same reason — 「」, “”, ''
 * and "" are one pair of marks written four ways.
 *
 * 🔴 Nothing else is normalised. In particular 만/천/억 are **not** expanded into digits: expanding means
 * deciding that `1만 2천` and `12,000` are the same claim, and an expander with a bug in it turns an invented
 * figure into a match — the one direction that must never happen.
 */
const normaliseNumber = (value: string): string => collapseSpace(value).replace(/,/g, "");

const normaliseQuotes = (value: string): string =>
  value.replace(/[“”‘’「」『』']/g, "\"");

/**
 * A run of digits, plus any **magnitude** word riding on it.
 *
 * 🔴 The distinction that decides this pattern: 조·억·만·천·백·십 change what the number *is*, so they belong to
 * the claim — `4천` is looked for as `4천`, and never as a bare `4` that would match any stray 4 in the article.
 * Counters (건·개·명·%·시간…) do not change the value, so they are left out. That is why there is no
 * "try again without the unit" fallback here: the unit was never part of the claim, so there is nothing to fall
 * back from — and a fallback is precisely where a check quietly turns lenient.
 */
const NUMBER_PATTERN = /\d[\d,]*(?:\.\d+)?\s*[조억만천백십]?\s*(?:%|퍼센트|건|개|명|원|달러|주|시간|분|초|위|배|회|차|호|석|표|쪽|일|월|년)?/g;

/**
 * The part of a span that is actually looked for: the digits and their magnitude, without the counter.
 *
 * 🔴 Two different jobs, and they were one field until Cowork's screen pair caught it. What gets **shown** is
 * the span as the summary wrote it — a refusal naming `53` when the person typed `53건` cannot be found and
 * fixed. What gets **searched for** drops the counter, because the article saying 51건 and the summary saying
 * 51개 is one figure written twice and refusing it would redden correct work.
 */
const valueOf = (text: string): string =>
  collapseSpace(text).replace(/\s*(?:%|퍼센트|건|개|명|원|달러|주|시간|분|초|위|배|회|차|호|석|표|쪽|일|월|년)$/, "").trim();

/** Dates as Korean articles write them, longest first so `2026년 9월 14일` is not eaten as `9월 14일`. */
const DATE_PATTERNS: readonly RegExp[] = [
  /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g,
  /\d{4}[-./]\d{1,2}[-./]\d{1,2}/g,
  /\d{1,2}월\s*\d{1,2}일/g,
  /\d{4}년\s*\d{1,2}월/g,
];

interface Span { readonly start: number; readonly end: number }

const overlaps = (start: number, end: number, taken: readonly Span[]): boolean =>
  taken.some((span) => start < span.end && span.start < end);

/**
 * Dates first, and their ranges masked, so `10월 2일` is not also read as the numbers `10` and `2`.
 *
 * 🔴 Both halves matter. A date split into its numbers passes almost any article — `10` and `2` are everywhere —
 * so an invented date would sail through on its parts. And a date that fails while its digits separately pass
 * is two answers to one question.
 */
function extractDates(summary: string): { claims: string[]; taken: Span[] } {
  const claims: string[] = [];
  const taken: Span[] = [];
  for (const pattern of DATE_PATTERNS) {
    for (const match of summary.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (overlaps(start, end, taken)) continue;
      taken.push({ start, end });
      claims.push(match[0]);
    }
  }
  return { claims, taken };
}

function extractQuotes(summary: string): string[] {
  const quotes: string[] = [];
  for (const match of normaliseQuotes(summary).matchAll(/"([^"]+)"/g)) {
    // An empty pair is punctuation, not a quotation, and a claim with no text would be a pass nobody earned.
    if (match[1]!.trim()) quotes.push(match[1]!.trim());
  }
  return quotes;
}

/** Each distinct span once. Saying a figure twice is one claim about the world; two rows read as two failures. */
function distinct(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = collapseSpace(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(collapseSpace(value));
  }
  return out;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 🔴 A figure must stand on its own, not merely appear inside a longer one.
 *
 * Plain substring search passes `40` against an article saying `4,000`, because `4000` contains `40`: an
 * invented figure waved through for sharing an opening digit with a real one. **The decimal point is a boundary
 * too** — with digits alone, `3` passed an article that only says `3.5`, which is the same failure one
 * character along. Both were live at once, in two separate copies of this function.
 *
 * A date compares with spaces squeezed from both sides: `10월2일` and `10월 2일` are one date written twice, and
 * digits welded to 년·월·일 leave no room for a coincidental match.
 */
const foundIn = (haystack: string, needle: string, kind: NewsClaimKind): boolean => {
  if (kind === "date") return squeeze(haystack).includes(squeeze(needle));
  if (kind === "quote") return collapseSpace(normaliseQuotes(haystack)).includes(collapseSpace(needle));
  const text = normaliseNumber(valueOf(needle));
  if (!text) return false;
  return new RegExp(`(?<![\\d.])${escapeRegExp(text)}(?![\\d.])`).test(normaliseNumber(haystack));
};

/**
 * Check one summary against the article it claims to summarise.
 *
 * Pure and free — no provider is involved — so a screen can run it on every keystroke and the server can run it
 * again before it decides. `claims` carries every span looked at, found or not: "checked nine, missed none" and
 * "checked none" are different facts, and a screen that only sees failures cannot tell them apart. A summary
 * with nothing checkable in it is not verified; it is unexamined.
 */
export function checkNewsSummary(summary: string, articleBody: string): NewsSummaryCheck {
  const { claims: dateTexts, taken } = extractDates(summary);
  const numberTexts = [...summary.matchAll(NUMBER_PATTERN)]
    .filter((match) => !overlaps(match.index, match.index + match[0].length, taken))
    .map((match) => match[0]);

  const claims: NewsClaimCheck[] = [
    ...distinct(numberTexts).map((text): NewsClaimCheck => ({ kind: "number", text, found: foundIn(articleBody, text, "number") })),
    ...distinct(dateTexts).map((text): NewsClaimCheck => ({ kind: "date", text, found: foundIn(articleBody, text, "date") })),
    ...distinct(extractQuotes(summary)).map((text): NewsClaimCheck => ({ kind: "quote", text, found: foundIn(articleBody, text, "quote") })),
  ];
  return { claims, missing: claims.filter((claim) => !claim.found) };
}
