import { useEffect, useMemo, useState } from "react";
import {
  MEME_OBSERVATION_KINDS,
  MEME_OBSERVATION_LIMITS,
  PROVIDER_KEY_NOTES,
  type MemeAnalysisSuggestion,
  type MemeObservationCard,
  type MemeObservationKind,
  type MemeTrend,
  type MemeTrendWorkspace,
  type Project,
  type SaveMemeObservationCardsRequest,
} from "@ai-animation-studio/shared";

import {
  analyzeMemeVideo,
  dailyCallsFromError,
  getMemeTrendWorkspace,
  saveMemeObservationCards,
  toMemeTrendDisplayError,
} from "../api/memeTrendsApi.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { Spinner } from "./Spinner.js";
import { MemeRemixDraftPanel } from "./MemeRemixDraftPanel.js";
import { outlineButton, primaryButton, smallOutlineButton } from "./ui/surfaces.js";

interface Props {
  trend: MemeTrend;
  /** 키가 없을 때 갈 곳 — Gemini 키 칸은 API 설정에 있습니다. */
  onOpenSettings: () => void;
  onProjectCreated: (project: Project) => void;
  /** 저장된 카드 수가 알려질 때마다 — 화면 위 단계 띠가 「지금 몇 단계인가」를 말하는 데 씁니다. 미저장 입력은 세지 않습니다. */
  onSavedCardCount?: (count: number) => void;
}

type DisplayError = { code: string; message: string };

export const MEME_OBSERVATION_KIND_LABELS: Record<MemeObservationKind, string> = {
  line: "말",
  gesture: "동작",
  timing: "타이밍",
};

/** 화면에서 고치는 카드 한 장. 초는 입력칸 그대로(문자열)로 들고 있다가 저장할 때만 숫자로 바꿉니다. */
interface DraftCard {
  key: string;
  id?: string;
  kind: MemeObservationKind;
  text: string;
  start: string;
  end: string;
  origin: "suggestion" | "manual";
  suggestionId?: string;
  sourceVideoId: string | null;
}

let draftSequence = 0;
const nextKey = () => `draft-${++draftSequence}`;

const secondsText = (value: number | null) => (value === null ? "" : String(value));

function toDraft(card: MemeObservationCard): DraftCard {
  return {
    key: card.id,
    id: card.id,
    kind: card.kind,
    text: card.text,
    start: secondsText(card.startSeconds),
    end: secondsText(card.endSeconds),
    origin: card.origin,
    ...(card.suggestionId !== undefined ? { suggestionId: card.suggestionId } : {}),
    sourceVideoId: card.sourceVideoId,
  };
}

/** 빈칸은 null, 아니면 소수 한 자리까지의 0–600초. 그 밖은 undefined(= 잘못된 값). */
function parseSeconds(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > MEME_OBSERVATION_LIMITS.secondsMax) return undefined;
  if (Math.round(value * 10) !== value * 10) return undefined;
  return value;
}

/** 저장 전에 화면이 먼저 말하는 문제 — 서버의 같은 검사(`MEME_CARDS_INVALID`)에 닿기 전에. */
function draftProblem(card: DraftCard): string | null {
  const text = card.text.trim();
  if (text.length === 0) return "글자를 적어 주세요.";
  if (card.text.length > MEME_OBSERVATION_LIMITS.textMax) return `${MEME_OBSERVATION_LIMITS.textMax}자까지 적을 수 있습니다.`;
  const start = parseSeconds(card.start);
  const end = parseSeconds(card.end);
  if (start === undefined || end === undefined) return `초는 0–${MEME_OBSERVATION_LIMITS.secondsMax} 사이, 소수 한 자리까지입니다.`;
  if (start !== null && end !== null && end < start) return "끝 시간이 시작보다 앞섭니다.";
  return null;
}

