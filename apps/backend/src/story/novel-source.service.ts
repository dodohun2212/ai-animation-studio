import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { NovelSourceHttpClient } from "../providers/novel-source-http.client.js";
import {
  NOVEL_SOURCE_MAX_PAGE_SIZE, NOVEL_SOURCE_PROVIDER, NOVEL_SOURCE_MAX_CHARS, NOVEL_SOURCE_WIKISOURCE_PROVIDER,
  type NovelSourceBook, type NovelSourceChapter, type NovelSourceChapterRange, type NovelSourceImportRequest,
  type NovelSourceImportResponse, type NovelSourceSearchRequest, type NovelSourceSearchResponse,
} from "@ai-animation-studio/shared";

const GUTENDEX_BASE = "https://gutendex.com/books/";
const WIKISOURCE_API = "https://ko.wikisource.org/w/api.php";
const WIKISOURCE_NOVELS_CATEGORY = "분류:한국의 소설";
/** Project Gutenberg lists this official mirror for automated downloads; do not fetch ebooks from the main website. */
export const GUTENBERG_TEXT_MIRROR = "https://gutenberg.pglaf.org";
const MAX_BOOK_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;
const USER_AGENT = "AI-Animation-Studio/2.0 (https://github.com/dodohun2212/ai-animation-studio)";

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const sourceError = (code: string, message: string, status = HttpStatus.BAD_GATEWAY, details?: RecordValue) =>
  new HttpException({ code, message, ...(details ? { details } : {}) }, status);

interface ParsedText { text: string; chapters: NovelSourceChapter[]; chapterSpans: Array<{ start: number; end: number }> }

function parseContributor(value: unknown): { name: string; deathYear: number | null } | null {
  if (!isRecord(value) || !isText(value.name) || !value.name.trim()) return null;
  return { name: value.name.trim(), deathYear: Number.isInteger(value.death_year) ? value.death_year as number : null };
}

function mapBook(value: unknown): NovelSourceBook | null {
  if (!isRecord(value) || !Number.isInteger(value.id) || (value.id as number) < 1 || (value.id as number) > 999_999_999
    || !isText(value.title) || !value.title.trim() || !Array.isArray(value.languages)
    || !value.languages.includes("en") || !Array.isArray(value.authors) || value.authors.length === 0
    || !Array.isArray(value.translators) || !isRecord(value.formats)) return null;
  const authors = value.authors.map(parseContributor);
  const translators = value.translators.map(parseContributor);
  if (authors.some((author) => author === null) || translators.some((translator) => translator === null)) return null;
  const id = String(value.id);
  const subjects = [...new Set([
    ...(Array.isArray(value.subjects) ? value.subjects.filter(isText) : []),
    ...(Array.isArray(value.bookshelves) ? value.bookshelves.filter(isText) : []),
  ])].slice(0, 40);
  return {
    provider: NOVEL_SOURCE_PROVIDER,
    sourceId: id,
    title: value.title.trim().slice(0, 300),
    authors: authors as Array<{ name: string; deathYear: number | null }>,
    translators: translators as Array<{ name: string; deathYear: number | null }>,
    language: "en",
    subjects,
    sourceUrl: `https://www.gutenberg.org/ebooks/${id}`,
  };
}

/** Extract only the work between Project Gutenberg's license markers and preserve JS UTF-16 length semantics. */
export function normalizeGutenbergText(input: string): string {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const start = /\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK\b[^\n]*\*\*\*/i.exec(text);
  const endPattern = /\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK\b[^\n]*\*\*\*/ig;
  let end: RegExpExecArray | null = null;
  for (let match = endPattern.exec(text); match; match = endPattern.exec(text)) end = match;
  if (!start || !end || end.index <= start.index + start[0].length) {
    throw sourceError("NOVEL_SOURCE_TEXT_INVALID", "Project Gutenberg 원문 경계를 확인할 수 없습니다.", HttpStatus.BAD_GATEWAY);
  }
  return text.slice(start.index + start[0].length, end.index).trim();
}

const CHAPTER_HEADING = /^\s*((?:chapter|book|part|letter)\s+(?:\d+|[ivxlcdm]+)\b[^\n]*)\s*$/i;
const CHAPTER_KEY = /^(chapter|book|part|letter)\s+(\d+|[ivxlcdm]+)\b/i;
const TOC_ENTRY_MAX_CHARS = 200;

