/** The source catalog is an index only. The full source text is returned only after an explicit work selection. */
export const NOVEL_SOURCE_PROVIDER = "project-gutenberg" as const;
export const NOVEL_SOURCE_WIKISOURCE_PROVIDER = "ko-wikisource" as const;
export type NovelSourceProvider = typeof NOVEL_SOURCE_PROVIDER | typeof NOVEL_SOURCE_WIKISOURCE_PROVIDER;
export type NovelSourceLanguage = "en" | "ko";
export const NOVEL_SOURCE_MAX_PAGE_SIZE = 32;
export const NOVEL_SOURCE_DEFAULT_LANGUAGE: NovelSourceLanguage = "ko";
/** Death in 1955 or earlier has completed the Korean life-plus-70 term by January 2026. */
export const novelSourceDeathYearCutoff = (currentYear = new Date().getUTCFullYear()): number => currentYear - 71;

export function isNovelSourceContributorExpired(deathYear: number, currentYear = new Date().getUTCFullYear()): boolean {
  return Number.isInteger(deathYear) && deathYear <= novelSourceDeathYearCutoff(currentYear);
}

export interface NovelSourceSearchRequest {
  query: string;
  language?: NovelSourceLanguage;
  topic?: string;
  page?: number;
  pageToken?: string;
}

export interface NovelSourceContributor {
  name: string;
  deathYear?: number | null;
}

export interface NovelSourceBook {
  provider: NovelSourceProvider;
  sourceId: string;
  title: string;
  authors: NovelSourceContributor[];
  translators: NovelSourceContributor[];
  language: NovelSourceLanguage;
  subjects: string[];
  sourceUrl: string;
  /** Source metadata only; this is not a permission or reuse decision. */
  rightsEvidence?: string;
}

export interface NovelSourceSearchResponse {
  provider: NovelSourceProvider;
  results: NovelSourceBook[];
  page: number;
  hasNextPage: boolean;
  nextPageToken?: string;
}

export interface NovelSourceChapter {
  number: number;
  title: string;
  characterCount: number;
}

export interface NovelSourceChapterRange {
  firstChapter: number;
  lastChapter: number;
}

export interface NovelSourceImportRequest {
  /** Optional for older English Gutenberg callers; new source-specific UI sends it explicitly. */
  provider?: NovelSourceProvider;
  sourceId: string;
  chapterRange?: NovelSourceChapterRange;
}

export interface NovelSourceImportResponse {
  book: NovelSourceBook;
  fullSourceCharacterCount: number;
  chapters: NovelSourceChapter[];
  needsChapterRange: boolean;
  selectedChapterRange?: NovelSourceChapterRange;
  selectedCharacterCount?: number;
  /** Missing only when the source exceeds the analysis limit and needs a chapter range, or the chosen range is too long. */
  sourceText?: string;
  selectionTooLong?: boolean;
}