function toRequestCards(drafts: DraftCard[]): SaveMemeObservationCardsRequest["cards"] {
  return drafts.map((card) => ({
    ...(card.id ? { id: card.id } : {}),
    kind: card.kind,
    text: card.text.trim(),
    startSeconds: parseSeconds(card.start) ?? null,
    endSeconds: parseSeconds(card.end) ?? null,
    origin: card.origin,
    ...(card.suggestionId !== undefined ? { suggestionId: card.suggestionId } : {}),
    sourceVideoId: card.sourceVideoId,
  }));
}

/** 저장본과 같은지 — 미저장 경고는 이 비교 하나에서 나옵니다. */
const draftSignature = (drafts: DraftCard[]) =>
  JSON.stringify(drafts.map((card) => [card.id ?? null, card.kind, card.text.trim(), card.start.trim(), card.end.trim(), card.origin, card.suggestionId ?? null, card.sourceVideoId]));

function timeLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  const restText = Number.isInteger(rest) ? String(rest).padStart(2, "0") : rest.toFixed(1).padStart(4, "0");
  return `${minutes}:${restText}`;
}

function rangeLabel(start: number | null, end: number | null): string | null {
  if (start === null && end === null) return null;
  if (start !== null && end !== null) return `${timeLabel(start)}–${timeLabel(end)}`;
  return start !== null ? `${timeLabel(start)}부터` : `${timeLabel(end!)}까지`;
}

/** 가져온 뒤 고쳤는지 — 서버는 표시를 따로 두지 않고, 제안 원문과 비교합니다(CLI Round 1280 결정 4). */
function editedFromSuggestion(card: DraftCard, suggestion: MemeAnalysisSuggestion | undefined): boolean {
  if (!suggestion) return false;
  return card.kind !== suggestion.kind
    || card.text.trim() !== suggestion.text.trim()
    || (parseSeconds(card.start) ?? null) !== suggestion.startSeconds
    || (parseSeconds(card.end) ?? null) !== suggestion.endSeconds;
}

/**
 * 밈 관찰 카드(② — CLI Round 1278·1280).
 *
 * 🔴 **읽기와 분석이 갈라져 있습니다.** 후보를 고르면 저장된 작업 공간만 읽습니다. Gemini 는 「이 영상 분석」을
 * 누를 때 한 번만 부르고, 자동 분석도 자동 재시도도 없습니다 — 요청이 나간 뒤에는 실패도 오늘 횟수를 씁니다.
 *
 * 🔴 **제안과 카드는 다른 것입니다.** 제안은 모델이 낸 것(읽기 전용)이고, 카드는 사람이 저장한 것입니다. 분석이
 * 성공해도 카드는 바뀌지 않고, 「카드로 가져오기」를 누른 것만 복사됩니다. 그래서 분석이 실패하거나 키가 없어도
 * 사람이 적어 둔 것은 그대로이고, **직접 적는 길이 언제나 열려 있습니다.**
 */