/** Extract plain story text from the parsed HTML returned by the Wikisource API. */
export function normalizeWikisourceHtml(input: string): string {
  const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };
  const withoutNonStoryElements = removeWikisourceElements(input);
  return removeWikisourceLicenseSection(withoutNonStoryElements)
    .replace(/<sup\b[^>]*class="[^"]*reference[^"]*"[^>]*>[\s\S]*?<\/sup>/giu, "")
    .replace(/<!--([\s\S]*?)-->/gu, "")
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|section|tr)>/giu, "\n")
    .replace(/<h[1-6]\b[^>]*>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (entity, key: string) => {
      if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
      if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
      return entities[key.toLowerCase()] ?? `&${key};`;
    })
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

const WIKISOURCE_NON_STORY_CLASSES = new Set([
  "mw-editsection", "wst-header", "ws-header", "ws-noexport", "noprint", "navbox", "sistersitebox",
  "ws-license", "license", "licensetpl", "metadata", "mw-references-wrap",
]);

/** Remove parser-added CSS and Wikisource framing/navigation blocks before plain-text extraction. */
function removeWikisourceElements(input: string): string {
  const tokenPattern = /<!--[\s\S]*?-->|<(\/)?([a-z][\w:-]*)\b([^>]*)>/giu;
  const stack: Array<{ tag: string; start: number; remove: boolean }> = [];
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of input.matchAll(tokenPattern)) {
    if (!match[2]) continue; // HTML comments are matched so their contents cannot look like tags.
    const closing = !!match[1];
    const tag = match[2]!.toLowerCase();
    const attributes = match[3] ?? "";
    if (closing) {
      let index = stack.length - 1;
      while (index >= 0 && stack[index]!.tag !== tag) index--;
      if (index < 0) continue;
      const [entry] = stack.splice(index, 1);
      if (entry?.remove) ranges.push({ start: entry.start, end: match.index! + match[0].length });
      continue;
    }
    const classes = /\bclass\s*=\s*["']([^"']*)["']/iu.exec(attributes)?.[1]?.split(/\s+/u) ?? [];
    const id = /\bid\s*=\s*["']([^"']*)["']/iu.exec(attributes)?.[1] ?? "";
    const remove = tag === "style" || tag === "script" || classes.some((name) => WIKISOURCE_NON_STORY_CLASSES.has(name))
      || ["toc", "catlinks"].includes(id);
    const selfClosing = /\/\s*>$/u.test(match[0]) || ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].includes(tag);
    if (selfClosing) {
      if (remove) ranges.push({ start: match.index!, end: match.index! + match[0].length });
    } else stack.push({ tag, start: match.index!, remove });
  }
  for (const entry of stack) if (entry.remove) ranges.push({ start: entry.start, end: input.length });
  let output = input;
  const mergedRanges: Array<{ start: number; end: number }> = [];
  for (const range of ranges.sort((left, right) => left.start - right.start)) {
    const previous = mergedRanges[mergedRanges.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else mergedRanges.push({ ...range });
  }
  for (const range of mergedRanges.reverse()) output = output.slice(0, range.start) + output.slice(range.end);
  return output;
}

