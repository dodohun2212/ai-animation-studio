import { useRef, useState } from "react";
import {
  NOVEL_SOURCE_MAX_CHARS,
  novelSourceDeathYearCutoff,
  type NovelSourceBook,
  type NovelSourceChapterRange,
  type NovelSourceContributor,
  type NovelSourceImportResponse,
  type NovelSourceSearchResponse,
  type NovelStorySourceCitation,
} from "@ai-animation-studio/shared";

import { importNovelSource, searchNovelSources, toNovelSourceDisplayError } from "../api/novelSourceApi.js";
import { Spinner } from "./Spinner.js";
import { outlineButton, smallOutlineButton } from "./ui/surfaces.js";

export interface PickedNovelSource {
  text: string;
  citation: NovelStorySourceCitation;
}

interface Props {
  /** 고른 본문을 이야기 칸에 넣습니다 — 사람이 「이 본문 쓰기」를 눌렀을 때만. */
  onPick: (picked: PickedNovelSource) => void;
  /** 이야기 본문 칸에 이미 글이 있는지 — 있으면 버튼이 「바꿉니다」라고 말합니다. */
  hasText: boolean;
  disabled?: boolean;
}

type DisplayError = { code: string; message: string };

/**
 * 장르 칸 — Gutendex 의 `topic` 은 영어 주제어·서가 이름의 부분 일치라, 한국어 이름에 영어 주제어를 짝지어 둡니다.
 * 고른 주제어는 그대로 보냅니다(번역·추측하지 않음).
 */
export const NOVEL_SOURCE_TOPICS: ReadonlyArray<{ label: string; topic: string }> = [
  { label: "판타지", topic: "fantasy" },
  { label: "모험", topic: "adventure" },
  { label: "공포", topic: "horror" },
  { label: "SF", topic: "science fiction" },
  { label: "추리", topic: "detective" },
  { label: "로맨스", topic: "love stories" },
  { label: "동화", topic: "fairy tales" },
  { label: "단편집", topic: "short stories" },
];

const inputClass = "mt-1 w-full rounded border border-line bg-slate-900/70 px-3 py-2 text-sm text-bone placeholder:text-bone-faint/60 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30";

export const contributorsLabel = (people: NovelSourceContributor[]) => people.map((person) => `${person.name} (~${person.deathYear})`).join(", ");
const count = (value: number) => value.toLocaleString("ko-KR");

/** 고른 연속 범위의 장 글자 수 합 — 서버가 범위 앞뒤 공백을 다듬어 실제 값은 조금 작을 수 있어 「약」으로 씁니다. */
export function chapterRangeCharacterCount(chapters: NovelSourceImportResponse["chapters"], range: NovelSourceChapterRange): number {
  return chapters.filter((chapter) => chapter.number >= range.firstChapter && chapter.number <= range.lastChapter)
    .reduce((sum, chapter) => sum + chapter.characterCount, 0);
}

/** 분석 입력의 출처 기록 — 원문은 넣지 않습니다. 작품 정보 전체에 가져온 길이와 고른 장 범위를 붙입니다. */
export function citationFor(book: NovelSourceBook, response: NovelSourceImportResponse): NovelStorySourceCitation {
  return {
    ...book,
    fullSourceCharacterCount: response.fullSourceCharacterCount,
    selectedCharacterCount: response.selectedCharacterCount ?? response.sourceText?.length ?? 0,
    ...(response.selectedChapterRange ? { chapterRange: response.selectedChapterRange } : {}),
  };
}

/**
 * 「작품 고르기」 — 저작권이 끝난 소설을 찾아 이야기 본문 칸에 넣습니다(CLI 1345, 캡틴D 결정 1344-(a)).
 *
 * 🔴 순서: 검색(목록만, 본문 없음) → 한 편 「길이 확인」(그 한 편의 본문을 서버가 받아 길이와 장 목록을 셈) → 한도 안이면
 * 「이 본문 쓰기」, 한도를 넘으면 연속된 장 범위를 골라 「이 범위 가져오기」 → 「이 본문 쓰기」. 어느 단계도 유료 요청이 아니고,
 * 본문은 저장하지 않습니다. 분석은 아래 2번에서 지금처럼 미리보기 → 별도 승인입니다.
 * 🟠 목록의 거르기(저자·번역자 사망 연도 ≤ 기준 연도)는 보수적인 필터이지 법적 보증이 아니라고 늘 말합니다.
 */