/** Citation-only metadata persisted with a successful analysis; sourceText is deliberately excluded. */
export interface NovelStorySourceCitation {
  provider: NovelSourceProvider;
  sourceId: string;
  title: string;
  authors: NovelSourceContributor[];
  translators: NovelSourceContributor[];
  language: NovelSourceLanguage;
  sourceUrl: string;
  rightsEvidence?: string;
  fullSourceCharacterCount: number;
  selectedCharacterCount: number;
  chapterRange?: NovelSourceChapterRange;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;
const isProvider = (value: unknown): value is NovelSourceProvider => value === NOVEL_SOURCE_PROVIDER || value === NOVEL_SOURCE_WIKISOURCE_PROVIDER;

function sourceUrl(provider: NovelSourceProvider, sourceId: string, title: string): string {
  return provider === NOVEL_SOURCE_PROVIDER
    ? `https://www.gutenberg.org/ebooks/${sourceId}`
    : `https://ko.wikisource.org/wiki/${encodeURIComponent(title.replace(/ /gu, "_"))}`;
}

export function isNovelSourceBook(value: unknown): value is NovelSourceBook {
  if (!isRecord(value) || !isProvider(value.provider) || !/^[1-9]\d{0,8}$/.test(String(value.sourceId))
    || !isString(value.title) || !value.title.trim()
    || (value.provider === NOVEL_SOURCE_PROVIDER ? value.language !== "en" : value.language !== "ko")
    || value.sourceUrl !== sourceUrl(value.provider, String(value.sourceId), value.title)
    || (value.rightsEvidence !== undefined && !isString(value.rightsEvidence))
    || !Array.isArray(value.subjects) || !value.subjects.every(isString)) return false;
  const contributors = (entries: unknown): entries is NovelSourceContributor[] => Array.isArray(entries)
    && entries.every((entry) => isRecord(entry) && isString(entry.name) && !!entry.name.trim()
      && (entry.deathYear === undefined || entry.deathYear === null || Number.isInteger(entry.deathYear)));
  return contributors(value.authors) && (value.provider === NOVEL_SOURCE_WIKISOURCE_PROVIDER || value.authors.length > 0)
    && contributors(value.translators);
}

export function isNovelSourceSearchResponse(value: unknown): value is NovelSourceSearchResponse {
  return isRecord(value) && isProvider(value.provider) && Array.isArray(value.results)
    && value.results.length <= NOVEL_SOURCE_MAX_PAGE_SIZE && value.results.every((book) => isNovelSourceBook(book) && book.provider === value.provider)
    && isPositiveInteger(value.page) && typeof value.hasNextPage === "boolean"
    && (value.nextPageToken === undefined || isString(value.nextPageToken));
}

export function isNovelSourceImportResponse(value: unknown): value is NovelSourceImportResponse {
  if (!isRecord(value) || !isNovelSourceBook(value.book) || !Number.isInteger(value.fullSourceCharacterCount) || (value.fullSourceCharacterCount as number) < 0
    || !Array.isArray(value.chapters) || !value.chapters.every((chapter, index) => isRecord(chapter) && chapter.number === index + 1
      && isString(chapter.title) && Number.isInteger(chapter.characterCount) && (chapter.characterCount as number) >= 0)
    || typeof value.needsChapterRange !== "boolean") return false;
  const range = (candidate: unknown): candidate is NovelSourceChapterRange => isRecord(candidate)
    && isPositiveInteger(candidate.firstChapter) && isPositiveInteger(candidate.lastChapter) && (candidate.lastChapter as number) >= (candidate.firstChapter as number);
  if (value.selectedChapterRange !== undefined && !range(value.selectedChapterRange)) return false;
  if (value.selectedCharacterCount !== undefined && (typeof value.selectedCharacterCount !== "number" || !Number.isInteger(value.selectedCharacterCount) || value.selectedCharacterCount < 0)) return false;
  if (value.sourceText !== undefined && !isString(value.sourceText)) return false;
  if (value.selectionTooLong !== undefined && typeof value.selectionTooLong !== "boolean") return false;
  if (value.sourceText !== undefined && value.selectedCharacterCount !== value.sourceText.length) return false;
  if (value.needsChapterRange && value.sourceText !== undefined) return false;
  if (value.selectionTooLong && (value.sourceText !== undefined || value.selectedCharacterCount === undefined)) return false;
  return true;
}

export function isNovelStorySourceCitation(value: unknown): value is NovelStorySourceCitation {
  if (!isRecord(value) || !isNovelSourceBook({ ...value, subjects: Array.isArray(value.subjects) ? value.subjects : [] }) || !Number.isInteger(value.fullSourceCharacterCount)
    || !Number.isInteger(value.selectedCharacterCount)) return false;
  const row = value as unknown as NovelStorySourceCitation;
  if (row.fullSourceCharacterCount < 0 || row.selectedCharacterCount < 0 || row.selectedCharacterCount > row.fullSourceCharacterCount) return false;
  if (row.chapterRange && (!isPositiveInteger(row.chapterRange.firstChapter) || !isPositiveInteger(row.chapterRange.lastChapter)
    || row.chapterRange.lastChapter < row.chapterRange.firstChapter)) return false;
  return true;
}
