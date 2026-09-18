import type { NewsClaimCheck, NewsClaimKind, NewsSummaryCheck } from "@ai-animation-studio/shared";

/**
 * Does the summary say anything the article does not?
 *
 * This is the whole reason the news feature is allowed to exist. A summariser produces plausible figures, dates
 * and quotations that were never in the source; on a flower reel that is dull, here it is a machine for making
 * wrong things look good and sending them out. So the three kinds a machine can actually look for are looked
 * for, and anything not found stops the card being made.
 *
 * 🔴 **The bias is toward refusing.** A wrong refusal costs one article and the person can see exactly which
 * span caused it. A wrong pass ships a sentence nobody wrote, under a real publisher's name, with the app's
 * word behind it. So every judgement call below leans the same way, and the normalisations are the small set
 * that cannot turn a different number into a matching one.
 *
 * 🔴 **What this cannot do, and why there is no `verified` flag.** It compares spans. It has no idea whether
 * "A 때문에 B" is supported by the article, whether a quotation is attributed to the right person, or whether a
 * true number has been put in a false context. `NEWS_CHECK_SCOPE_NOTICE` exists so the screen says so out loud
 * every time, including when nothing is missing.
 */

/** Spaces, including the wide ones Korean text picks up from the web, are never the difference between two claims. */
const collapseSpace = (value: string): string => value.replace(/[\s ​]+/g, " ").trim();

/**
 * Digit grouping is presentation. `4,000` and `4000` are the same number written twice, and refusing over the
 * comma would be a refusal about typography.
 *
 * 🔴 Nothing else is normalised. In particular 만/천/억 are **not** expanded into digits: doing that means
 * deciding that "1만 2천" and "12,000" are the same claim, and an expander with a bug in it turns an invented
 * figure into a match — which is the one direction that must never happen. If the summariser writes the number
 * a different way than the article did, this refuses, and the person sees both.
 */
const normaliseNumber = (value: string): string => collapseSpace(value).replace(/,/g, "");

/** `「…」` `"…"` `'…'` and the curly pairs. The opening mark decides the closing one, so a stray quote cannot swallow the rest. */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["「", "」"], ["“", "”"], ["‘", "’"], ["\"", "\""], ["'", "'"],
];

/**
 * A run of digits, plus any Korean magnitude word riding on it.
 *
 * 🔴 The magnitude is part of the span on purpose. Without it `4천 명` is extracted as the bare `4`, and a bare
 * `4` turns up in almost any article — so the summariser could write 「4천 명」 about an article that says 4,000
 * and pass because the article happened to contain 「4시간」. Reading the magnitude as text keeps the claim
 * whole: `4천` is looked for as `4천`, and if the article wrote 4,000 instead this refuses and shows both. That
 * is the refusal being *unhelpful but honest*, which is the trade this file takes everywhere.
 */
const NUMBER_PATTERN = /\d[\d,]*(?:\.\d+)?\s*[조억만천백십]?/g;

/**
 * Dates written the ways Korean articles write them, longest first so `2026년 9월 14일` is not eaten as `9월 14일`.
 *
 * A date is checked as a whole because its parts are meaningless separately — `14` appearing somewhere in the
 * article says nothing about whether the 14th was in it.
 */
const DATE_PATTERNS: readonly RegExp[] = [
  /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g,
  /\d{4}[-./]\d{1,2}[-./]\d{1,2}/g,
  /\d{1,2}월\s*\d{1,2}일/g,
  /\d{4}년\s*\d{1,2}월/g,
];

/** Ranges the date patterns already claimed, so `2026년 9월 14일` does not also register as the number 2026. */
interface Span { readonly start: number; readonly end: number }

const overlaps = (start: number, end: number, taken: readonly Span[]): boolean =>
  taken.some((span) => start < span.end && span.start < end);

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
  for (const [open, close] of QUOTE_PAIRS) {
    let index = 0;
    while (index < summary.length) {
      const start = summary.indexOf(open, index);
      if (start < 0) break;
      const end = summary.indexOf(close, start + open.length);
      if (end < 0) break;
      const inner = summary.slice(start + open.length, end);
      // An empty pair is punctuation, not a quotation, and a claim with no text would be a pass nobody earned.
      if (inner.trim()) quotes.push(inner);
      index = end + close.length;
    }
  }
  return quotes;
}

/** Each distinct span once. Saying the same figure twice is one claim about the world, and two rows read as two failures. */
function distinct(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = collapseSpace(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 🔴 A figure must sit on its own, not merely appear inside a longer one.
 *
 * Plain substring search passes `40` because the article says `4,000` — `4000` contains `40`. That is a false
 * pass, the one direction this file must never take: an invented figure waved through because a bigger real one
 * happens to start with the same digits. So a number is matched only where a digit does not run up against it.
 *
 * 🔴 **The decimal point is a boundary too** (Cowork Round 911 found this one in here). With only `\d` on each
 * side, a summary saying `3` passed an article that says `3.5` — same false pass, one character along. And a
 * date is compared with its spaces squeezed out on both sides, because `10월2일` and `10월 2일` are one date
 * written twice; digits welded to 년·월·일 leave no room for a coincidental match.
 */
const squeeze = (value: string): string => value.replace(/\s+/g, "");

const foundIn = (haystack: string, needle: string, kind: NewsClaimKind): boolean => {
  if (kind === "date") return squeeze(haystack).includes(squeeze(needle));
  if (kind !== "number") return collapseSpace(haystack).includes(collapseSpace(needle));
  const text = normaliseNumber(needle);
  if (!text) return false;
  return new RegExp(`(?<![\\d.])${escapeRegExp(text)}(?![\\d.])`).test(normaliseNumber(haystack));
};

/**
 * Check one summary against the article it claims to summarise.
 *
 * Pure, and free: no provider is involved, so this can be run on anything as often as it likes. `claims` holds
 * every span looked at — "checked nine, missed none" and "checked none" are different facts, and a count of
 * failures alone cannot tell them apart.
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