export function NovelSourcePicker({ onPick, hasText, disabled = false }: Props) {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<NovelSourceSearchResponse | null>(null);
  const [searchError, setSearchError] = useState<DisplayError | null>(null);
  const [book, setBook] = useState<NovelSourceBook | null>(null);
  const [importing, setImporting] = useState(false);
  /** 범위 없이 가져온 결과 — 길이와 장 목록. 범위를 고르는 동안에도 이 목록을 씁니다. */
  const [lengthInfo, setLengthInfo] = useState<NovelSourceImportResponse | null>(null);
  /** 고른 범위로 다시 가져온 결과. */
  const [rangeResult, setRangeResult] = useState<NovelSourceImportResponse | null>(null);
  const [importError, setImportError] = useState<DisplayError | null>(null);
  const [firstChapter, setFirstChapter] = useState(1);
  const [lastChapter, setLastChapter] = useState(1);
  const busy = useRef(false);

  const cutoff = novelSourceDeathYearCutoff();
  const canSearch = !disabled && !searching && (query.trim().length > 0 || topic.length > 0);

  async function search(page = 1): Promise<void> {
    if (busy.current || !canSearch) return;
    busy.current = true;
    setSearching(true);
    setSearchError(null);
    try {
      setResults(await searchNovelSources({ query: query.trim(), ...(topic ? { topic } : {}), ...(page > 1 ? { page } : {}) }));
    } catch (caught) {
      setSearchError(toNovelSourceDisplayError(caught));
    } finally {
      busy.current = false;
      setSearching(false);
    }
  }

  async function checkLength(next: NovelSourceBook): Promise<void> {
    if (busy.current || disabled) return;
    busy.current = true;
    setBook(next);
    setLengthInfo(null);
    setRangeResult(null);
    setImportError(null);
    setImporting(true);
    try {
      const response = await importNovelSource({ sourceId: next.sourceId });
      setLengthInfo(response);
      setFirstChapter(1);
      setLastChapter(1);
    } catch (caught) {
      setImportError(toNovelSourceDisplayError(caught));
    } finally {
      busy.current = false;
      setImporting(false);
    }
  }

  async function importRange(): Promise<void> {
    if (busy.current || disabled || !book || !rangeValid) return;
    busy.current = true;
    setImportError(null);
    setRangeResult(null);
    setImporting(true);
    try {
      setRangeResult(await importNovelSource({ sourceId: book.sourceId, chapterRange: { firstChapter, lastChapter } }));
    } catch (caught) {
      setImportError(toNovelSourceDisplayError(caught));
    } finally {
      busy.current = false;
      setImporting(false);
    }
  }

  const chapters = lengthInfo?.chapters ?? [];
  const rangeValid = chapters.length > 0 && firstChapter >= 1 && lastChapter >= firstChapter && lastChapter <= chapters.length;
  const rangeCount = rangeValid ? chapterRangeCharacterCount(chapters, { firstChapter, lastChapter }) : 0;
  const rangeTooLong = rangeCount > NOVEL_SOURCE_MAX_CHARS;
  /** 지금 쓸 수 있는 본문 — 한도 안이라 바로 온 것, 또는 고른 범위로 온 것. */
  const usable = rangeResult?.sourceText !== undefined ? rangeResult : lengthInfo?.sourceText !== undefined ? lengthInfo : null;

  function pick(): void {
    if (!book || !usable || usable.sourceText === undefined) return;
    onPick({ text: usable.sourceText, citation: citationFor(book, usable) });
  }

  return (
    <div data-testid="novel-source-picker" className="space-y-3 rounded-lg border border-line bg-ground-raised p-5">
      <h2 className="text-base font-semibold text-bone">작품 고르기 — 저작권이 끝난 소설 (선택)</h2>
      <p data-testid="novel-source-scope" className="text-xs leading-relaxed text-bone-dim">
        Project Gutenberg의 영어 원문 중 저자·번역자가 모두 {cutoff}년까지 세상을 떠난 작품만 보여 줍니다(한국 보호기간 사후 70년 기준).
        이 거르기는 보수적인 필터일 뿐 법적 보증이 아니니, 각 작품의 근거와 원본 페이지를 확인해 주세요. 목록 단계에서는 정확한 분량을 알 수 없어,
        작품을 골라 「길이 확인」을 누르면 글자 수와 장 목록을 보여 줍니다. 한국어 만료 작품(공유마당)은 제공처 이용 조건을 확인하기 전이라 아직 없습니다.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-xs text-bone-dim">제목·작가 (영어)
          <input
            data-testid="novel-source-query"
            className={inputClass}
            value={query}
            maxLength={120}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(1); } }}
            disabled={disabled}
            placeholder="예: Poe, Sherlock, Alice"
          />
        </label>
        <label className="text-xs text-bone-dim">장르
          <select data-testid="novel-source-topic" className={inputClass} value={topic} onChange={(event) => setTopic(event.target.value)} disabled={disabled}>
            <option value="">전체</option>
            {NOVEL_SOURCE_TOPICS.map((entry) => <option key={entry.topic} value={entry.topic}>{entry.label} ({entry.topic})</option>)}
          </select>
        </label>
        <button type="button" data-testid="novel-source-search" className={outlineButton} onClick={() => void search(1)} disabled={!canSearch}>
          {searching ? "찾는 중…" : "검색"}
        </button>
      </div>
      {searching && <Spinner label="Project Gutenberg 목록을 찾는 중…" />}
      {searchError && <p role="alert" data-testid="novel-source-search-error" data-error-code={searchError.code} className="text-sm text-rose-400">{searchError.message}</p>}

      {results && (
        <div className="space-y-2" data-testid="novel-source-results">
          {results.results.length === 0
            ? <p data-testid="novel-source-empty" className="text-xs text-bone-dim">조건에 맞는 작품이 없습니다. 사망 연도를 확인할 수 없거나 기준보다 늦은 저자·번역자의 작품은 빠집니다 — 다른 검색어나 장르로 찾아 주세요.</p>
            : (
              <ul className="grid gap-2 md:grid-cols-2">
                {results.results.map((entry) => {
                  const selected = book?.sourceId === entry.sourceId;
                  return (
                    <li key={entry.sourceId} data-testid={`novel-source-book-${entry.sourceId}`} className={`min-w-0 space-y-1.5 rounded border p-3 ${selected ? "border-violet-400/50 bg-violet-500/15" : "border-line"}`}>
                      <p className="text-sm font-medium text-bone">{entry.title}</p>
                      <p className="text-xs text-bone-dim">{contributorsLabel(entry.authors)}{entry.translators.length > 0 ? ` · 번역 ${contributorsLabel(entry.translators)}` : ""}</p>
                      {entry.subjects.length > 0 && <p className="truncate text-[11px] text-bone-faint">{entry.subjects.slice(0, 3).join(" · ")}</p>}
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" data-testid={`novel-source-check-${entry.sourceId}`} className={smallOutlineButton} onClick={() => void checkLength(entry)} disabled={disabled || importing}>
                          {selected && importing && !rangeResult ? "확인하는 중…" : "길이 확인"}
                        </button>
                        <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-bone-faint underline hover:text-bone">원본 페이지</a>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          {(results.page > 1 || results.hasNextPage) && (
            <div className="flex items-center gap-2 text-xs text-bone-dim">
              <button type="button" data-testid="novel-source-prev" className={smallOutlineButton} onClick={() => void search(results.page - 1)} disabled={results.page <= 1 || searching}>이전</button>
              <span className="tabular-nums">{results.page}쪽</span>
              <button type="button" data-testid="novel-source-next" className={smallOutlineButton} onClick={() => void search(results.page + 1)} disabled={!results.hasNextPage || searching}>다음</button>
            </div>
          )}
        </div>
      )}

      {book && (
        <div data-testid="novel-source-selected" className="space-y-2 rounded border border-line p-3">
          <p className="text-sm text-bone">「{book.title}」 <span className="text-xs text-bone-dim">— {contributorsLabel(book.authors)}</span></p>
          <p data-testid="novel-source-rights" className="text-[11px] text-bone-faint">권리 근거: {book.rightsEvidence}</p>
          {importing && <Spinner label="원문을 받아 길이를 세는 중…" />}
          {importError && <p role="alert" data-testid="novel-source-import-error" data-error-code={importError.code} className="text-sm text-rose-400">{importError.message}</p>}
          {lengthInfo && (
            <p data-testid="novel-source-length" className="text-xs text-bone-dim tabular-nums">
              전체 {count(lengthInfo.fullSourceCharacterCount)}자 · 장 {chapters.length}개
              {lengthInfo.sourceText !== undefined
                ? ` — 분석 한도(${count(NOVEL_SOURCE_MAX_CHARS)}자) 안이라 전부 쓸 수 있습니다.`
                : ` — 분석 한도(${count(NOVEL_SOURCE_MAX_CHARS)}자)를 넘어 이어진 장 범위를 골라야 합니다. 한 작품을 1부·2부처럼 나눠 여러 작품으로 만들 수 있습니다.`}
            </p>
          )}

          {lengthInfo?.needsChapterRange && chapters.length === 0 && (
            <p data-testid="novel-source-no-chapters" className="text-xs text-amber-300">이 원문에서 장의 경계를 찾지 못해 범위를 고를 수 없습니다. 다른 작품을 고르거나 본문을 직접 붙여넣어 주세요.</p>
          )}
          {lengthInfo?.needsChapterRange && chapters.length > 0 && (
            <div className="space-y-2" data-testid="novel-source-range">
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-bone-dim">처음 장
                  <select data-testid="novel-source-first" className={inputClass} value={firstChapter} onChange={(event) => { const value = Number(event.target.value); setFirstChapter(value); if (lastChapter < value) setLastChapter(value); setRangeResult(null); }} disabled={disabled || importing}>
                    {chapters.map((chapter) => <option key={chapter.number} value={chapter.number}>{chapter.number}. {chapter.title}</option>)}
                  </select>
                </label>
                <label className="text-xs text-bone-dim">끝 장
                  <select data-testid="novel-source-last" className={inputClass} value={lastChapter} onChange={(event) => { setLastChapter(Number(event.target.value)); setRangeResult(null); }} disabled={disabled || importing}>
                    {chapters.filter((chapter) => chapter.number >= firstChapter).map((chapter) => <option key={chapter.number} value={chapter.number}>{chapter.number}. {chapter.title}</option>)}
                  </select>
                </label>
                <button type="button" data-testid="novel-source-import-range" className={smallOutlineButton} onClick={() => void importRange()} disabled={!rangeValid || rangeTooLong || importing || disabled}>이 범위 가져오기</button>
              </div>
              <p data-testid="novel-source-range-count" className={`text-xs tabular-nums ${rangeTooLong ? "text-amber-300" : "text-bone-dim"}`}>
                {firstChapter}–{lastChapter}장 · 약 {count(rangeCount)}자{rangeTooLong ? ` — 분석 한도(${count(NOVEL_SOURCE_MAX_CHARS)}자)를 넘습니다. 범위를 줄여 주세요.` : ""}
              </p>
              <ol className="max-h-48 space-y-0.5 overflow-y-auto rounded border border-line p-2 text-[11px] tabular-nums" aria-label="장 목록">
                {chapters.map((chapter) => {
                  const inRange = chapter.number >= firstChapter && chapter.number <= lastChapter;
                  return (
                    <li key={chapter.number} data-testid={`novel-source-chapter-${chapter.number}`} className={`flex gap-2 ${inRange ? "text-bone" : "text-bone-faint"}`}>
                      <span className="w-8 shrink-0 text-right">{chapter.number}.</span>
                      <span className="min-w-0 flex-1 truncate">{chapter.title}</span>
                      <span className="shrink-0">{count(chapter.characterCount)}자</span>
                    </li>
                  );
                })}
              </ol>
              {rangeResult?.selectionTooLong && (
                <p role="status" data-testid="novel-source-range-too-long" className="text-xs text-amber-300">
                  고른 범위가 {count(rangeResult.selectedCharacterCount ?? 0)}자라 분석 한도를 넘습니다. 범위를 줄여 다시 가져와 주세요.
                </p>
              )}
            </div>
          )}

          {usable && usable.sourceText !== undefined && (
            <div className="flex flex-wrap items-center gap-3">
              <p data-testid="novel-source-ready" className="text-xs text-emerald-300 tabular-nums">
                {usable.selectedChapterRange ? `${usable.selectedChapterRange.firstChapter}–${usable.selectedChapterRange.lastChapter}장 · ` : ""}{count(usable.sourceText.length)}자를 쓸 수 있습니다.
              </p>
              <button type="button" data-testid="novel-source-use" className={outlineButton} onClick={pick} disabled={disabled}>
                {hasText ? "이 본문 쓰기 (지금 본문을 바꿉니다)" : "이 본문 쓰기"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