/** License notices are useful for review but are not part of the story sent to analysis. */
function removeWikisourceLicenseSection(input: string): string {
  const headings = [...input.matchAll(/<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>/giu)];
  for (const heading of headings) {
    const title = heading[2]!.replace(/<[^>]+>/gu, "").replace(/&(?:#\d+|[a-z]+);/giu, " ").trim();
    if (!/(?:라이선스|저작권|license|copyright)/iu.test(title)) continue;
    const level = Number(heading[1]);
    const start = heading.index!;
    const next = headings.find((candidate) => candidate.index! > start && Number(candidate[1]) <= level);
    return input.slice(0, start) + input.slice(next?.index ?? input.length);
  }
  return input;
}

function extractWikisourceContributors(wikitext: unknown): { authors: NovelSourceBook["authors"]; translators: NovelSourceBook["translators"] } {
  if (!isText(wikitext)) return { authors: [], translators: [] };
  const templates: string[] = [];
  const templateStart = /\{\{/gu;
  let match: RegExpExecArray | null;
  while ((match = templateStart.exec(wikitext))) {
    let depth = 1;
    let cursor = match.index + 2;
    while (cursor < wikitext.length && depth > 0) {
      if (wikitext.startsWith("{{", cursor)) { depth++; cursor += 2; }
      else if (wikitext.startsWith("}}", cursor)) { depth--; cursor += 2; }
      else cursor++;
    }
    if (depth === 0) {
      templates.push(wikitext.slice(match.index + 2, cursor - 2));
      templateStart.lastIndex = cursor;
    }
  }
  const header = templates.find((template) => /^(?:\s*(?:Template\s*:\s*)?(?:header|헤더|머리말|머리글)\s*\|)/iu.test(template));
  if (!header) return { authors: [], translators: [] };
  const parameters = new Map<string, string>();
  let depth = 0;
  let linkDepth = 0;
  let start = 0;
  const fields: string[] = [];
  for (let index = 0; index < header.length; index++) {
    if (header.startsWith("{{", index)) { depth++; index++; }
    else if (header.startsWith("}}", index)) { depth = Math.max(0, depth - 1); index++; }
    else if (header.startsWith("[[", index)) { linkDepth++; index++; }
    else if (header.startsWith("]]", index)) { linkDepth = Math.max(0, linkDepth - 1); index++; }
    else if (header[index] === "|" && depth === 0 && linkDepth === 0) { fields.push(header.slice(start, index)); start = index + 1; }
  }
  fields.push(header.slice(start));
  for (const parameter of fields.slice(1)) {
    const equals = parameter.indexOf("=");
    if (equals > 0) parameters.set(parameter.slice(0, equals).trim().toLocaleLowerCase("ko-KR"), parameter.slice(equals + 1).trim());
  }
  const cleanName = (value: string | undefined): NovelSourceBook["authors"] => {
    if (!value) return [];
    const name = value.replace(/<!--([\s\S]*?)-->/gu, "").replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/gu, "$1")
      .replace(/<[^>]+>/gu, "").replace(/\s+/gu, " ").trim().slice(0, 120);
    return name ? [{ name, deathYear: null }] : [];
  };
  return {
    authors: cleanName(parameters.get("author") ?? parameters.get("저자") ?? parameters.get("작가")),
    translators: cleanName(parameters.get("translator") ?? parameters.get("번역자") ?? parameters.get("역자")),
  };
}

function parseChapters(text: string): ParsedText {
  const candidates: Array<{ offset: number; title: string; key: string }> = [];
  for (const match of text.matchAll(/^.*$/gm)) {
    const heading = CHAPTER_HEADING.exec(match[0])
      ?? /^\s*((?:제\s*)?(?:\d+|[一二三四五六七八九十]+)\s*(?:장|회|절|편|막)|第\s*(?:\d+|[一二三四五六七八九十]+)\s*(?:章|回|節|編))[^\n]*$/u.exec(match[0]);
    if (heading) {
      const title = heading[1]!.trim().replace(/\s+/g, " ").slice(0, 200);
      const key = CHAPTER_KEY.exec(title)?.[0]?.toLowerCase() ?? title.toLocaleLowerCase("ko-KR").replace(/\s+/gu, "");
      candidates.push({ offset: match.index, title, key });
    }
  }
  // A Gutenberg table of contents repeats short heading lines before the actual chapters.
  // Drop a contiguous run only when every entry also occurs later in the text.
  const lastIndexByKey = new Map(candidates.map((entry, index) => [entry.key, index]));
  const tocEntries = new Set<number>();
  for (let index = 0; index < candidates.length - 1;) {
    const run: number[] = [];
    while (index < candidates.length - 1
      && candidates[index + 1]!.offset - candidates[index]!.offset <= TOC_ENTRY_MAX_CHARS
      && lastIndexByKey.get(candidates[index]!.key)! > index) {
      run.push(index);
      index++;
    }
    if (run.length >= 3) for (const entry of run) tocEntries.add(entry);
    index++;
  }
  const offsets = candidates.filter((_, index) => !tocEntries.has(index));
  const firstStart = offsets[0]?.offset ?? 0;
  const chapters = offsets.map((entry, index) => {
    const start = index === 0 ? firstStart : entry.offset;
    const end = offsets[index + 1]?.offset ?? text.length;
    return { number: index + 1, title: entry.title, characterCount: text.slice(start, end).trim().length };
  });
  return {
    text,
    chapters,
    chapterSpans: offsets.map((entry, index) => ({ start: index === 0 ? firstStart : entry.offset, end: offsets[index + 1]?.offset ?? text.length })),
  };
}

@Injectable()
export class NovelSourceService {
  constructor(private readonly http: NovelSourceHttpClient) {}

  async search(value: unknown): Promise<NovelSourceSearchResponse> {
    if (!isRecord(value) || Object.keys(value).some((key) => !["query", "language", "topic", "page", "pageToken"].includes(key))
      || !isText(value.query) || value.query.length > 120
      || (value.topic !== undefined && (!isText(value.topic) || value.topic.length > 80))
      || (value.page !== undefined && (!Number.isInteger(value.page) || (value.page as number) < 1 || (value.page as number) > 100_000))
      || (value.language !== undefined && value.language !== "en" && value.language !== "ko")
      || (value.pageToken !== undefined && (!isText(value.pageToken) || value.pageToken.length > 1_000))) {
      throw sourceError("NOVEL_SOURCE_INVALID_REQUEST", "작품 검색 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const language = (value.language ?? "en") as "en" | "ko";
    const query = value.query.trim();
    const topic = typeof value.topic === "string" ? value.topic.trim() : "";
    if (language === "ko") {
      if (topic) throw sourceError("NOVEL_SOURCE_INVALID_REQUEST", "한국어 작품은 제목이나 작가 검색어를 사용해 주세요.", HttpStatus.BAD_REQUEST);
      return this.searchWikisource(query, Number.isInteger(value.page) ? value.page as number : 1, value.pageToken as string | undefined);
    }
    if (!query && !topic) throw sourceError("NOVEL_SOURCE_INVALID_REQUEST", "제목·작가 또는 장르 검색어를 입력해 주세요.", HttpStatus.BAD_REQUEST);
    const url = new URL(GUTENDEX_BASE);
    url.searchParams.set("languages", "en");
    if (query) url.searchParams.set("search", query);
    if (topic) url.searchParams.set("topic", topic);
    if (value.page !== undefined) url.searchParams.set("page", String(value.page));
    const payload = await this.getJson(url);
    if (!isRecord(payload) || !Array.isArray(payload.results)) throw sourceError("NOVEL_SOURCE_UPSTREAM_INVALID", "작품 목록 응답을 읽을 수 없습니다.");
    const results = payload.results.map(mapBook).filter((book): book is NovelSourceBook => book !== null).slice(0, NOVEL_SOURCE_MAX_PAGE_SIZE);
    return { provider: NOVEL_SOURCE_PROVIDER, results, page: Number.isInteger(value.page) ? value.page as number : 1, hasNextPage: typeof payload.next === "string" && !!payload.next };
  }

  private async searchWikisource(query: string, page: number, pageToken?: string): Promise<NovelSourceSearchResponse> {
    if (query) {
      const url = new URL(WIKISOURCE_API);
      url.searchParams.set("action", "query");
      url.searchParams.set("format", "json");
      url.searchParams.set("formatversion", "2");
      url.searchParams.set("list", "search");
      url.searchParams.set("srnamespace", "0");
      url.searchParams.set("srsearch", `incategory:${WIKISOURCE_NOVELS_CATEGORY.replace(/^분류:/u, "").replace(/\s+/gu, "_")} ${query}`);
      url.searchParams.set("srlimit", String(NOVEL_SOURCE_MAX_PAGE_SIZE));
      url.searchParams.set("sroffset", String((page - 1) * NOVEL_SOURCE_MAX_PAGE_SIZE));
      const payload = await this.getJson(url);
      if (!isRecord(payload) || !isRecord(payload.query) || !Array.isArray(payload.query.search)) {
        throw sourceError("NOVEL_SOURCE_UPSTREAM_INVALID", "위키문헌 작품 목록 응답을 읽을 수 없습니다.");
      }
      const results = this.mapWikisourcePages(payload.query.search);
      await this.addWikisourceContributors(results);
      const hasNextPage = isRecord(payload.continue);
      return { provider: NOVEL_SOURCE_WIKISOURCE_PROVIDER, results, page, hasNextPage };
    }

    const categories = await this.getWikisourceNovelCategories();
    let categoryIndex = 0;
    let continuation: string | undefined;
    if (pageToken) {
      try {
        const token = JSON.parse(Buffer.from(pageToken, "base64url").toString("utf8")) as unknown;
        if (!isRecord(token) || !Number.isInteger(token.categoryIndex) || (token.categoryIndex as number) < 0
          || (token.categoryIndex as number) >= categories.length || (token.continue !== undefined && !isText(token.continue))) {
          throw new Error("invalid page token");
        }
        categoryIndex = token.categoryIndex as number;
        continuation = token.continue as string | undefined;
      } catch {
        throw sourceError("NOVEL_SOURCE_INVALID_REQUEST", "한국어 작품 목록의 다음 쪽 정보가 올바르지 않습니다.", HttpStatus.BAD_REQUEST);
      }
    }
    const results: NovelSourceBook[] = [];
    while (categoryIndex < categories.length && results.length < NOVEL_SOURCE_MAX_PAGE_SIZE) {
      const url = new URL(WIKISOURCE_API);
      url.searchParams.set("action", "query");
      url.searchParams.set("format", "json");
      url.searchParams.set("formatversion", "2");
      url.searchParams.set("list", "categorymembers");
      url.searchParams.set("cmtitle", categories[categoryIndex]!);
      url.searchParams.set("cmnamespace", "0");
      url.searchParams.set("cmtype", "page");
      url.searchParams.set("cmlimit", String(NOVEL_SOURCE_MAX_PAGE_SIZE - results.length));
      if (continuation) url.searchParams.set("cmcontinue", continuation);
      const payload = await this.getJson(url);
      if (!isRecord(payload) || !isRecord(payload.query) || !Array.isArray(payload.query.categorymembers)) {
        throw sourceError("NOVEL_SOURCE_UPSTREAM_INVALID", "위키문헌 작품 목록 응답을 읽을 수 없습니다.");
      }
      const knownIds = new Set(results.map(({ sourceId }) => sourceId));
      results.push(...this.mapWikisourcePages(payload.query.categorymembers).filter(({ sourceId }) => !knownIds.has(sourceId)));
      const more = isRecord(payload.continue) && isText(payload.continue.cmcontinue) ? payload.continue.cmcontinue : undefined;
      if (more) { continuation = more; break; }
      categoryIndex++;
      continuation = undefined;
    }
    await this.addWikisourceContributors(results);
    const hasNextPage = categoryIndex < categories.length;
    const nextPageToken = hasNextPage ? Buffer.from(JSON.stringify({ categoryIndex, ...(continuation ? { continue: continuation } : {}) }), "utf8").toString("base64url") : undefined;
    return { provider: NOVEL_SOURCE_WIKISOURCE_PROVIDER, results, page, hasNextPage, ...(nextPageToken ? { nextPageToken } : {}) };
  }

  private async getWikisourceNovelCategories(): Promise<string[]> {
    const url = new URL(WIKISOURCE_API);
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("list", "categorymembers");
    url.searchParams.set("cmtitle", WIKISOURCE_NOVELS_CATEGORY);
    url.searchParams.set("cmtype", "subcat");
    url.searchParams.set("cmlimit", String(NOVEL_SOURCE_MAX_PAGE_SIZE));
    const payload = await this.getJson(url);
    if (!isRecord(payload) || !isRecord(payload.query) || !Array.isArray(payload.query.categorymembers)) {
      throw sourceError("NOVEL_SOURCE_UPSTREAM_INVALID", "위키문헌 소설 분류 응답을 읽을 수 없습니다.");
    }
    const subcategories = payload.query.categorymembers.flatMap((entry): string[] =>
      isRecord(entry) && isText(entry.title) && entry.title.startsWith("분류:") ? [entry.title.slice(0, 200)] : []);
    return [WIKISOURCE_NOVELS_CATEGORY, ...subcategories];
  }

  private mapWikisourcePages(entries: unknown[]): NovelSourceBook[] {
    return entries.flatMap((entry): NovelSourceBook[] => {
      if (!isRecord(entry) || !Number.isInteger(entry.pageid) || (entry.pageid as number) < 1 || !isText(entry.title) || !entry.title.trim()) return [];
      const sourceId = String(entry.pageid);
      const title = entry.title.trim().slice(0, 300);
      return [{
        provider: NOVEL_SOURCE_WIKISOURCE_PROVIDER, sourceId, title, authors: [], translators: [], language: "ko", subjects: [],
        sourceUrl: `https://ko.wikisource.org/wiki/${encodeURIComponent(title.replace(/ /gu, "_"))}`,
      }];
    }).slice(0, NOVEL_SOURCE_MAX_PAGE_SIZE);
  }

  private async addWikisourceContributors(books: NovelSourceBook[]): Promise<void> {
    if (books.length === 0) return;
    const url = new URL(WIKISOURCE_API);
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("prop", "revisions");
    url.searchParams.set("rvprop", "content");
    url.searchParams.set("rvslots", "main");
    url.searchParams.set("pageids", books.map(({ sourceId }) => sourceId).join("|"));
    const payload = await this.getJson(url);
    if (!isRecord(payload) || !isRecord(payload.query) || !Array.isArray(payload.query.pages)) return;
    const byId = new Map(books.map((book) => [book.sourceId, book]));
    for (const page of payload.query.pages) {
      if (!isRecord(page) || !Number.isInteger(page.pageid)) continue;
      const book = byId.get(String(page.pageid));
      const revision = Array.isArray(page.revisions) && isRecord(page.revisions[0]) ? page.revisions[0] : null;
      const slots = revision && isRecord(revision.slots) && isRecord(revision.slots.main) ? revision.slots.main : null;
      const contributors = extractWikisourceContributors(slots?.content ?? revision?.content);
      if (book) { book.authors = contributors.authors; book.translators = contributors.translators; }
    }
  }

  async importWork(value: unknown): Promise<NovelSourceImportResponse> {
    if (!isRecord(value) || Object.keys(value).some((key) => !["provider", "sourceId", "chapterRange"].includes(key))
      || typeof value.sourceId !== "string" || !/^[1-9]\d{0,8}$/.test(value.sourceId)) {
      throw sourceError("NOVEL_SOURCE_INVALID_REQUEST", "가져올 작품을 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const provider = value.provider ?? NOVEL_SOURCE_PROVIDER;
    if (provider !== NOVEL_SOURCE_PROVIDER && provider !== NOVEL_SOURCE_WIKISOURCE_PROVIDER) {
      throw sourceError("NOVEL_SOURCE_INVALID_REQUEST", "가져올 작품 제공처를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const requestedRange = value.chapterRange;
    if (requestedRange !== undefined && (!isRecord(requestedRange) || Object.keys(requestedRange).some((key) => !["firstChapter", "lastChapter"].includes(key))
      || !Number.isInteger(requestedRange.firstChapter) || (requestedRange.firstChapter as number) < 1
      || !Number.isInteger(requestedRange.lastChapter) || (requestedRange.lastChapter as number) < (requestedRange.firstChapter as number))) {
      throw sourceError("NOVEL_SOURCE_INVALID_REQUEST", "연속된 장 범위를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const id = Number(value.sourceId);
    let book: NovelSourceBook;
    let sourceText: string;
    if (provider === NOVEL_SOURCE_PROVIDER) {
      const bookPayload = await this.getJson(new URL(`${id}/`, GUTENDEX_BASE));
      const found = mapBook(bookPayload);
      if (!found || found.sourceId !== value.sourceId) throw sourceError("NOVEL_SOURCE_NOT_FOUND", "선택한 작품을 제공처에서 찾지 못했습니다.", HttpStatus.NOT_FOUND);
      book = found;
      sourceText = await this.fetchText(id);
    } else {
      const url = new URL(WIKISOURCE_API);
      url.searchParams.set("action", "parse");
      url.searchParams.set("pageid", value.sourceId);
      url.searchParams.set("prop", "text");
      url.searchParams.set("redirects", "1");
      url.searchParams.set("format", "json");
      url.searchParams.set("formatversion", "2");
      const payload = await this.getJson(url);
      const parsedPage = isRecord(payload) && isRecord(payload.parse) ? payload.parse : null;
      if (!parsedPage || !isText(parsedPage.title) || !isText(parsedPage.text)) {
        throw sourceError("NOVEL_SOURCE_NOT_FOUND", "선택한 위키문헌 작품을 읽을 수 없습니다.", HttpStatus.NOT_FOUND);
      }
      const title = parsedPage.title.trim().slice(0, 300);
      const contributors = extractWikisourceContributors(parsedPage.wikitext);
      book = {
        provider: NOVEL_SOURCE_WIKISOURCE_PROVIDER, sourceId: value.sourceId, title, ...contributors, language: "ko", subjects: [],
        sourceUrl: `https://ko.wikisource.org/wiki/${encodeURIComponent(title.replace(/ /gu, "_"))}`,
      };
      sourceText = normalizeWikisourceHtml(parsedPage.text);
      if (!sourceText) throw sourceError("NOVEL_SOURCE_TEXT_INVALID", "위키문헌에서 읽을 수 있는 본문을 찾지 못했습니다.", HttpStatus.BAD_GATEWAY);
    }
    const parsed = parseChapters(sourceText);
    const fullSourceCharacterCount = parsed.text.length;
    const range = requestedRange as NovelSourceChapterRange | undefined;
    if (!range && fullSourceCharacterCount > NOVEL_SOURCE_MAX_CHARS) {
      return { book, fullSourceCharacterCount, chapters: parsed.chapters, needsChapterRange: true };
    }
    let selectedText = parsed.text;
    if (range) {
      if (parsed.chapters.length === 0 || range.lastChapter > parsed.chapterSpans.length) {
        throw sourceError("NOVEL_SOURCE_CHAPTERS_UNAVAILABLE", "이 원문에서 선택 가능한 장 경계를 찾지 못했습니다. 다른 작품을 고르거나 본문을 직접 붙여넣어 주세요.", HttpStatus.UNPROCESSABLE_ENTITY);
      }
      selectedText = parsed.text.slice(parsed.chapterSpans[range.firstChapter - 1]!.start, parsed.chapterSpans[range.lastChapter - 1]!.end).trim();
    }
    const selectedCharacterCount = selectedText.length;
    if (selectedCharacterCount > NOVEL_SOURCE_MAX_CHARS) {
      return { book, fullSourceCharacterCount, chapters: parsed.chapters, needsChapterRange: false, selectedChapterRange: range, selectedCharacterCount, selectionTooLong: true };
    }
    return { book, fullSourceCharacterCount, chapters: parsed.chapters, needsChapterRange: false,
      ...(range ? { selectedChapterRange: range } : {}), selectedCharacterCount, sourceText: selectedText };
  }

  private async getJson(url: URL): Promise<unknown> {
    const response = await this.request(url);
    if (!response.ok) throw sourceError("NOVEL_SOURCE_UPSTREAM_ERROR", `작품 목록 제공처가 HTTP ${response.status}를 반환했습니다.`);
    try { return await response.json() as unknown; }
    catch { throw sourceError("NOVEL_SOURCE_UPSTREAM_INVALID", "작품 제공처의 응답을 읽을 수 없습니다."); }
  }

  private async fetchText(id: number): Promise<string> {
    const url = new URL(`/cache/epub/${id}/pg${id}.txt`, GUTENBERG_TEXT_MIRROR);
    const response = await this.request(url);
    if (!response.ok) throw sourceError("NOVEL_SOURCE_TEXT_UNAVAILABLE", "선택한 작품의 텍스트 파일을 제공처에서 가져오지 못했습니다.", HttpStatus.BAD_GATEWAY);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BOOK_DOWNLOAD_BYTES) throw sourceError("NOVEL_SOURCE_TEXT_TOO_LARGE", "작품 파일이 허용한 크기보다 큽니다.", HttpStatus.PAYLOAD_TOO_LARGE);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BOOK_DOWNLOAD_BYTES) throw sourceError("NOVEL_SOURCE_TEXT_TOO_LARGE", "작품 파일이 허용한 크기보다 큽니다.", HttpStatus.PAYLOAD_TOO_LARGE);
    return normalizeGutenbergText(bytes.toString("utf8"));
  }

  private async request(url: URL): Promise<Response> {
    try {
      return await this.http.request(url, { headers: { "user-agent": USER_AGENT, accept: "application/json, text/plain;q=0.9" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw sourceError("NOVEL_SOURCE_UNAVAILABLE", "작품 제공처에 연결하지 못했습니다. 잠시 뒤 다시 검색해 주세요.", HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
