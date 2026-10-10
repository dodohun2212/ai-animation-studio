import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { NovelSourceHttpClient } from "../providers/novel-source-http.client.js";
import {
  NOVEL_SOURCE_MAX_PAGE_SIZE, NOVEL_SOURCE_PROVIDER, NOVEL_SOURCE_MAX_CHARS, isNovelSourceContributorExpired,
  type NovelSourceBook, type NovelSourceChapter, type NovelSourceChapterRange, type NovelSourceImportRequest,
  type NovelSourceImportResponse, type NovelSourceSearchRequest, type NovelSourceSearchResponse,
} from "@ai-animation-studio/shared";

const GUTENDEX_BASE = "https://gutendex.com/books";
/** Project Gutenberg lists this official mirror for automated downloads; do not fetch ebooks from the main website. */
export const GUTENBERG_TEXT_MIRROR = "https://gutenberg.pglaf.org";
const MAX_BOOK_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = "AI-Animation-Studio/2.0 (https://github.com/dodohun2212/ai-animation-studio)";

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const sourceError = (code: string, message: string, status = HttpStatus.BAD_GATEWAY, details?: RecordValue) =>
  new HttpException({ code, message, ...(details ? { details } : {}) }, status);

interface ParsedText { text: string; chapters: NovelSourceChapter[]; chapterSpans: Array<{ start: number; end: number }> }

function parseContributor(value: unknown): { name: string; deathYear: number } | null {
  if (!isRecord(value) || !isText(value.name) || !value.name.trim() || !Number.isInteger(value.death_year)) return null;
  return { name: value.name.trim(), deathYear: value.death_year as number };
}

