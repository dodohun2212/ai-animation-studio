/**
 * Pulling an article out of a publisher's page, and refusing when it cannot be done confidently.
 *
 * 🔴 **The two ways this can be wrong are not symmetric, and the dangerous one is the opposite of the obvious
 * one.** Cowork (Round 931 §4) named the first: a body we read only half of produces a summary of half the
 * article, and the checker passes it, because the checker is only ever true *inside the text it was given*.
 * That is real. But it fails **red-ish** — the summary is thin, and every claim in it genuinely is in the text.
 *
 * The worse direction is a body that is too **large**. `checkNewsSummary` asks "does this number appear in the
 * article?", so every extra line we sweep in — a sidebar, a related-headline list, a most-read box, another
 * story's pull quote — is another place an **invented** figure can coincidentally land. A bloated body does not
 * make the summary thin; it makes the guard **stop guarding**, silently, while showing green. That is the one
 * outcome this whole feature exists to prevent.
 *
 * So the rule is: **take only from a container we recognise as the article**, never the page. When no such
 * container is found, return nothing and let the person paste — a refusal costs them a copy and a paste, and
 * the alternative costs a viewer a fabricated number presented as news.
 */

/** Recognisable article containers, in the order they are trusted. `<article>` is the semantic one. */
const BODY_PATTERNS: readonly RegExp[] = [
  /<article\b[^>]*>([\s\S]*?)<\/article>/i,
  /<div\b[^>]*\b(?:id|class)\s*=\s*["'][^"']*\b(?:article-body|articleBody|article_body|story-body|news-article-body|art_text|article-text)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  /**
   * 동아일보. The body is bare text between `<br><br>` straight inside `<section class="news_view">` — no `<p>`, so
   * the structural fallback below finds no paragraphs, and the page's first `<article>` is the reporter box.
   * 2026-09-22: ten of the day's 110 feed rows, every one `body_not_found` until this line.
   */
  /<section\b[^>]*\bclass\s*=\s*["'][^"']*\bnews_view\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
];

/**
 * Blocks that sit *inside* an article container on real pages but are not the article.
 *
 * 🔴 This list is the load-bearing part, not the containers above. A related-article list inside `<article>`
 * carries other stories' headlines — complete with their numbers and dates — and every one of them becomes a
 * place an invented figure can be "found". Cut them before the tags come off, while they are still identifiable.
 */
const STRIP_PATTERNS: readonly RegExp[] = [
  /<script\b[\s\S]*?<\/script>/gi,
  /<style\b[\s\S]*?<\/style>/gi,
  /<noscript\b[\s\S]*?<\/noscript>/gi,
  /<aside\b[\s\S]*?<\/aside>/gi,
  /<nav\b[\s\S]*?<\/nav>/gi,
  /<figure\b[\s\S]*?<\/figure>/gi,
  /<figcaption\b[\s\S]*?<\/figcaption>/gi,
  /<table\b[\s\S]*?<\/table>/gi,
  /<!--[\s\S]*?-->/g,
  // Related-story and promo blocks, by the names publishers actually use.
  /<(div|ul|section)\b[^>]*\b(?:id|class)\s*=\s*["'][^"']*\b(?:related|recommend|most-?read|popular|ad|advert|banner|promo|share|sns|copyright|reporter|byline-?box|comment)\b[^"']*["'][\s\S]*?<\/\1>/gi,
];

/**
 * A block is navigation, not prose, when almost all of its text is inside links.
 *
 * 🔴 **The list above is names, and names are a guess.** It catches `class="related-news"` because that is what
 * the publishers I could think of call it; it catches nothing at all from a publisher who writes
 * `class="articleRelated"` or `class="연관기사"` — and it fails **silently**, leaving another story's numbers in
 * the body where an invented figure can be "found". A defence whose only failure mode is invisible is not one
 * I want to be alone.
 *
 * So this asks a structural question instead, which no naming convention can slip past: a related-article list,
 * a most-read box and a tag cloud are all **text that exists to be clicked**, and article prose is not. A
 * paragraph may certainly contain a link; it does not consist of one.
 *
 * 🟠 80%, and the direction of the error is why it can be this blunt. Cutting too much makes the body smaller,
 * which at worst drops it under the minimum and falls back to pasting — the person copies and pastes. Cutting
 * too little leaves the guard quietly weaker, which costs a viewer a fabricated number presented as news. When
 * the two mistakes are not symmetric, the threshold belongs on the side of the cheap one.
 */
const LINK_TEXT_SHARE_LIMIT = 0.8;

const textLengthOf = (html: string): number => stripTags(html).replace(/\s+/g, "").length;

function dropLinkOnlyBlocks(container: string): string {
  // Split on block ends rather than parsing: each chunk is one paragraph, list item or heading's worth of text,
  // which is the unit a publisher actually groups links into.
  return container
    .split(/(?<=<\/(?:p|li|h[1-6]|div|dd|dt|figcaption)>)/i)
    .filter((chunk) => {
      const total = textLengthOf(chunk);
      if (total === 0) return true;
      const linked = [...chunk.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
        .reduce((sum, match) => sum + textLengthOf(match[1] ?? ""), 0);
      return linked / total < LINK_TEXT_SHARE_LIMIT;
    })
    .join("");
}

const META_PATTERNS = (property: string): RegExp =>
  new RegExp(`<meta\\b[^>]*\\b(?:property|name)\\s*=\\s*["']${property}["'][^>]*\\bcontent\\s*=\\s*["']([^"']*)["']`, "i");

const META_PATTERNS_REVERSED = (property: string): RegExp =>
  new RegExp(`<meta\\b[^>]*\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*\\b(?:property|name)\\s*=\\s*["']${property}["']`, "i");

const meta = (html: string, property: string): string | undefined => {
  const direct = META_PATTERNS(property).exec(html)?.[1];
  if (direct?.trim()) return decodeEntities(direct).trim();
  // Attribute order is not fixed in HTML, and half the publishers write content= first.
  const reversed = META_PATTERNS_REVERSED(property).exec(html)?.[1];
  return reversed?.trim() ? decodeEntities(reversed).trim() : undefined;
};

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'", "&nbsp;": " ",
  "&ldquo;": "“", "&rdquo;": "”", "&lsquo;": "‘", "&rsquo;": "’", "&middot;": "·", "&hellip;": "…",
};

/**
 * 🔴 Entities have to be decoded, and quotes are why. `checkNewsSummary` compares quoted strings, and a body
 * still holding `&quot;` never matches a summary holding `"` — the checker would call a real quotation invented.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&[a-z]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

/**
 * The article's prose, found without knowing what anybody calls their container.
 *
 * 🔴 **Adding names was the wrong answer, and measuring showed why.** Against the real sites (Round 940) the
 * containers are `content90`, `end-body`, `news_body`, `article-view`, `wrap-container` — there is no
 * convention to learn, only a list to keep extending, and every publisher not yet on it fails silently. The
 * same objection as the related-block strip, one level up.
 *
 * So the structural question again: **article prose is paragraphs**. A `<p>` carrying forty characters or more
 * is a sentence somebody wrote; navigation, bylines, tags and related links are not that shape. Collecting
 * those skips container selection entirely — which is the part that cannot be done reliably.
 *
 * 🟠 Deliberately a **fallback**, tried only after the named containers. A recognised container is a stronger
 * statement about where the article is than a heuristic over the whole page, and using it first keeps the
 * common case exact. This only runs where the alternative is giving up.
 *
 * 🔴 This does not rescue everything, and measuring says so plainly: MBC's article page is 4KB with 162
 * characters of text, SBS's has 81. The body is drawn by JavaScript and **is not in the document at all** — no
 * parser reaches it, which is exactly why the paste path is not a fallback but a main road.
 */
const PROSE_MIN_PARAGRAPH_CHARS = 40;

function proseParagraphs(html: string): string {
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => match[1] ?? "");
  // 🔴 Stop at the copyright line **before** the length filter: at 38 characters it is not "prose", so filtering
  // first threw away the one mark that says where the article ends and let the photo captions after it through.
  const end = paragraphs.findIndex((inner) => COPYRIGHT_LINE.test(stripTags(inner)));
  return (end < 0 ? paragraphs : paragraphs.slice(0, end))
    .filter((inner) => textLengthOf(inner) >= PROSE_MIN_PARAGRAPH_CHARS)
    .map((inner) => stripTags(inner))
    .join("\n");
}

/** Paragraph and line breaks become newlines so sentences do not fuse; everything else just goes. */
function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<\/(?:p|div|li|h[1-6]|blockquote)\s*>/gi, "\n")
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    // Trim before collapsing: a line of only spaces is not empty until trimmed, so collapsing first let
    // 동아일보's nine blank lines between the deck and the body through — each publisher's markup left its own
    // gaps, which is part of why articles came out spaced differently.
    .split("\n").map((line) => line.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The shortest run of text we will call an article body.
 *
 * 🟠 Not a quality bar — a **shape** check. Publishers serve the same URL as a headline-and-blurb stub to
 * crawlers, and a 200-character stub that parses cleanly is exactly the half-body failure: the summariser would
 * write three accurate sentences about a blurb and the checker would pass them.
 */
export const ARTICLE_MIN_BODY_CHARS = 400;

export interface ExtractedArticle {
  title: string;
  publishedAt?: string;
  /**
   * 🔴 Optional, and the metadata beside it is **not**. A missing body is not a failed extraction — it is the
   * paste branch, and the paste screen has to open with the title, the date and the address already in it or
   * the person retypes everything they just pasted an address for (Cowork Round 931 §4). Returning nothing at
   * all would throw away facts we successfully read on the way to the one we did not.
   */
  body?: string;
}

/**
 * 🔴 **The headline again, as the body's first line.**
 *
 * 캡틴D, first real run: 「본문이랑 제목이랑 같게 뜸」. Measured against live articles the same hour —
 * 경향, 한겨레 and SBS all repeat the headline inside the body container, 연합뉴스 and 뉴시스 do not. So it
 * is most publishers, not one, and the person sees their headline twice in a box they are about to summarise.
 *
 * 🟠 **Exact match only, and only the first line.** A looser rule was measured and rejected: dropping leading
 * lines that do not end like a sentence also eats 뉴시스's `[서울=뉴시스] …` dateline, 103 characters of real
 * article. The headline repeated verbatim is unambiguous; anything beyond that is guessing at furniture, and
 * guessing wrong costs body rather than noise.
 */
function withoutRepeatedTitle(body: string, title: string): string {
  const headline = title.trim();
  if (!headline) return body;
  const lines = body.split("\n");
  const first = lines.findIndex((line) => line.trim().length > 0);
  if (first < 0 || lines[first]!.trim() !== headline) return body;
  return lines.slice(first + 1).join("\n").trimStart();
}

/**
 * 🔴 **Everything from the publisher's own copyright line down is not the article** (Cowork 1084).
 *
 * Measured on 30 연합뉴스 articles the same evening (2026-09-22): every one ends 「제보는 카카오톡 okjebo」 →
 * 「<저작권자(c) 연합뉴스, 무단 전재-재배포, AI 학습 및 활용 금지>」, and **after** that line come the filing lines
 * (「2026/09/22 19:19 송고」), the photo captions — each with **its own date and place** (「사진은 30일 … 2026.8.30
 * dwise@yna.co.kr」 under a 9/22 story) — and the page's 좋아요·공유·폰트 buttons. In none of the 30 did article
 * text come after it.
 *
 * The captions are the dangerous part: `checkNewsSummary` treats the body as the article's facts, so 「8월 30일」
 * from a photo caption passes as if the story said it. That is not invented and not cherry-picked — the body
 * arrived already carrying another day's facts, and no prompt can fix that.
 *
 * 🟠 **Only the marker, nothing guessed.** Cutting too much makes good captions go red; the copyright line is
 * the publisher saying where its article ends, so cutting there takes nothing of the story. 🟠 It runs before
 * the length check, so a short brief that only reached 400 characters **because of** that tail no longer does —
 * the tail was what made it look long enough to check against.
 */
const COPYRIGHT_LINE = /^<?\s*저작권자\s*[(ⓒ©]/;
const TIP_LINE = /^제보는 카카오톡/;
/** A reporter's sign-off: the last line, an address and nothing else. */
const EMAIL_ONLY_LINE = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;

function withoutPublisherTail(body: string): string {
  const lines = body.split("\n");
  const end = lines.findIndex((line) => COPYRIGHT_LINE.test(line));
  const kept = end < 0 ? lines : lines.slice(0, end);
  const furniture = (line: string): boolean => {
    const trimmed = line.trim();
    return trimmed === "" || TIP_LINE.test(trimmed) || EMAIL_ONLY_LINE.test(trimmed);
  };
  while (kept.length > 0 && furniture(kept[kept.length - 1]!)) kept.pop();
  return kept.join("\n");
}

/**
 * Whatever could be read from the page, with `body` present only when it could be read **confidently**.
 *
 * No body is not an error. The server did its job: it knocked, it got a page, it could not tell which part was
 * the article. Saying "실패" about that would be us misdescribing our own work.
 */
export function extractArticle(html: string): ExtractedArticle {
  const title = meta(html, "og:title") ?? stripTags(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const publishedAt = meta(html, "article:published_time") ?? meta(html, "og:article:published_time")
    ?? /<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];

  const found = { title: title.trim(), ...(publishedAt ? { publishedAt } : {}) };
  for (const pattern of BODY_PATTERNS) {
    const container = pattern.exec(html)?.[1];
    if (!container) continue;
    const stripped = STRIP_PATTERNS.reduce((text, strip) => text.replace(strip, " "), container);
    // Names first, then structure — two independent defences, because the first one's failures are silent.
    const body = withoutPublisherTail(withoutRepeatedTitle(stripTags(dropLinkOnlyBlocks(stripped)), found.title));
    if (body.length < ARTICLE_MIN_BODY_CHARS) continue;
    return { ...found, body };
  }

  // No container we recognise. Rather than adding another name to a list that can never be finished, ask the
  // structural question — and put the whole page through the same link filter first, so a page of headlines
  // cannot become a body.
  const prose = proseParagraphs(dropLinkOnlyBlocks(STRIP_PATTERNS.reduce((text, strip) => text.replace(strip, " "), html)));
  const trimmed = withoutPublisherTail(withoutRepeatedTitle(prose, found.title));
  if (trimmed.length >= ARTICLE_MIN_BODY_CHARS) return { ...found, body: trimmed };
  return found;
}
