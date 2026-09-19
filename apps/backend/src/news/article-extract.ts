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

/** Paragraph and line breaks become newlines so sentences do not fuse; everything else just goes. */
function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<\/(?:p|div|li|h[1-6]|blockquote)\s*>/gi, "\n")
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map((line) => line.trim()).join("\n")
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
    const body = stripTags(dropLinkOnlyBlocks(stripped));
    if (body.length < ARTICLE_MIN_BODY_CHARS) continue;
    return { ...found, body };
  }
  return found;
}