function mapBook(value: unknown): NovelSourceBook | null {
  if (!isRecord(value) || !Number.isInteger(value.id) || (value.id as number) < 1 || (value.id as number) > 999_999_999
    || !isText(value.title) || !value.title.trim() || value.copyright !== false || !Array.isArray(value.languages)
    || !value.languages.includes("en") || !Array.isArray(value.authors) || value.authors.length === 0
    || !Array.isArray(value.translators) || !isRecord(value.formats)) return null;
  const authors = value.authors.map(parseContributor);
  const translators = value.translators.map(parseContributor);
  if (authors.some((author) => author === null || !isNovelSourceContributorExpired(author.deathYear))
    || translators.some((translator) => translator === null || !isNovelSourceContributorExpired(translator.deathYear))) return null;
  const id = String(value.id);
  const contributors = [...authors, ...translators] as Array<{ name: string; deathYear: number }>;
  const cutoff = new Date().getUTCFullYear() - 71;
  const subjects = [...new Set([
    ...(Array.isArray(value.subjects) ? value.subjects.filter(isText) : []),
    ...(Array.isArray(value.bookshelves) ? value.bookshelves.filter(isText) : []),
  ])].slice(0, 40);
  return {
    provider: NOVEL_SOURCE_PROVIDER,
    sourceId: id,
    title: value.title.trim().slice(0, 300),
    authors: authors as Array<{ name: string; deathYear: number }>,
    translators: translators as Array<{ name: string; deathYear: number }>,
    language: "en",
    subjects,
    sourceUrl: `https://www.gutenberg.org/ebooks/${id}`,
    rightsEvidence: `Project Gutenberg copyright=false, and every named author/translator died by ${cutoff} (Korean life+70 filter). This is an eligibility filter, not a legal guarantee.`,
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

const CHAPTER_HEADING = /^\s*((?:chapter|book|part)\s+(?:\d+|[ivxlcdm]+)\b[^\n]*)\s*$/i;

function parseChapters(text: string): ParsedText {
  const offsets: Array<{ offset: number; title: string }> = [];
  for (const match of text.matchAll(/^.*$/gm)) {
    const heading = CHAPTER_HEADING.exec(match[0]);
    if (heading) offsets.push({ offset: match.index, title: heading[1]!.trim().replace(/\s+/g, " ").slice(0, 200) });
  }
  const chapters = offsets.map((entry, index) => {
    const start = index === 0 ? 0 : entry.offset;
    const end = offsets[index + 1]?.offset ?? text.length;
    return { number: index + 1, title: entry.title, characterCount: text.slice(start, end).trim().length };
  });
  return {
    text,
    chapters,
    chapterSpans: offsets.map((entry, index) => ({ start: index === 0 ? 0 : entry.offset, end: offsets[index + 1]?.offset ?? text.length })),
  };
}

@Injectable()
export class NovelSourceService {
  constructor(private readonly http: NovelSourceHttpClient) {}

  async search(value: unknown): Promise<NovelSourceSearchResponse> {
    if (!isRecord(value) || Object.keys(value).some((key) => !["query", "topic", "page"].includes(key))
      || !isText(value.query) || value.query.length > 120
      || (value.topic !== undefined && (!isText(value.topic) || value.topic.length > 80))
      || (value.page !== undefined && (!Number.isInteger(value.page) || (value.page as number) < 1 || (value.page as number) > 100_000))) {
      throw sourceError("NOVEL_SOURCE_INVALID_REQUEST", "작품 검색 조건을 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const query = value.query.trim();
    const topic = typeof value.topic === "string" ? value.topic.trim() : "";
    if (!query && !topic) throw sourceError("NOVEL_SOURCE_INVALID_REQUEST", "제목·작가 또는 장르 검색어를 입력해 주세요.", HttpStatus.BAD_REQUEST);
    const url = new URL(GUTENDEX_BASE);
    url.searchParams.set("languages", "en");
    url.searchParams.set("copyright", "false");
    if (query) url.searchParams.set("search", query);
    if (topic) url.searchParams.set("topic", topic);
    if (value.page !== undefined) url.searchParams.set("page", String(value.page));
    const payload = await this.getJson(url);
    if (!isRecord(payload) || !Array.isArray(payload.results)) throw sourceError("NOVEL_SOURCE_UPSTREAM_INVALID", "작품 목록 응답을 읽을 수 없습니다.");
    const results = payload.results.map(mapBook).filter((book): book is NovelSourceBook => book !== null).slice(0, NOVEL_SOURCE_MAX_PAGE_SIZE);
    return { provider: NOVEL_SOURCE_PROVIDER, results, page: Number.isInteger(value.page) ? value.page as number : 1, hasNextPage: typeof payload.next === "string" && !!payload.next };
  }

  async importWork(value: unknown): Promise<NovelSourceImportResponse> {
    if (!isRecord(value) || Object.keys(value).some((key) => !["sourceId", "chapterRange"].includes(key))
      || typeof value.sourceId !== "string" || !/^[1-9]\d{0,8}$/.test(value.sourceId)) {
      throw sourceError("NOVEL_SOURCE_INVALID_REQUEST", "가져올 작품을 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const requestedRange = value.chapterRange;
    if (requestedRange !== undefined && (!isRecord(requestedRange) || Object.keys(requestedRange).some((key) => !["firstChapter", "lastChapter"].includes(key))
      || !Number.isInteger(requestedRange.firstChapter) || (requestedRange.firstChapter as number) < 1
      || !Number.isInteger(requestedRange.lastChapter) || (requestedRange.lastChapter as number) < (requestedRange.firstChapter as number))) {
      throw sourceError("NOVEL_SOURCE_INVALID_REQUEST", "연속된 장 범위를 확인해 주세요.", HttpStatus.BAD_REQUEST);
    }
    const id = Number(value.sourceId);
    const bookPayload = await this.getJson(new URL(`${GUTENDEX_BASE}/${id}`));
    const book = mapBook(bookPayload);
    if (!book || book.sourceId !== value.sourceId) throw sourceError("NOVEL_SOURCE_NOT_ELIGIBLE", "한국의 보호기간 기준을 확인할 수 있는 원문만 가져올 수 있습니다.", HttpStatus.NOT_FOUND);
    const parsed = parseChapters(await this.fetchText(id));
    const fullSourceCharacterCount = parsed.text.length;
    const range = requestedRange as NovelSourceChapterRange | undefined;
    if (!range && fullSourceCharacterCount > NOVEL_SOURCE_MAX_CHARS) {
      return { book, fullSourceCharacterCount, chapters: parsed.chapters, needsChapterRange: true };
    }
    let sourceText = parsed.text;
    if (range) {
      if (parsed.chapters.length === 0 || range.lastChapter > parsed.chapterSpans.length) {
        throw sourceError("NOVEL_SOURCE_CHAPTERS_UNAVAILABLE", "이 원문에서 선택 가능한 장 경계를 찾지 못했습니다. 다른 작품을 고르거나 본문을 직접 붙여넣어 주세요.", HttpStatus.UNPROCESSABLE_ENTITY);
      }
      sourceText = parsed.text.slice(parsed.chapterSpans[range.firstChapter - 1]!.start, parsed.chapterSpans[range.lastChapter - 1]!.end).trim();
    }
    const selectedCharacterCount = sourceText.length;
    if (selectedCharacterCount > NOVEL_SOURCE_MAX_CHARS) {
      return { book, fullSourceCharacterCount, chapters: parsed.chapters, needsChapterRange: false, selectedChapterRange: range, selectedCharacterCount, selectionTooLong: true };
    }
    return { book, fullSourceCharacterCount, chapters: parsed.chapters, needsChapterRange: false,
      ...(range ? { selectedChapterRange: range } : {}), selectedCharacterCount, sourceText };
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
