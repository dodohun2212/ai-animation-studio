import { useEffect, useRef, useState } from "react";
import {
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  NOVEL_ANALYSIS_MAX_EPISODES,
  NOVEL_ANALYSIS_MIN_EPISODES,
  NOVEL_DIRECT_SOURCE_MAX_CHARS,
  NOVEL_SOURCE_MAX_CHARS,
  type Asset,
  type LongProject,
  type LongProjectSettingsInput,
  type NovelStoryAnalysisInput,
  type NovelStorySourceCitation,
} from "@ai-animation-studio/shared";

import { assetContentUrl, listAssets } from "../api/assetsApi.js";
import { createLongProject, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { NovelSourcePicker, contributorsLabel, type PickedNovelSource } from "./NovelSourcePicker.js";
import { Spinner } from "./Spinner.js";
import { StoryAnalysisPanel } from "./StoryAnalysisPanel.js";
import { ScreenHeader } from "./ui/ScreenHeader.js";
import { outlineButton, primaryButton, smallOutlineButton } from "./ui/surfaces.js";

interface Props {
  /** 「분석 없이 바로 만들기」(M0)로 만든 프로젝트 — 회차 개요가 아직 비어 있어 「회차 나누기(AI)」로 이어집니다. */
  onCreated: (project: LongProject) => void;
  /** AI 분석 결과를 확정해 만든 프로젝트(M2) — 회차 개요가 이미 채워져 있어 프로젝트 화면으로 이어집니다. */
  onProjectFromAnalysis: (project: LongProject) => void;
  /** 새 작품 만들기(시작 방법 고르기)로 돌아갑니다. */
  onBack: () => void;
  /** 소설 없이 「직접 설정」으로 시작하는 화면으로 바꿉니다. */
  onStartDirect: () => void;
  /** 키·예산이 막을 때 갈 곳 — OpenAI 키와 월 한도는 API 설정에 있습니다. */
  onOpenSettings: () => void;
}

/** 붙여넣을 수 있는 글자 수 — 단기 초안 칸의 한도(6,000자)와 같은 선입니다. 더 긴 글은 줄여서 붙입니다. */
/** 「분석 없이 만들기」(M0)의 한도 — 원문을 프로젝트 개요에 그대로 저장하므로 짧게 둡니다. AI 분석(M1)은 `NOVEL_SOURCE_MAX_CHARS`(긴 글은 조각으로 나눠 분석). */
export const STORY_TEXT_LIMIT = NOVEL_DIRECT_SOURCE_MAX_CHARS;
/**
 * 회차 수·장면 수의 처음 값. M0 에서는 화면에서 뺐지만, AI 분석(M1)이 **회차 구성의 개수**를 입력으로 받아서 다시 칸이 생겼습니다.
 * 분석 없이 바로 만드는 길에서도 같은 값을 씁니다. 만든 뒤 바꾸려면 **장기 프로젝트 설정**에서 고칩니다(「회차 나누기(AI)」 화면은 보여 줄 뿐 조절 UI가 없습니다 — CLI 1310).
 */
export const STORY_DEFAULTS = { episodeCount: 3, sceneCount: 6 } as const;

const inputClass = "mt-1 w-full rounded border border-line bg-slate-900/70 px-3 py-2 text-sm text-bone placeholder:text-bone-faint/60 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30";

interface CharacterDraft {
  key: number;
  name: string;
  description: string;
  /** 보관함에서 같은 인물로 쓸 캐릭터 — 고르지 않아도 됩니다. */
  assetId: string;
}

let characterSequence = 0;

export { autoStoryProjectId } from "../utils/storyProjectId.js";
import { autoStoryProjectId } from "../utils/storyProjectId.js";

/** 가져온 작품의 한 줄 요약 — 출처 메모 칸과 메모의 권리 줄에 씁니다. */
export function citationSummary(citation: NovelStorySourceCitation): string {
  const range = citation.chapterRange ? ` · ${citation.chapterRange.firstChapter}–${citation.chapterRange.lastChapter}장` : "";
  return `${citation.title} — ${contributorsLabel(citation.authors)} · Project Gutenberg #${citation.sourceId}${range}`;
}

/** 장기 프로젝트의 「메모」에 들어가는 글 — 재창작 지시, 출처, 등장인물. 대본 AI가 읽는 자리입니다. */
export function buildStoryNotes(source: string, characters: { name: string; description: string; assetName: string | null }[], rightsConfirmed = false, citation: NovelStorySourceCitation | null = null): string {
  const lines = [
    "【재창작 지시】 붙여넣은 이야기는 줄거리와 분위기의 재료일 뿐입니다. 원문의 문장·대사를 그대로 옮기지 말고, 인물 이름·사건 표현·대사를 새로 바꿔 쓰십시오. 실존 인물·실제 지명·개인정보는 지어낸 것으로 바꾸십시오.",
    "【영상화 지시】 속마음·설명 위주의 부분은 화면에 보이는 행동과 사건으로 바꾸고, 각 회차는 처음 몇 초 안에 궁금증을 만드는 장면으로 시작하십시오.",
  ];
  const trimmedSource = source.trim();
  if (trimmedSource) lines.push(`【출처 메모】 ${trimmedSource}`);
  if (rightsConfirmed && citation) lines.push(`【권리 확인】 사용자가 저작권 보호기간이 끝난 작품으로 쓰겠다고 확인했습니다(${citationSummary(citation)} · 근거: ${citation.rightsEvidence}). 원문을 그대로 옮기지 마십시오.`);
  else if (rightsConfirmed) lines.push("【권리 확인】 사용자가 이 글을 직접 썼거나 이용 허락을 받았다고 확인했습니다. 원문·개인정보를 그대로 공개하지 마십시오.");
  const named = characters.filter((character) => character.name.trim());
  if (named.length > 0) {
    lines.push("【등장인물】");
    for (const character of named) {
      const detail = character.description.trim();
      lines.push(`- ${character.name.trim()}${detail ? `: ${detail}` : ""}${character.assetName ? ` (이미지 보관함 캐릭터: ${character.assetName})` : ""}`);
    }
  }
  return lines.join("\n");
}

/**
 * 이야기 만들기 — 소설·이야기를 붙여넣어 **장기 프로젝트(회차)** 로 풀어 가는 첫 틀.
 *
 * 🔴 **지금 되는 것과 아직 안 되는 것을 갈라서 말합니다.** 되는 것: 글 붙여넣기 → 인물을 적고(보관함 캐릭터와 짝지을 수 있음)
 * → 장기 프로젝트 만들기(기존 API). 이후 회차 개요·대본은 장기 프로젝트의 기존 흐름이고, 유료 요청은 거기서 승인해야 나갑니다.
 * 아직 안 되는 것(Reddit 주소로 가져오기·긴 글 자동 요약)은 **버튼으로 그리지 않고**
 * 글로만 알립니다 — 눌러도 아무 일도 없는 버튼은 약속이 아니라 거짓말이기 때문입니다.
 * 이 화면은 OpenAI·Runway 를 부르지 않습니다.
 */
export function StoryStudioScreen({ onCreated, onProjectFromAnalysis, onBack, onStartDirect, onOpenSettings }: Props) {
  const [title, setTitle] = useState("");
  const [logline, setLogline] = useState("");
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [episodeCount, setEpisodeCount] = useState<number>(STORY_DEFAULTS.episodeCount);
  const [sceneCount, setSceneCount] = useState<number>(STORY_DEFAULTS.sceneCount);
  /** 본인이 쓴 글이거나 이용 허락을 받은 글이라는 확인 — 없으면 만들 수 없습니다(Reddit 조건 조사, CLI 1305). */
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  /** 「작품 고르기」로 가져온 작품의 출처 기록(원문 없음) — 분석 입력의 `source` 로 갑니다. */
  const [citation, setCitation] = useState<NovelStorySourceCitation | null>(null);
  /** 가져온 그대로의 본문 — 가져온 뒤 고쳤는지 말하는 데만 씁니다. */
  const [importedText, setImportedText] = useState<string | null>(null);
  const [characters, setCharacters] = useState<CharacterDraft[]>([]);
  const [library, setLibrary] = useState<Asset[] | null>(null);
  const [libraryFailed, setLibraryFailed] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    listAssets({ assetType: "character" })
      .then((response) => { if (!cancelled) setLibrary(response.assets.filter((asset) => asset.enabled && (asset.isFolder || asset.parentFolderId === ""))); })
      .catch(() => { if (!cancelled) { setLibraryFailed(true); setLibrary([]); } });
    return () => { cancelled = true; };
  }, []);

  const overLimit = text.length > STORY_TEXT_LIMIT;
  const overAnalysisLimit = text.length > NOVEL_SOURCE_MAX_CHARS;
  const episodesValid = Number.isInteger(episodeCount) && episodeCount >= NOVEL_ANALYSIS_MIN_EPISODES && episodeCount <= NOVEL_ANALYSIS_MAX_EPISODES;
  /** AI 분석 입력 — 조건을 모두 채웠을 때만 만들어지고(아니면 null), 비어 있는 출처 메모는 보내지 않습니다. */
  const analysisInput: NovelStoryAnalysisInput | null =
    title.trim() && logline.trim() && text.trim() && text.length <= NOVEL_SOURCE_MAX_CHARS && rightsConfirmed && episodesValid
      ? {
          sourceText: text.trim(),
          title: title.trim(),
          logline: logline.trim(),
          ...(source.trim() ? { sourceNote: source.trim() } : {}),
          ...(citation ? { source: citation } : {}),
          rightsConfirmed: true,
          episodeCount,
          sceneCount,
        }
      : null;

  /** 고른 본문을 칸에 넣습니다. 권리 확인은 근거가 바뀌었으니 다시 받습니다. 제목·출처 메모는 비어 있을 때만 채웁니다. */
  function usePicked(picked: PickedNovelSource): void {
    setText(picked.text);
    setImportedText(picked.text);
    setCitation(picked.citation);
    setRightsConfirmed(false);
    if (!title.trim()) setTitle(picked.citation.title.slice(0, 100));
    if (!source.trim()) setSource(citationSummary(picked.citation).slice(0, 300));
    setError("");
  }

  function addCharacter(): void {
    setCharacters((old) => [...old, { key: ++characterSequence, name: "", description: "", assetId: "" }]);
  }
  function updateCharacter(key: number, patch: Partial<CharacterDraft>): void {
    setCharacters((old) => old.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }
  function removeCharacter(key: number): void {
    setCharacters((old) => old.filter((item) => item.key !== key));
  }

  /** 「분석 없이 만들기」 버튼을 **직접 눌렀을 때만** 호출됩니다 — 입력칸의 Enter 로는 만들어지지 않습니다(CLI 1326). */
  async function submit(): Promise<void> {
    if (busy.current) return;
    const trimmedTitle = title.trim();
    const trimmedLogline = logline.trim();
    if (!trimmedTitle) { setError("제목을 입력하세요."); return; }
    if (!trimmedLogline) { setError("한 줄 줄거리를 입력하세요."); return; }
    if (!text.trim()) { setError("이야기 본문을 붙여넣어 주세요."); return; }
    if (overLimit) { setError(`본문이 ${STORY_TEXT_LIMIT.toLocaleString("ko-KR")}자를 넘어 분석 없이 만들 수 없습니다. 위 2번 AI 분석으로 진행하거나, 줄여서 붙여 주세요.`); return; }
    if (!rightsConfirmed) { setError("붙여넣은 글이 직접 쓴 글이거나 이용 허락을 받은 글인지 확인해 주세요."); return; }
    if (!episodesValid) { setError(`회차 수는 ${NOVEL_ANALYSIS_MIN_EPISODES}–${NOVEL_ANALYSIS_MAX_EPISODES} 사이의 정수입니다.`); return; }

    const assetsById = new Map((library ?? []).map((asset) => [asset.assetId, asset]));
    const settings: LongProjectSettingsInput = {
      title: trimmedTitle,
      logline: trimmedLogline,
      overview: text.trim(),
      genre: "",
      tone: "",
      theme: "",
      episodeCount,
      sceneCount,
      clipDurationSeconds: 5,
      aspectRatio: "9:16",
      audience: "",
      notes: buildStoryNotes(source, characters.map((character) => ({ name: character.name, description: character.description, assetName: assetsById.get(character.assetId)?.displayName ?? null })), rightsConfirmed, citation),
      startingState: "",
      midpoint: "",
      endingDirection: "",
      storyFlowSummary: "",
      narrationEnabled: false,
      subtitlesEnabled: false,
    };

    busy.current = true;
    setSubmitting(true);
    setError("");
    try {
      const response = await createLongProject({ projectId: autoStoryProjectId(trimmedTitle, new Date()), settings });
      onCreated(response.project);
    } catch (caught) {
      setError(toLongProjectDisplayError(caught).message);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-6">
      <ScreenHeader
        title="이야기 만들기 — 소설에서 시작"
        eyebrow="장기 프로젝트 · 새 작품"
        description="소설이나 이야기를 붙여넣어 장기 프로젝트(회차로 이어지는 작품)를 시작합니다. 아래 2번 AI 분석으로 줄거리·인물·회차를 정리한 뒤 확정하거나, 분석 없이 4번으로 바로 만들 수 있습니다. 어느 쪽이든 만들어진 것은 같은 장기 프로젝트입니다."
        backLabel="새 작품 만들기로"
        onBack={onBack}
        actions={<button type="button" data-testid="story-start-direct" className={smallOutlineButton} onClick={onStartDirect}>소설 없이 직접 설정으로 시작</button>}
        className="mt-8"
      />

      {/* 🔴 Enter 로는 아무것도 만들어지지 않습니다 — 이 form 에는 submit 버튼이 없고, 유료 분석도 분석 없이 만들기도 각자의 버튼을 눌러야 합니다. */}
      <form data-testid="story-studio-form" onSubmit={(event) => event.preventDefault()} className="space-y-6" noValidate>
        {/* ── 작품 고르기 (선택) — 저작권이 끝난 소설을 찾아 아래 본문 칸에 넣습니다. 직접 붙여넣는 길은 그대로입니다. ── */}
        <NovelSourcePicker onPick={usePicked} hasText={text.trim().length > 0} disabled={submitting} />

        {/* ── 1. 이야기 ── */}
        <div className="space-y-3 rounded-lg border border-line bg-ground-raised p-5">
          <h2 className="text-base font-semibold text-bone">1. 이야기</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs text-bone-dim">제목
              <input data-testid="story-title" className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} disabled={submitting} maxLength={100} />
            </label>
            <label className="text-xs text-bone-dim">한 줄 줄거리
              <input data-testid="story-logline" className={inputClass} value={logline} onChange={(event) => setLogline(event.target.value)} disabled={submitting} maxLength={300} placeholder="예: 평범한 직장인이 매일 같은 꿈에서 낯선 문을 발견한다" />
            </label>
          </div>
          <label className="block text-xs text-bone-dim">이야기 본문
            <textarea
              data-testid="story-text"
              className={`${inputClass} min-h-48 leading-relaxed`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={submitting}
              placeholder="소설이나 이야기를 여기에 붙여넣으세요."
              aria-invalid={overAnalysisLimit}
            />
          </label>
          <p data-testid="story-text-count" className={`text-xs tabular-nums ${overAnalysisLimit ? "text-rose-400" : overLimit ? "text-amber-300" : "text-bone-faint"}`}>
            {text.length.toLocaleString("ko-KR")}자 · AI 분석은 {NOVEL_SOURCE_MAX_CHARS.toLocaleString("ko-KR")}자까지(긴 글은 나눠서 분석), 분석 없이 만들기는 {STORY_TEXT_LIMIT.toLocaleString("ko-KR")}자까지
            {overAnalysisLimit ? " — 너무 깁니다. 줄여서 붙여 주세요." : overLimit ? ` — ${STORY_TEXT_LIMIT.toLocaleString("ko-KR")}자를 넘어 「분석 없이 만들기」는 쓸 수 없고 AI 분석으로만 진행할 수 있습니다.` : ""}
          </p>
          <label className="block text-xs text-bone-dim">출처 메모 (선택)
            <input data-testid="story-source" className={inputClass} value={source} onChange={(event) => setSource(event.target.value)} disabled={submitting} maxLength={300} placeholder="예: Reddit 글 주소, 작가 이름" />
          </label>
          {citation && (
            <div data-testid="story-imported-source" className="space-y-1 rounded border border-line p-3 text-xs text-bone-dim">
              <p>
                가져온 작품: <span className="text-bone">「{citation.title}」</span> — {contributorsLabel(citation.authors)}
                {citation.translators.length > 0 ? ` · 번역 ${contributorsLabel(citation.translators)}` : ""}
                {citation.chapterRange ? ` · ${citation.chapterRange.firstChapter}–${citation.chapterRange.lastChapter}장` : ""}
                {` · ${citation.selectedCharacterCount.toLocaleString("ko-KR")}자 / 전체 ${citation.fullSourceCharacterCount.toLocaleString("ko-KR")}자`}
              </p>
              <p className="text-bone-faint">
                권리 근거: {citation.rightsEvidence} · <a href={citation.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-bone">원본 페이지</a>
              </p>
              {importedText !== null && text !== importedText && (
                <p data-testid="story-imported-edited" className="text-bone-faint">가져온 뒤 본문을 고쳤습니다 — 출처 기록은 그대로 함께 보냅니다.</p>
              )}
              <button type="button" data-testid="story-imported-clear" className={smallOutlineButton} onClick={() => { setCitation(null); setImportedText(null); setRightsConfirmed(false); }} disabled={submitting}>
                가져온 작품 기록 지우기
              </button>
            </div>
          )}
          <label className="flex items-start gap-2 rounded border border-line p-3 text-xs text-bone">
            <input type="checkbox" data-testid="story-rights" className="mt-0.5" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} disabled={submitting} />
            {citation ? (
              <span>
                이 작품을 <strong>저작권 보호기간이 끝난 작품</strong>으로 쓰겠습니다(근거는 위).
                <span className="mt-0.5 block text-bone-faint">앱의 거르기는 저자·번역자의 사망 연도로 본 보수적인 필터일 뿐 법적 보증이 아니며, 판본·번역의 권리까지 확인해 주지는 않습니다. 확인 책임은 사용자에게 있습니다.</span>
              </span>
            ) : (
              <span>
                이 글은 <strong>제가 직접 쓴 글이거나 작성자의 이용 허락을 받은 글</strong>입니다.
                <span className="mt-0.5 block text-bone-faint">남의 글을 직접 붙여넣어도 작성자의 권리는 사라지지 않습니다. 이 앱은 메모에 재창작 지시를 넣지만 원문이 그대로 쓰이지 않는다고 보장하지는 않으며, 권리 확인을 대신하지 않습니다.</span>
              </span>
            )}
          </label>
        </div>

        {/* 회차 수·장면 수 — AI 분석이 이 개수로 회차 구성을 만듭니다. */}
        <div className="-mt-3 flex flex-wrap gap-4 rounded-lg border border-line bg-ground-raised px-5 pb-5">
          <label className="text-xs text-bone-dim">회차 수 ({NOVEL_ANALYSIS_MIN_EPISODES}–{NOVEL_ANALYSIS_MAX_EPISODES})
            <input data-testid="story-episodes" className={`${inputClass} w-24`} type="number" min={NOVEL_ANALYSIS_MIN_EPISODES} max={NOVEL_ANALYSIS_MAX_EPISODES} value={episodeCount} onChange={(event) => setEpisodeCount(Number(event.target.value))} disabled={submitting} />
          </label>
          <label className="text-xs text-bone-dim">회차당 장면 수 ({MIN_SCENE_COUNT}–{MAX_SCENE_COUNT})
            <input data-testid="story-scenes" className={`${inputClass} w-24`} type="number" min={MIN_SCENE_COUNT} max={MAX_SCENE_COUNT} value={sceneCount} onChange={(event) => setSceneCount(Math.min(MAX_SCENE_COUNT, Math.max(MIN_SCENE_COUNT, Number(event.target.value) || MIN_SCENE_COUNT)))} disabled={submitting} />
          </label>
        </div>

        {/* ── 2. AI 분석 (M1) ── */}
        <div className="space-y-3 rounded-lg border border-line bg-ground-raised p-5">
          <h2 className="text-base font-semibold text-bone">2. AI로 먼저 분석해 보기 (유료·선택)</h2>
          <StoryAnalysisPanel input={analysisInput} onOpenSettings={onOpenSettings} onProjectCreated={onProjectFromAnalysis} />
        </div>

        {/* ── 3. 등장인물 — 선택, **분석 없이** 만들 때만. AI 분석(2번)을 거치면 인물은 그 결과 화면에서 정리·수정하고 이미지까지 만듭니다. ── */}
        <div className="space-y-3 rounded-lg border border-line bg-ground-raised p-5">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-bone">3. 등장인물 (선택 · 분석 없이 만들 때)</h2>
            <button type="button" data-testid="story-add-character" className={`${smallOutlineButton} ml-auto`} onClick={addCharacter} disabled={submitting}>인물 직접 적기</button>
          </div>
          <p className="text-xs text-bone-dim">
            2번 AI 분석을 쓰면 인물이 자동으로 정리되고, 결과 화면에서 고치고 캐릭터 이미지까지 만들 수 있습니다. 이 칸은 분석 없이 4번으로 만들 때만 씁니다 — 직접 적어 두면 대본 AI가 회차마다 같은 인물로 읽고, 이미지 보관함의 캐릭터와 짝지을 수 있습니다.
          </p>
          {characters.length === 0 && <p data-testid="story-characters-empty" className="text-xs text-bone-faint">아직 적은 인물이 없습니다. 건너뛰어도 됩니다.</p>}
          {libraryFailed && <p role="status" className="text-xs text-amber-300">보관함 캐릭터 목록을 불러오지 못했습니다. 짝짓기 없이 적을 수 있습니다.</p>}
          <ul className="space-y-3">
            {characters.map((character, index) => (
              <li key={character.key} data-testid={`story-character-${index}`} className="space-y-2 rounded border border-line p-3">
                <div className="grid gap-2 md:grid-cols-[1fr_2fr]">
                  <label className="text-[11px] text-bone-dim">이름
                    <input data-testid={`story-character-name-${index}`} className={inputClass} value={character.name} onChange={(event) => updateCharacter(character.key, { name: event.target.value })} disabled={submitting} maxLength={60} />
                  </label>
                  <label className="text-[11px] text-bone-dim">어떤 인물인가요 (외모·성격·역할)
                    <input data-testid={`story-character-desc-${index}`} className={inputClass} value={character.description} onChange={(event) => updateCharacter(character.key, { description: event.target.value })} disabled={submitting} maxLength={200} />
                  </label>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="min-w-0 flex-1 text-[11px] text-bone-dim">이미지 보관함의 같은 캐릭터 (선택)
                    {library === null
                      ? <span className="mt-1 block"><Spinner label="불러오는 중..." /></span>
                      : (
                        <select data-testid={`story-character-asset-${index}`} className={inputClass} value={character.assetId} onChange={(event) => updateCharacter(character.key, { assetId: event.target.value })} disabled={submitting}>
                          <option value="">고르지 않음 (아직 이미지 없음)</option>
                          {library.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.displayName}</option>)}
                        </select>
                      )}
                  </label>
                  {character.assetId && (
                    <img src={assetContentUrl((library ?? []).find((asset) => asset.assetId === character.assetId)?.thumbnailAssetId || character.assetId)} alt="" className="h-12 w-12 rounded object-cover" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
                  )}
                  <button type="button" className={smallOutlineButton} onClick={() => removeCharacter(character.key)} disabled={submitting} data-testid={`story-character-remove-${index}`}>인물 빼기</button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* ── 3. 만들기 ── */}
        <div className="space-y-3 rounded-lg border border-line bg-ground-raised p-5">
          <h2 className="text-base font-semibold text-bone">4. 분석 없이 바로 장기 프로젝트로 만들기</h2>
          <p data-testid="story-m0-notice" className="border-l-2 border-amber-400/40 pl-3 text-xs leading-relaxed text-slate-400">
            분석 없이 만들면 붙여넣은 글은 프로젝트 개요에 <strong className="font-medium text-bone-dim">그대로 저장</strong>되고, 회차를 나누는 AI가 그 글을 읽습니다. 이 단계에서는 AI 분석을 하지 않습니다.
            메모에 재창작 지시를 넣지만 원문이 그대로 쓰이지 않게 구조적으로 막지는 못합니다. 원문 대신 AI가 정리한 구조만 쓰려면 위 2번 AI 분석을 거치세요.
          </p>
          <p className="text-xs text-bone-dim">
            장기 프로젝트가 만들어지고 바로 그 작품의 「회차 나누기(AI)」 화면으로 이어지며, 거기서 돌아가면 만들어진 작품 화면입니다. 회차 수·장면 수는 기본값(3회차·6장면)으로 시작하며, 바꾸려면 장기 프로젝트 설정에서 고칩니다. 그다음 대본 → 그림 → 영상은 장기 프로젝트의 기존 흐름이고, 유료 요청은 승인해야만 나갑니다. 이 단계는 AI를 부르지 않습니다.
          </p>
          {error && <p role="alert" data-testid="story-error" className="text-sm text-rose-400">{error}</p>}
          <button type="button" data-testid="story-submit" className={primaryButton} onClick={() => void submit()} disabled={submitting || overLimit}>{submitting ? "만드는 중…" : "분석 없이 장기 프로젝트로 만들기"}</button>
        </div>
      </form>

      {/* 아직 안 되는 것 — 버튼이 아니라 글로만. 누르면 아무 일도 없는 버튼을 먼저 그려 두지 않습니다. */}
      <section aria-label="아직 안 되는 것" data-testid="story-not-yet" className="space-y-1.5 rounded-lg border border-dashed border-line p-5">
        <h2 className="text-sm font-medium text-bone-dim">아직 안 되는 것 (준비 중)</h2>
        <ul className="list-inside list-disc space-y-1 text-xs text-bone-faint">
          <li>Reddit 주소만 넣어 글 가져오기, 웹소설 플랫폼에서 가져오기 — 사전 승인과 이용 조건·저작권 때문에 만들지 않습니다. 직접 쓴 글이나 허락받은 글을 붙여넣거나, 위 「작품 고르기」에서 저작권이 끝난 작품을 고르세요.</li>
          <li>한국어 저작권 만료 작품(공유마당) 가져오기 — 제공처의 원문 이용 조건을 확인하기 전이라 아직 없습니다.</li>
          <li>{NOVEL_SOURCE_MAX_CHARS.toLocaleString("ko-KR")}자보다 긴 글을 한 번에 — 지금은 그 길이까지 나눠서 분석합니다. 「작품 고르기」로 가져온 장편은 장 범위를 골라 1부·2부처럼 나눠 만들고, 직접 붙여넣는 글은 앞부분만 붙이거나 나눠 주세요.</li>
        </ul>
      </section>
    </section>
  );
}
