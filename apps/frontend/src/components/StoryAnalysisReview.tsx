import { useEffect, useRef, useState } from "react";
import type {
  ApproveNovelStoryAnalysisResponse,
  Asset,
  CreateNovelStoryProjectRequest,
  LongProject,
  LongProjectSettingsInput,
} from "@ai-animation-studio/shared";

import { assetContentUrl, listAssets } from "../api/assetsApi.js";
import { createNovelStoryProject, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { autoStoryProjectId } from "../utils/storyProjectId.js";
import { CharacterImageControl } from "./CharacterImageControl.js";
import { primaryButton, smallOutlineButton } from "./ui/surfaces.js";

interface Props {
  response: ApproveNovelStoryAnalysisResponse;
  /** 분석을 만든 뒤 입력 칸이 바뀐 경우 — 이 결과로는 프로젝트를 만들 수 없습니다. */
  stale: boolean;
  onCreated: (project: LongProject) => void;
  /** 키·예산이 막을 때 갈 곳 — OpenAI 키와 월 한도는 API 설정에 있습니다. */
  onOpenSettings: () => void;
}

/** 서버가 받는 한도(`long-projects.service.ts` 의 `novelStoryProjectInput`) — 칸의 maxLength 로 넘치지 않게 합니다. */
export const REVIEW_LIMITS = {
  title: 120, logline: 800, genre: 100, tone: 300, theme: 500,
  characterName: 80, appearance: 500, personality: 500, characters: 40,
  episodeTitle: 120, summary: 1200, mainEvent: 600, conflict: 600, cliffhanger: 500, nextEpisodeHook: 500,
  episodesMin: 1, episodesMax: 20,
} as const;

interface CharacterDraft { key: string; id: string; name: string; role: "protagonist" | "supporting"; appearance: string; personality: string }
interface EpisodeDraft { key: string; title: string; summary: string; mainEvent: string; conflict: string; cliffhanger: string; nextEpisodeHook: string }

const inputClass = "mt-1 w-full rounded border border-line bg-slate-900/70 px-2.5 py-1.5 text-sm text-bone placeholder:text-bone-faint/60 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30";

/** 주인공은 **정확히 한 명** — AI가 0명이나 여러 명으로 돌려줘도 첫 주인공 하나만 남기고(없으면 첫 인물), 나머지는 조연으로 둡니다. */
export function normalizeProtagonist<T extends { role: "protagonist" | "supporting" }>(characters: T[]): T[] {
  const first = Math.max(0, characters.findIndex((character) => character.role === "protagonist"));
  return characters.map((character, index) => ({ ...character, role: index === first ? "protagonist" as const : "supporting" as const }));
}

function Field({ label, value, onChange, max, testId, multiline = false, disabled }: {
  label: string; value: string; onChange: (value: string) => void; max: number; testId: string; multiline?: boolean; disabled: boolean;
}) {
  const empty = value.trim().length === 0;
  return (
    <label className="block text-[11px] text-bone-dim">
      {label}
      {multiline
        ? <textarea data-testid={testId} className={inputClass} rows={2} value={value} maxLength={max} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-invalid={empty} />
        : <input data-testid={testId} className={inputClass} value={value} maxLength={max} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-invalid={empty} />}
      {empty && <span data-testid={`${testId}-empty`} className="mt-0.5 block text-bone-faint">비워 둘 수 없습니다.</span>}
    </label>
  );
}

/**
 * AI 분석 결과 **확인·수정 화면**(M2) — 줄거리·인물·회차를 사람이 고치고, 확정하면 장기 프로젝트가 한 번에 만들어집니다.
 *
 * 🔴 확정은 저장 요청 하나뿐입니다 — 미리보기·OpenAI·이미지·영상 요청을 보내지 않습니다(돈이 나가지 않습니다). 본문은 이 화면에도 서버에도
 * 없고, 서버로 가는 것은 사람이 고친 구조와 M1 출처 메타데이터(원문 없는 해시·모델·시각)입니다.
 * 🟠 분석은 **제안**이라 모든 칸을 고칠 수 있고, 서버 한도(칸마다 글자 수, 인물 1–40명, 회차 1–20회, 주인공 정확히 한 명)는 칸이 먼저 지킵니다.
 */
export function StoryAnalysisReview({ response, stale, onCreated, onOpenSettings }: Props) {
  const { analysis, source } = response;
  const sequence = useRef(0);
  const nextKey = () => `draft-${++sequence.current}`;

  const [title, setTitle] = useState(analysis.title);
  const [logline, setLogline] = useState(analysis.logline);
  const [genre, setGenre] = useState(analysis.genre);
  const [tone, setTone] = useState(analysis.tone);
  const [theme, setTheme] = useState(analysis.theme);
  const [characters, setCharacters] = useState<CharacterDraft[]>(() =>
    normalizeProtagonist(analysis.characters.map((character) => ({ key: character.id, id: character.id, name: character.name, role: character.role, appearance: character.appearance, personality: character.personality }))));
  const [episodes, setEpisodes] = useState<EpisodeDraft[]>(() =>
    analysis.episodes.map((episode, index) => ({ key: `ep-${index}`, title: episode.title, summary: episode.summary, mainEvent: episode.mainEvent, conflict: episode.conflict, cliffhanger: episode.cliffhanger, nextEpisodeHook: episode.nextEpisodeHook })));
  const [library, setLibrary] = useState<Asset[] | null>(null);
  const [libraryFailed, setLibraryFailed] = useState(false);
  const [assetId, setAssetId] = useState("");
  /** 방금 만든 그림을 주인공 이미지로 쓰기로 한 경우, 그 그림을 만든 인물 — 주인공이 바뀌면 이 연결은 풀립니다. */
  const [assetFromCharacterKey, setAssetFromCharacterKey] = useState<string | null>(null);
  /**
   * 조연마다 고른 보관함 캐릭터 폴더(M4) — 인물 카드 key → 폴더. `fromImage` 는 이 화면에서 만든 그림을 고른 경우라,
   * 그 인물의 설명이 바뀌면 바뀌기 전 설명의 그림이 되어 연결을 풉니다(주인공과 같은 규칙).
   */
  const [supportingLinks, setSupportingLinks] = useState<Record<string, { assetId: string; fromImage: boolean }>>({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const busy = useRef(false);

  /** 캐릭터 폴더 목록(켜진 것만). 인물 이미지를 만들어 보관함에 폴더가 생긴 뒤에도 다시 읽습니다. */
  async function loadLibrary(): Promise<void> {
    try {
      const result = await listAssets({ assetType: "character" });
      setLibrary(result.assets.filter((asset) => asset.isFolder && asset.enabled));
      setLibraryFailed(false);
    } catch {
      setLibraryFailed(true);
      setLibrary((old) => old ?? []);
    }
  }

  useEffect(() => {
    let cancelled = false;
    listAssets({ assetType: "character" })
      .then((result) => { if (!cancelled) setLibrary(result.assets.filter((asset) => asset.isFolder && asset.enabled)); })
      .catch(() => { if (!cancelled) { setLibraryFailed(true); setLibrary([]); } });
    return () => { cancelled = true; };
  }, []);

  const emptyCount =
    [title, logline, genre, tone, theme].filter((value) => value.trim().length === 0).length
    + characters.filter((character) => character.name.trim().length === 0).length
    + characters.filter((character) => character.appearance.trim().length === 0).length
    + characters.filter((character) => character.personality.trim().length === 0).length
    + episodes.reduce((sum, episode) => sum + [episode.title, episode.summary, episode.mainEvent, episode.conflict, episode.cliffhanger, episode.nextEpisodeHook].filter((value) => value.trim().length === 0).length, 0);
  /** 서버는 같은 폴더를 두 조연에 연결하지 못하게 합니다 — 화면이 먼저 말합니다. */
  const supportingPairs = characters
    .filter((character) => character.role === "supporting" && supportingLinks[character.key]?.assetId)
    .map((character) => ({ characterId: character.id, assetId: supportingLinks[character.key]!.assetId }));
  const duplicateSupportingFolder = new Set(supportingPairs.map((pair) => pair.assetId)).size !== supportingPairs.length;
  const canCreate = !creating && !stale && emptyCount === 0 && !duplicateSupportingFolder && characters.length >= 1 && episodes.length >= REVIEW_LIMITS.episodesMin;

  function updateCharacter(key: string, patch: Partial<CharacterDraft>): void {
    setCharacters((old) => old.map((character) => (character.key === key ? { ...character, ...patch } : character)));
    // 그 인물의 설명(이름·외모·성격)이 바뀌면, 바뀌기 전 설명으로 만들어 고른 주인공 이미지는 더 이상 그 설명의 그림이 아니라서 연결을 풉니다(CLI 1322).
    const describes = "name" in patch || "appearance" in patch || "personality" in patch;
    if (assetFromCharacterKey === key && describes) {
      setAssetId("");
      setAssetFromCharacterKey(null);
    }
    if (describes && supportingLinks[key]?.fromImage) setSupportingLink(key, null);
  }
  function setSupportingLink(key: string, link: { assetId: string; fromImage: boolean } | null): void {
    setSupportingLinks((old) => {
      const next = { ...old };
      if (link && link.assetId) next[key] = link; else delete next[key];
      return next;
    });
  }
  function chooseProtagonist(key: string): void {
    setCharacters((old) => old.map((character) => ({ ...character, role: character.key === key ? "protagonist" : "supporting" })));
    // 주인공이 된 인물의 조연 연결은 이제 맞지 않습니다(주인공 폴더는 따로 고릅니다).
    setSupportingLink(key, null);
    // 다른 인물의 그림으로 골라 둔 주인공 이미지는 새 주인공의 것이 아니므로 풉니다.
    if (assetFromCharacterKey !== null && assetFromCharacterKey !== key) {
      setAssetId("");
      setAssetFromCharacterKey(null);
    }
  }
  function addCharacter(): void {
    if (characters.length >= REVIEW_LIMITS.characters) return;
    const used = new Set(characters.map((character) => character.id));
    let n = characters.length + 1;
    while (used.has(`char-${n}`)) n += 1;
    const id = `char-${n}`;
    setCharacters((old) => [...old, { key: nextKey(), id, name: "", role: "supporting", appearance: "", personality: "" }]);
  }
  function removeCharacter(key: string): void {
    setCharacters((old) => old.filter((character) => character.key !== key));
    setSupportingLink(key, null);
  }

  function updateEpisode(key: string, patch: Partial<EpisodeDraft>): void {
    setEpisodes((old) => old.map((episode) => (episode.key === key ? { ...episode, ...patch } : episode)));
  }
  function moveEpisode(index: number, delta: -1 | 1): void {
    setEpisodes((old) => {
      const target = index + delta;
      if (target < 0 || target >= old.length) return old;
      const next = [...old];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }
  function addEpisode(): void {
    if (episodes.length >= REVIEW_LIMITS.episodesMax) return;
    setEpisodes((old) => [...old, { key: nextKey(), title: "", summary: "", mainEvent: "", conflict: "", cliffhanger: "", nextEpisodeHook: "" }]);
  }
  function removeEpisode(key: string): void {
    setEpisodes((old) => (old.length <= REVIEW_LIMITS.episodesMin ? old : old.filter((episode) => episode.key !== key)));
  }

  async function create(): Promise<void> {
    if (!canCreate || busy.current) return;
    busy.current = true;
    setCreating(true);
    setError(null);
    const reviewed = {
      title: title.trim(), logline: logline.trim(), genre: genre.trim(), tone: tone.trim(), theme: theme.trim(),
      characters: characters.map((character) => ({ id: character.id, name: character.name.trim(), role: character.role, appearance: character.appearance.trim(), personality: character.personality.trim() })),
      episodes: episodes.map((episode, index) => ({
        episodeNumber: index + 1, title: episode.title.trim(), summary: episode.summary.trim(), mainEvent: episode.mainEvent.trim(),
        conflict: episode.conflict.trim(), cliffhanger: episode.cliffhanger.trim(), nextEpisodeHook: episode.nextEpisodeHook.trim(),
      })),
      warnings: analysis.warnings,
    };
    // 분석 필드 다섯 개는 서버가 settings 와 같은지 검사합니다. 회차 수는 편집한 배열 길이, 장면 수는 분석 때의 값이 기본입니다.
    const settings: LongProjectSettingsInput = {
      title: reviewed.title,
      logline: reviewed.logline,
      overview: reviewed.logline,
      genre: reviewed.genre,
      tone: reviewed.tone,
      theme: reviewed.theme,
      episodeCount: reviewed.episodes.length,
      sceneCount: source.sceneCount,
      clipDurationSeconds: 5,
      aspectRatio: "9:16",
      audience: "",
      // 🔴 비워 둡니다 — 서버가 `settings.notes` 를 회차 대본 프롬프트에 그대로 넣습니다. 출처 메모는 대본 입력이 아니라 출처 기록이라 `source`(→ novel_story_source.json)에만 남습니다(CLI 1317).
      notes: "",
      startingState: "",
      midpoint: "",
      endingDirection: "",
      storyFlowSummary: "",
      narrationEnabled: false,
      subtitlesEnabled: false,
    };
    const body: CreateNovelStoryProjectRequest = {
      projectId: autoStoryProjectId(reviewed.title, new Date()),
      settings,
      source,
      analysis: reviewed,
      ...(assetId ? { protagonistAssetId: assetId } : {}),
      ...(supportingPairs.length > 0 ? { supportingCharacterAssetLinks: supportingPairs } : {}),
    };
    try {
      const created = await createNovelStoryProject(body);
      onCreated(created.project);
    } catch (caught) {
      setError(toLongProjectDisplayError(caught));
    } finally {
      busy.current = false;
      setCreating(false);
    }
  }

  const chosenAsset = library?.find((asset) => asset.assetId === assetId) ?? null;

  return (
    <section data-testid="story-result" aria-label="AI 분석 결과" className="space-y-5 rounded-lg border border-violet-400/40 bg-violet-500/10 p-4">
      <div>
        <h3 className="text-base font-semibold text-bone">AI가 이렇게 읽었습니다 — 고쳐서 확정하세요</h3>
        <p className="mt-1 text-xs text-bone-dim">AI가 정리한 제안이라 모든 칸을 고칠 수 있습니다. 확정하면 이 구조로 장기 프로젝트가 만들어집니다(비용은 나가지 않습니다).</p>
      </div>

      <div className="space-y-1.5 text-xs">
        {response.reused && (
          <p data-testid="story-result-reused" className="text-emerald-300">같은 입력의 지난 분석을 다시 보여 줍니다 — OpenAI에 새로 보내지 않았고 새로 청구되지 않았습니다.</p>
        )}
        {!response.saved && (
          <p role="status" data-testid="story-result-unsaved" className="text-amber-300">이 결과는 서버에 저장되지 않았습니다. 이 화면을 벗어나면 다시 볼 수 없으니, 필요하면 지금 프로젝트로 확정하세요.</p>
        )}
        {response.spendUnrecorded === true && (
          <p role="status" data-testid="story-result-spend-unrecorded" className="text-amber-300">분석은 끝났지만 이번 지출이 월 예산 장부에 기록되지 않았을 수 있습니다. 실제 청구는 OpenAI 사용량에서 확인해 주세요.</p>
        )}
        {stale && (
          <p role="status" data-testid="story-result-stale" className="text-amber-300">
            입력이 바뀌었습니다 — 이 결과는 바뀌기 전 입력의 분석이라 이대로는 프로젝트로 확정할 수 없습니다. 입력을 되돌리거나 새로 분석해 주세요.
          </p>
        )}
      </div>

      {/* ── 개요 ── */}
      <div className="space-y-2 rounded border border-line p-3">
        <h4 className="text-sm font-medium text-bone">줄거리</h4>
        <div className="grid gap-2 md:grid-cols-2">
          <Field label="제목" value={title} onChange={setTitle} max={REVIEW_LIMITS.title} testId="review-title" disabled={creating} />
          <Field label="장르" value={genre} onChange={setGenre} max={REVIEW_LIMITS.genre} testId="review-genre" disabled={creating} />
        </div>
        <Field label="한 줄 줄거리" value={logline} onChange={setLogline} max={REVIEW_LIMITS.logline} testId="review-logline" multiline disabled={creating} />
        <div className="grid gap-2 md:grid-cols-2">
          <Field label="분위기" value={tone} onChange={setTone} max={REVIEW_LIMITS.tone} testId="review-tone" disabled={creating} />
          <Field label="주제" value={theme} onChange={setTheme} max={REVIEW_LIMITS.theme} testId="review-theme" disabled={creating} />
        </div>
      </div>

      {/* ── 인물 ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-medium text-bone">등장인물 <span className="font-normal tabular-nums text-bone-faint" data-testid="review-character-count">{characters.length} / {REVIEW_LIMITS.characters}</span></h4>
          <button type="button" data-testid="review-add-character" className={`${smallOutlineButton} ml-auto`} onClick={addCharacter} disabled={creating || characters.length >= REVIEW_LIMITS.characters}>인물 추가</button>
        </div>
        <ul className="grid gap-2 md:grid-cols-2" data-testid="story-result-characters">
          {characters.map((character, index) => (
            <li key={character.key} data-testid={`story-character-card-${index}`} className="space-y-2 rounded border border-line p-3">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-bone-dim">
                  <input type="radio" name="review-protagonist" data-testid={`review-protagonist-${index}`} checked={character.role === "protagonist"} onChange={() => chooseProtagonist(character.key)} disabled={creating} />
                  주인공
                </label>
                <button
                  type="button"
                  data-testid={`review-remove-character-${index}`}
                  className={`${smallOutlineButton} ml-auto`}
                  onClick={() => removeCharacter(character.key)}
                  disabled={creating || character.role === "protagonist" || characters.length <= 1}
                  title={character.role === "protagonist" ? "주인공은 뺄 수 없습니다 — 다른 인물을 주인공으로 바꾼 뒤 빼세요." : undefined}
                >
                  인물 빼기
                </button>
              </div>
              <Field label="이름" value={character.name} onChange={(value) => updateCharacter(character.key, { name: value })} max={REVIEW_LIMITS.characterName} testId={`review-character-name-${index}`} disabled={creating} />
              <Field label="외모" value={character.appearance} onChange={(value) => updateCharacter(character.key, { appearance: value })} max={REVIEW_LIMITS.appearance} testId={`review-character-appearance-${index}`} multiline disabled={creating} />
              <Field label="성격" value={character.personality} onChange={(value) => updateCharacter(character.key, { personality: value })} max={REVIEW_LIMITS.personality} testId={`review-character-personality-${index}`} multiline disabled={creating} />
              <CharacterImageControl
                storyInputSha256={source.inputSha256}
                characterId={character.id}
                name={character.name}
                appearance={character.appearance}
                personality={character.personality}
                isProtagonist={character.role === "protagonist"}
                onOpenSettings={onOpenSettings}
                onGenerated={() => void loadLibrary()}
                onUseImage={(folderAssetId) => {
                  if (character.role === "protagonist") { setAssetId(folderAssetId); setAssetFromCharacterKey(character.key); }
                  else setSupportingLink(character.key, { assetId: folderAssetId, fromImage: true });
                }}
                usedFolderId={character.role === "protagonist" ? (assetFromCharacterKey === character.key ? assetId : "") : (supportingLinks[character.key]?.assetId ?? "")}
                disabled={creating}
              />
              {character.role === "supporting" && (
                <label className="block text-[11px] text-bone-dim">
                  이 조연의 이미지 (이미지 보관함의 캐릭터 폴더, 선택)
                  <select
                    data-testid={`review-supporting-asset-${index}`}
                    className={inputClass}
                    value={supportingLinks[character.key]?.assetId ?? ""}
                    onChange={(event) => setSupportingLink(character.key, event.target.value ? { assetId: event.target.value, fromImage: false } : null)}
                    disabled={creating || library === null}
                  >
                    <option value="">연결하지 않음</option>
                    {(library ?? []).map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.displayName}</option>)}
                  </select>
                  <span className="mt-0.5 block text-bone-faint">연결하면 아직 그림을 만들지 않은 회차의 참고 이미지에 자동으로 들어갑니다. 나중에 작품 기본 설정에서 바꿀 수 있습니다.</span>
                </label>
              )}
            </li>
          ))}
        </ul>

        <div className="space-y-1.5 rounded border border-line p-3">
          <p className="text-[11px] text-bone-dim">주인공의 이미지 (이미지 보관함의 캐릭터 폴더, 선택)</p>
          {library === null && <p className="text-xs text-bone-faint">보관함을 불러오는 중…</p>}
          {libraryFailed && <p role="status" className="text-xs text-amber-300">보관함 캐릭터 목록을 불러오지 못했습니다. 연결 없이 만들고 프로젝트 설정에서 고를 수 있습니다.</p>}
          {library !== null && !libraryFailed && library.length === 0 && (
            <p data-testid="review-library-empty" className="text-xs text-bone-faint">연결할 수 있는 캐릭터 폴더가 보관함에 없습니다. 연결 없이 만들 수 있습니다.</p>
          )}
          {library !== null && library.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <select data-testid="review-protagonist-asset" className={`${inputClass} max-w-xs`} value={assetId} onChange={(event) => { setAssetId(event.target.value); setAssetFromCharacterKey(null); }} disabled={creating}>
                <option value="">연결하지 않음</option>
                {library.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.displayName}</option>)}
              </select>
              {chosenAsset && (
                <img src={assetContentUrl(chosenAsset.thumbnailAssetId || chosenAsset.assetId)} alt="" className="h-12 w-12 rounded object-cover" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 회차 ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-medium text-bone">회차 구성 <span className="font-normal tabular-nums text-bone-faint" data-testid="review-episode-count">{episodes.length} / {REVIEW_LIMITS.episodesMax}회</span></h4>
          <button type="button" data-testid="review-add-episode" className={`${smallOutlineButton} ml-auto`} onClick={addEpisode} disabled={creating || episodes.length >= REVIEW_LIMITS.episodesMax}>회차 추가</button>
        </div>
        <ol className="space-y-2" data-testid="story-result-episodes">
          {episodes.map((episode, index) => (
            <li key={episode.key} data-testid={`story-episode-card-${index + 1}`} className="space-y-2 rounded border border-line p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-bone" data-testid={`review-episode-number-${index + 1}`}>{index + 1}회</span>
                <div className="ml-auto flex gap-1.5">
                  <button type="button" className={smallOutlineButton} data-testid={`review-episode-up-${index + 1}`} onClick={() => moveEpisode(index, -1)} disabled={creating || index === 0} aria-label={`${index + 1}회를 앞으로`}>↑</button>
                  <button type="button" className={smallOutlineButton} data-testid={`review-episode-down-${index + 1}`} onClick={() => moveEpisode(index, 1)} disabled={creating || index === episodes.length - 1} aria-label={`${index + 1}회를 뒤로`}>↓</button>
                  <button type="button" className={smallOutlineButton} data-testid={`review-episode-remove-${index + 1}`} onClick={() => removeEpisode(episode.key)} disabled={creating || episodes.length <= REVIEW_LIMITS.episodesMin}>회차 빼기</button>
                </div>
              </div>
              <Field label="제목" value={episode.title} onChange={(value) => updateEpisode(episode.key, { title: value })} max={REVIEW_LIMITS.episodeTitle} testId={`review-episode-title-${index + 1}`} disabled={creating} />
              <Field label="요약" value={episode.summary} onChange={(value) => updateEpisode(episode.key, { summary: value })} max={REVIEW_LIMITS.summary} testId={`review-episode-summary-${index + 1}`} multiline disabled={creating} />
              <div className="grid gap-2 md:grid-cols-2">
                <Field label="핵심 사건" value={episode.mainEvent} onChange={(value) => updateEpisode(episode.key, { mainEvent: value })} max={REVIEW_LIMITS.mainEvent} testId={`review-episode-main-${index + 1}`} multiline disabled={creating} />
                <Field label="갈등" value={episode.conflict} onChange={(value) => updateEpisode(episode.key, { conflict: value })} max={REVIEW_LIMITS.conflict} testId={`review-episode-conflict-${index + 1}`} multiline disabled={creating} />
                <Field label="마지막 장면" value={episode.cliffhanger} onChange={(value) => updateEpisode(episode.key, { cliffhanger: value })} max={REVIEW_LIMITS.cliffhanger} testId={`review-episode-cliff-${index + 1}`} multiline disabled={creating} />
                <Field label="다음 화로" value={episode.nextEpisodeHook} onChange={(value) => updateEpisode(episode.key, { nextEpisodeHook: value })} max={REVIEW_LIMITS.nextEpisodeHook} testId={`review-episode-hook-${index + 1}`} multiline disabled={creating} />
              </div>
            </li>
          ))}
        </ol>
      </div>

      {analysis.warnings.length > 0 && (
        <div className="space-y-1" data-testid="story-result-warnings">
          <h4 className="text-sm font-medium text-amber-300">주의 표지</h4>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-300">
            {analysis.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
          <p className="text-[11px] text-bone-faint">이미지·영상 제공자가 거절할 수 있는 내용이거나 실존 인물·개인정보가 의심되는 부분입니다. 프로젝트에도 함께 남습니다.</p>
        </div>
      )}

      {/* ── 확정 ── */}
      <div className="space-y-2 border-t border-line pt-3">
        {emptyCount > 0 && <p data-testid="review-empty-summary" className="text-xs text-bone-faint">비어 있는 칸 {emptyCount}개를 채워야 확정할 수 있습니다.</p>}
        {duplicateSupportingFolder && <p role="status" data-testid="review-supporting-duplicate" className="text-xs text-amber-300">같은 캐릭터 폴더를 두 조연에 연결할 수 없습니다. 한 폴더는 한 조연에만 연결해 주세요.</p>}
        {error && (
          <div role="alert" data-testid="review-create-error" data-error-code={error.code} className="rounded-lg border border-rose-400/30 bg-rose-500/15 p-3">
            <p className="text-sm text-rose-400">{error.message}</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" data-testid="review-create" className={primaryButton} onClick={() => void create()} disabled={!canCreate}>
            {creating ? "프로젝트 만드는 중…" : "이 구조로 장기 프로젝트 만들기"}
          </button>
          <span className="text-xs text-bone-faint">저장만 하고 AI·이미지·영상 요청은 나가지 않습니다. 대본부터는 장기 프로젝트에서 승인해야만 진행됩니다.</span>
        </div>
      </div>

      <p className="text-[11px] text-bone-faint" data-testid="story-result-source">
        모델 {source.model} · {formatDateTime(source.analyzedAt)} 분석 · 권리 확인 {formatDateTime(source.rightsConfirmedAt)} · 분석 당시 {source.episodeCount}회차 × {source.sceneCount}장면
        {source.sourceNote ? ` · 출처 메모: ${source.sourceNote}` : ""}
        <br />
        AI가 정리한 제안입니다. 법적 권리가 해결됐다거나 원문과 비슷하지 않다는 보장은 하지 않습니다.
      </p>
    </section>
  );
}