export function MemeObservationPanel({ trend, onOpenSettings, onProjectCreated, onSavedCardCount }: Props) {
  const [workspace, setWorkspace] = useState<MemeTrendWorkspace | null>(null);
  const [loadError, setLoadError] = useState<DisplayError | null>(null);
  const [drafts, setDrafts] = useState<DraftCard[]>([]);
  const [savedSignature, setSavedSignature] = useState(draftSignature([]));
  const [videoId, setVideoId] = useState(() => defaultVideoId(trend));
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<DisplayError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<DisplayError | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [showRemixDraft, setShowRemixDraft] = useState(false);

  function adoptSaved(next: MemeTrendWorkspace): void {
    const nextDrafts = next.cards.map(toDraft);
    setDrafts(nextDrafts);
    setSavedSignature(draftSignature(nextDrafts));
  }

  async function load(keepDrafts: boolean): Promise<void> {
    try {
      const next = await getMemeTrendWorkspace(trend.id);
      setWorkspace(next);
      setLoadError(null);
      if (keepDrafts) setSavedSignature(draftSignature(next.cards.map(toDraft)));
      else adoptSaved(next);
    } catch (caught) {
      setLoadError(toMemeTrendDisplayError(caught));
    }
  }

  useEffect(() => {
    let cancelled = false;
    getMemeTrendWorkspace(trend.id)
      .then((next) => {
        if (cancelled) return;
        setWorkspace(next);
        adoptSaved(next);
      })
      .catch((caught: unknown) => { if (!cancelled) setLoadError(toMemeTrendDisplayError(caught)); });
    return () => { cancelled = true; };
  }, [trend.id]);

  const savedCardCount = workspace?.cards.length ?? null;
  useEffect(() => { if (savedCardCount !== null) onSavedCardCount?.(savedCardCount); }, [savedCardCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestionsById = useMemo(
    () => new Map((workspace?.analysis?.suggestions ?? []).map((item) => [item.id, item])),
    [workspace?.analysis],
  );
  const unsaved = draftSignature(drafts) !== savedSignature;
  const problems = drafts.map(draftProblem);
  const canSave = !saving && workspace !== null && problems.every((problem) => problem === null) && unsaved;
  const calls = workspace?.dailyCalls ?? null;
  const limitReached = calls !== null && calls.used >= calls.limit;
  const canAnalyze = !analyzing && workspace !== null && calls !== null && !limitReached && trend.videos.some((video) => video.videoId === videoId);
  const atCardLimit = drafts.length >= MEME_OBSERVATION_LIMITS.cardsMax;
  const analysisVideo = workspace?.analysis ? trend.videos.find((video) => video.videoId === workspace.analysis!.sourceVideoId) : undefined;

  async function analyze(): Promise<void> {
    if (!canAnalyze) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const next = await analyzeMemeVideo(trend.id, { sourceVideoId: videoId });
      // 🔴 카드는 건드리지 않습니다 — 고치던 입력도 그대로. 제안과 횟수만 새 것으로.
      setWorkspace((old) => (old ? { ...old, analysis: next.analysis, dailyCalls: next.dailyCalls } : next));
    } catch (caught) {
      setAnalyzeError(toMemeTrendDisplayError(caught));
      const updated = dailyCallsFromError(caught);
      if (updated) setWorkspace((old) => (old ? { ...old, dailyCalls: updated } : old));
    } finally {
      setAnalyzing(false);
    }
  }

  async function save(): Promise<void> {
    if (!canSave || !workspace) return;
    setSaving(true);
    setSaveError(null);
    setSavedNotice(false);
    try {
      const next = await saveMemeObservationCards(trend.id, { cards: toRequestCards(drafts), expectedCardsSavedAt: workspace.cardsSavedAt });
      setWorkspace(next);
      adoptSaved(next);
      setSavedNotice(true);
    } catch (caught) {
      // 🔴 입력은 그대로 둡니다 — 저장이 실패했다고 사람이 적은 것을 잃게 하지 않습니다.
      setSaveError(toMemeTrendDisplayError(caught));
    } finally {
      setSaving(false);
    }
  }

  function update(key: string, patch: Partial<DraftCard>): void {
    setSavedNotice(false);
    setDrafts((old) => old.map((card) => (card.key === key ? { ...card, ...patch } : card)));
  }

  function remove(key: string): void {
    setSavedNotice(false);
    setDrafts((old) => old.filter((card) => card.key !== key));
  }

  function addManual(): void {
    if (atCardLimit) return;
    setSavedNotice(false);
    setDrafts((old) => [...old, { key: nextKey(), kind: "line", text: "", start: "", end: "", origin: "manual", sourceVideoId: null }]);
  }

  function importSuggestion(suggestion: MemeAnalysisSuggestion): void {
    if (atCardLimit || !workspace?.analysis) return;
    setSavedNotice(false);
    const sourceVideoId = workspace.analysis.sourceVideoId;
    setDrafts((old) => [...old, {
      key: nextKey(),
      kind: suggestion.kind,
      text: suggestion.text,
      start: secondsText(suggestion.startSeconds),
      end: secondsText(suggestion.endSeconds),
      origin: "suggestion",
      suggestionId: suggestion.id,
      sourceVideoId,
    }]);
  }

  return (
    <section data-testid="meme-observations" aria-label="밈 관찰 카드" className="mt-6 space-y-5 rounded-lg border border-line bg-ground-raised p-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-bone">밈 관찰 카드</h2>
        <p className="text-xs text-bone-dim">이 밈에서 알아볼 수 있는 말·동작·타이밍을 카드로 적어 둡니다. 다음 단계에서 이 카드로 내 캐릭터 장면을 짭니다.</p>
      </div>

      {workspace === null && !loadError && <Spinner label="저장된 카드를 불러오는 중..." />}

      {loadError && (
        <div role="alert" data-testid="meme-observations-load-error" data-error-code={loadError.code} className="space-y-2">
          <p className="text-sm text-rose-400">{loadError.message}</p>
          {loadError.code !== "MEME_TREND_UNKNOWN" && (
            <button type="button" className={smallOutlineButton} onClick={() => void load(false)}>다시 불러오기</button>
          )}
        </div>
      )}

      {workspace && (
        <>
          {/* ── 분석: 누를 때 한 번 ── */}
          <div className="space-y-2" data-testid="meme-analysis">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-0 flex-1 space-y-1">
                <span className="block text-xs text-bone-dim">분석할 영상</span>
                <select
                  data-testid="meme-analysis-video"
                  value={videoId}
                  onChange={(event) => setVideoId(event.target.value)}
                  disabled={analyzing}
                  className="w-full rounded border border-line bg-slate-900/70 px-2.5 py-1.5 text-sm text-bone"
                >
                  {trend.videos.map((video) => (
                    <option key={video.videoId} value={video.videoId}>
                      {video.title} · {video.channelTitle}{video.viewCount === null ? "" : ` · ${video.viewCount.toLocaleString("ko-KR")}회`}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" data-testid="meme-analysis-run" className={outlineButton} onClick={() => void analyze()} disabled={!canAnalyze}>
                {analyzing ? "분석하는 중…" : "이 영상 분석 (Gemini 1회)"}
              </button>
            </div>
            <p className="text-xs text-bone-dim" data-testid="meme-analysis-calls">
              {calls === null
                ? "분석 사용 기록을 읽지 못해 오늘 쓴 횟수를 모릅니다 — 확인하기 전에는 분석을 부르지 않습니다."
                : limitReached
                  ? `오늘 ${calls.used} / ${calls.limit}회 — 오늘 분석 횟수를 다 썼습니다. 아래에서 직접 적을 수 있습니다.`
                  : `오늘 ${calls.used} / ${calls.limit}회`}
            </p>
            <p className="text-xs text-bone-faint">
              공개 YouTube 주소를 Gemini에 보내 말·동작·타이밍을 제안받습니다. 결과는 제안일 뿐이고, 요청이 나가면 실패해도 한 번으로 셉니다.
            </p>
            {PROVIDER_KEY_NOTES.gemini && (
              <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-300" data-testid="meme-analysis-key-note">
                {PROVIDER_KEY_NOTES.gemini}
              </p>
            )}
            {analyzing && <Spinner label="Gemini가 영상을 보는 중…" />}
            {analyzeError && (
              <div role="alert" data-testid="meme-analysis-error" data-error-code={analyzeError.code} className="space-y-2 rounded-lg border border-rose-400/30 bg-rose-500/15 p-3">
                <p className="text-sm text-rose-400">{analyzeError.message}</p>
                {analyzeError.code === "MEME_ANALYSIS_KEY_MISSING" && (
                  <button type="button" data-testid="meme-analysis-open-settings" className={smallOutlineButton} onClick={onOpenSettings}>API 설정 열기</button>
                )}
              </div>
            )}
          </div>

          {/* ── 제안: 읽기 전용 ── */}
          {workspace.analysis && (
            <div className="space-y-2" data-testid="meme-suggestions">
              <h3 className="text-sm font-medium text-bone">
                Gemini 제안 <span className="font-normal text-bone-faint">· 제안일 뿐입니다</span>
              </h3>
              <p className="text-[11px] text-bone-faint" data-testid="meme-suggestions-source">
                {analysisVideo ? `「${analysisVideo.title}」` : "목록에서 빠진 영상"} · {formatDateTime(workspace.analysis.analyzedAt)} 분석 · {workspace.analysis.model}
              </p>
              {workspace.analysis.suggestions.length === 0 ? (
                <p className="text-xs text-bone-dim" data-testid="meme-suggestions-none">이 영상에서 알아볼 만한 말·동작을 찾지 못했다는 결과입니다. 다른 영상을 분석하거나 직접 적어 주세요.</p>
              ) : (
                <ul className="space-y-1.5">
                  {workspace.analysis.suggestions.map((suggestion) => {
                    const imported = drafts.some((card) => card.suggestionId === suggestion.id);
                    const range = rangeLabel(suggestion.startSeconds, suggestion.endSeconds);
                    return (
                      <li key={suggestion.id} data-testid={`meme-suggestion-${suggestion.id}`} className="flex items-start gap-2 rounded border border-line px-3 py-2">
                        <span className="rounded border border-line px-1.5 py-0.5 text-[11px] text-bone-dim">{MEME_OBSERVATION_KIND_LABELS[suggestion.kind]}</span>
                        {range && <span className="pt-0.5 text-[11px] tabular-nums text-bone-faint">{range}</span>}
                        <span className="min-w-0 flex-1 text-sm text-bone">{suggestion.text}</span>
                        <button
                          type="button"
                          data-testid={`meme-suggestion-import-${suggestion.id}`}
                          className={smallOutlineButton}
                          onClick={() => importSuggestion(suggestion)}
                          disabled={imported || atCardLimit}
                        >
                          {imported ? "가져옴" : "카드로 가져오기"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* ── 내 카드: 편집 ── */}
          <div className="space-y-3" data-testid="meme-cards">
            <h3 className="text-sm font-medium text-bone">
              내 카드 <span className="font-normal tabular-nums text-bone-faint">{drafts.length} / {MEME_OBSERVATION_LIMITS.cardsMax}</span>
            </h3>
            {unsaved && (
              <p role="status" data-testid="meme-cards-unsaved" className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-300">
                저장하지 않은 카드 변경이 있습니다. 「카드 저장」을 누르지 않고 다른 후보로 가면 사라집니다.
              </p>
            )}
            {drafts.length === 0 && (
              <p className="text-xs text-bone-dim" data-testid="meme-cards-empty">아직 카드가 없습니다. 제안을 가져오거나 직접 추가하세요.</p>
            )}
            <ol className="space-y-3">
              {drafts.map((card, index) => {
                const suggestion = card.suggestionId ? suggestionsById.get(card.suggestionId) : undefined;
                const edited = card.origin === "suggestion" && editedFromSuggestion(card, suggestion);
                const problem = problems[index];
                const fieldId = `meme-card-${card.key}`;
                return (
                  <li key={card.key} data-testid={`meme-card-${index}`} className="space-y-2 rounded border border-line p-3">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-bone-faint">
                      <span data-testid={`meme-card-origin-${index}`}>
                        {card.origin === "suggestion" ? "Gemini 제안에서 가져옴" : "직접 적음"}
                        {edited ? " · 고침" : ""}
                      </span>
                      <button type="button" className={`${smallOutlineButton} ml-auto`} onClick={() => remove(card.key)} data-testid={`meme-card-remove-${index}`}>
                        카드 빼기
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <label className="space-y-1">
                        <span className="block text-[11px] text-bone-dim">종류</span>
                        <select
                          value={card.kind}
                          onChange={(event) => update(card.key, { kind: event.target.value as MemeObservationKind })}
                          className="rounded border border-line bg-slate-900/70 px-2 py-1 text-sm text-bone"
                          data-testid={`meme-card-kind-${index}`}
                        >
                          {MEME_OBSERVATION_KINDS.map((kind) => <option key={kind} value={kind}>{MEME_OBSERVATION_KIND_LABELS[kind]}</option>)}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[11px] text-bone-dim">시작(초)</span>
                        <input inputMode="decimal" value={card.start} onChange={(event) => update(card.key, { start: event.target.value })} className="w-20 rounded border border-line bg-slate-900/70 px-2 py-1 text-sm tabular-nums text-bone" data-testid={`meme-card-start-${index}`} />
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[11px] text-bone-dim">끝(초)</span>
                        <input inputMode="decimal" value={card.end} onChange={(event) => update(card.key, { end: event.target.value })} className="w-20 rounded border border-line bg-slate-900/70 px-2 py-1 text-sm tabular-nums text-bone" data-testid={`meme-card-end-${index}`} />
                      </label>
                    </div>
                    <label className="block space-y-1" htmlFor={fieldId}>
                      <span className="block text-[11px] text-bone-dim">무엇을 하나요 (말·동작·타이밍)</span>
                      <textarea
                        id={fieldId}
                        rows={2}
                        value={card.text}
                        maxLength={MEME_OBSERVATION_LIMITS.textMax + 20}
                        onChange={(event) => update(card.key, { text: event.target.value })}
                        aria-invalid={problem !== null}
                        aria-describedby={problem ? `${fieldId}-problem` : undefined}
                        className="w-full rounded border border-line bg-slate-900/70 px-2.5 py-1.5 text-sm text-bone"
                        data-testid={`meme-card-text-${index}`}
                      />
                    </label>
                    {problem && <p id={`${fieldId}-problem`} className="text-xs text-rose-400" data-testid={`meme-card-problem-${index}`}>{problem}</p>}
                  </li>
                );
              })}
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" data-testid="meme-cards-add" className={outlineButton} onClick={addManual} disabled={atCardLimit}>직접 카드 추가</button>
              <button type="button" data-testid="meme-cards-save" className={`${primaryButton} ml-auto`} onClick={() => void save()} disabled={!canSave}>
                {saving ? "저장 중…" : "카드 저장"}
              </button>
            </div>
            {savedNotice && !unsaved && (
              <p role="status" data-testid="meme-cards-saved" className="text-xs text-emerald-300">
                카드를 저장했습니다{workspace.cardsSavedAt ? ` (${formatDateTime(workspace.cardsSavedAt)})` : ""}.
              </p>
            )}
            {saveError && (
              <div role="alert" data-testid="meme-cards-save-error" data-error-code={saveError.code} className="space-y-2 rounded-lg border border-rose-400/30 bg-rose-500/15 p-3">
                <p className="text-sm text-rose-400">{saveError.message}</p>
                {saveError.code === "MEME_CARDS_CONFLICT" && (
                  <button type="button" data-testid="meme-cards-reload" className={smallOutlineButton} onClick={() => { setSaveError(null); void load(true); }}>
                    다시 읽기 (입력 유지)
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="border-t border-line pt-4">
            {workspace.cards.length === 0 ? (
              <p className="text-xs text-bone-dim">관찰 카드를 하나 이상 저장하면 새 캐릭터의 장면 계획을 만들 수 있습니다.</p>
            ) : (
              <button type="button" className={outlineButton} disabled={unsaved || saving} onClick={() => setShowRemixDraft(true)} data-testid="meme-remix-open">
                이 카드로 애니메이션 초안 만들기
              </button>
            )}
            {unsaved && workspace.cards.length > 0 && <p className="mt-1 text-xs text-amber-300">먼저 바뀐 카드를 저장해 주세요.</p>}
            {showRemixDraft && workspace.cards.length > 0 && !unsaved && (
              <MemeRemixDraftPanel key={workspace.cardsSavedAt ?? "unsaved"} trend={trend} cards={workspace.cards} onCreated={onProjectCreated} />
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** 공개 조회수가 가장 큰 영상, 없으면 첫 영상. */
function defaultVideoId(trend: MemeTrend): string {
  let best = trend.videos[0]!;
  for (const video of trend.videos) {
    if (video.viewCount !== null && (best.viewCount === null || video.viewCount > best.viewCount)) best = video;
  }
  return best.videoId;
}
