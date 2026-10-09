import { useEffect, useRef, useState } from "react";
import {
  MAX_SCENE_COUNT,
  MEME_OBSERVATION_LIMITS,
  MIN_SCENE_COUNT,
  SHORT_PROJECT_LEAD_CAST_ROLE,
  type Asset,
  type MemeObservationCard,
  type MemeTrend,
  type MemeTrendWorkspace,
  type Project,
} from "@ai-animation-studio/shared";

import { assetContentUrl, listAssets } from "../api/assetsApi.js";
import { analyzeMemeVideo, getMemeTrendWorkspace, saveMemeObservationCards, toMemeTrendDisplayError } from "../api/memeTrendsApi.js";
import { createProject, toDisplayError, updateProjectCast } from "../api/projectsApi.js";
import { cardHint, defaultBeat } from "./MemeRemixDraftPanel.js";
import { Spinner } from "./Spinner.js";
import { primaryButton, smallOutlineButton } from "./ui/surfaces.js";

interface Props {
  trend: MemeTrend;
  /** 키가 없을 때 갈 곳 — Gemini 키 칸은 API 설정에 있습니다. */
  onOpenSettings: () => void;
  onProjectCreated: (project: Project) => void;
}

type Phase = "idle" | "analyzing" | "saving" | "creating";
type DisplayError = { code: string; message: string };

const PHASE_LABEL: Record<Exclude<Phase, "idle">, string> = {
  analyzing: "1/3 영상을 분석하는 중… (Gemini)",
  saving: "2/3 알아낸 말·동작을 카드로 저장하는 중…",
  creating: "3/3 내 캐릭터로 단기 프로젝트를 만드는 중…",
};

/** 대표 영상: 공개 조회수가 가장 큰 것, 없으면 첫 영상. */
function pickVideoId(trend: MemeTrend): string {
  let best = trend.videos[0]!;
  for (const video of trend.videos) if (video.viewCount !== null && (best.viewCount === null || video.viewCount > best.viewCount)) best = video;
  return best.videoId;
}

/** 폴더 이름 자동 생성 — 사람이 짓지 않아도 되도록. 글자·숫자·_·- 만 남깁니다. */
export function autoProjectId(trendName: string, now: Date): string {
  const base = trendName.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "meme";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `밈_${base}_${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** 보관함에서 고를 수 있는 캐릭터 — 폴더(캐릭터 묶음)와 폴더에 속하지 않은 낱장만. 꺼 둔 것·폴더 속 낱장은 뺍니다. */
export function pickableCharacters(assets: Asset[]): Asset[] {
  return assets.filter((asset) => asset.assetType === "character" && asset.enabled && (asset.isFolder || asset.parentFolderId === ""));
}

/**
 * 「이 밈으로 만들기」 — 후보를 고른 뒤 사람이 하는 일을 **캐릭터 고르기 하나**로 줄입니다.
 *
 * 누르면 순서대로: ① 대표 영상을 Gemini 로 분석(1회) ② 제안을 관찰 카드로 저장 ③ 장면 계획을 채워 단기 프로젝트를
 * 만들고 고른 캐릭터를 주인공으로 연결. 이 버튼을 누르는 것이 분석 1회에 대한 동의이고, 버튼이 그렇게 말합니다.
 * 🔴 **여기서 끝나는 게 아닙니다.** 프로젝트가 만들어지면 기존 흐름(대본 승인 → 그림 → 영상 승인 → 병합)이 이어지고,
 * Runway 같은 유료 전송은 거기서 사람이 승인해야만 나갑니다. 이 컴포넌트는 OpenAI·Runway 를 부르지 않습니다.
 */
export function MemeQuickMake({ trend, onOpenSettings, onProjectCreated }: Props) {
  const [workspace, setWorkspace] = useState<MemeTrendWorkspace | null>(null);
  const [workspaceError, setWorkspaceError] = useState<DisplayError | null>(null);
  const [characters, setCharacters] = useState<Asset[] | null>(null);
  const [charactersError, setCharactersError] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<DisplayError | null>(null);
  const [skipAnalysis, setSkipAnalysis] = useState(false);
  /** 저장된 분석이 「제안 0개」였을 때, 다시 분석하겠다고 사람이 직접 고른 경우만 참 — 자동으로 다시 부르지 않습니다. */
  const [reanalyze, setReanalyze] = useState(false);
  /** 프로젝트는 만들어졌는데 캐릭터 연결이 실패한 경우 — 이동하지 않고 여기서 알립니다(이동하면 이 화면이 사라져 알림을 못 봅니다). */
  const [createdProject, setCreatedProject] = useState<Project | null>(null);
  const [videoId, setVideoId] = useState(() => pickVideoId(trend));
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getMemeTrendWorkspace(trend.id)
      .then((next) => { if (!cancelled) setWorkspace(next); })
      .catch((caught: unknown) => { if (!cancelled) setWorkspaceError(toMemeTrendDisplayError(caught)); });
    listAssets({ assetType: "character" })
      .then((response) => { if (!cancelled) setCharacters(pickableCharacters(response.assets)); })
      .catch((caught: unknown) => { if (!cancelled) setCharactersError(caught instanceof Error ? caught.message : "캐릭터 목록을 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, [trend.id]);

  const calls = workspace?.dailyCalls ?? null;
  const limitReached = calls !== null && calls.used >= calls.limit;
  const hasCards = (workspace?.cards.length ?? 0) > 0;
  // 🔴 분석은 **서버가 카드 저장보다 먼저 저장해 둡니다**. 그래서 카드 저장이 실패한 뒤 다시 눌러도, 화면을 다시 열어도
  // 저장된 분석이 있으면 Gemini 를 또 부르지 않고 그 제안으로 카드 저장부터 이어갑니다(하루 한도를 한 번 더 쓰지 않게).
  const storedSuggestions = workspace?.analysis?.suggestions ?? [];
  const reuseAnalysis = !hasCards && storedSuggestions.length > 0;
  // 저장된 분석이 있는데 제안이 0개였다면 자동으로 다시 분석하지 않고, 다시 분석할지를 사람이 고르게 합니다.
  const emptyAnalysis = !hasCards && workspace?.analysis != null && storedSuggestions.length === 0;
  const needsChoice = emptyAnalysis && !reanalyze && !skipAnalysis;
  const analyzeAllowed = calls !== null && !limitReached;
  const willAnalyze = !hasCards && !reuseAnalysis && !skipAnalysis && analyzeAllowed && (!emptyAnalysis || reanalyze);
  const analysisBlocked = !hasCards && !reuseAnalysis && !skipAnalysis && !willAnalyze;
  const chosen = characters?.find((asset) => asset.assetId === characterId) ?? null;
  const working = phase !== "idle";
  const ready = workspace !== null && chosen !== null && !working && !analysisBlocked && createdProject === null;

  async function linkLead(project: Project, assetId: string): Promise<void> {
    await updateProjectCast(project.id, { cast: [{ assetId, castRole: SHORT_PROJECT_LEAD_CAST_ROLE, storyRole: "주인공" }] });
  }

  /** 연결에 실패한 뒤 다시 연결 — 성공하면 그때 프로젝트로 이동합니다. */
  async function retryLink(): Promise<void> {
    if (busy.current || !createdProject || !chosen) return;
    busy.current = true;
    setError(null);
    try {
      await linkLead(createdProject, chosen.assetId);
      onProjectCreated(createdProject);
    } catch (caught) {
      setError({ code: "CAST_LINK_FAILED", message: `캐릭터를 연결하지 못했습니다(${toDisplayError(caught).message}).` });
    } finally {
      busy.current = false;
    }
  }

  async function run(): Promise<void> {
    if (!ready || busy.current || !workspace || !chosen) return;
    busy.current = true;
    setError(null);
    let cards: MemeObservationCard[] = workspace.cards;
    try {
      let source: MemeTrendWorkspace = workspace;
      if (willAnalyze) {
        setPhase("analyzing");
        try {
          source = await analyzeMemeVideo(trend.id, { sourceVideoId: videoId });
        } catch (caught) {
          setError(toMemeTrendDisplayError(caught));
          return;
        }
        // 분석 결과를 **바로** 들고 있습니다 — 아래 카드 저장이 실패해도 다시 누를 때 분석을 반복하지 않도록.
        setWorkspace(source);
        setReanalyze(false);
      }
      const suggestions = source.cards.length === 0 ? (source.analysis?.suggestions ?? []) : [];
      if (suggestions.length > 0) {
        setPhase("saving");
        const sourceVideoId = source.analysis!.sourceVideoId;
        try {
          const saved = await saveMemeObservationCards(trend.id, {
            cards: suggestions.slice(0, MEME_OBSERVATION_LIMITS.cardsMax).map((suggestion) => ({
              kind: suggestion.kind,
              text: suggestion.text,
              startSeconds: suggestion.startSeconds,
              endSeconds: suggestion.endSeconds,
              origin: "suggestion" as const,
              suggestionId: suggestion.id,
              sourceVideoId,
            })),
            expectedCardsSavedAt: source.cardsSavedAt,
          });
          cards = saved.cards;
          setWorkspace(saved);
        } catch (caught) {
          // 동시 저장 충돌이면 서버 기준을 다시 읽어 둡니다 — 다음에 누를 때 그 카드로 이어가고 분석은 반복하지 않습니다.
          if (toMemeTrendDisplayError(caught).code === "MEME_CARDS_CONFLICT") {
            try { setWorkspace(await getMemeTrendWorkspace(trend.id)); } catch { /* 다시 읽지 못해도 아래 오류 안내는 그대로 */ }
          }
          throw caught;
        }
      } else {
        cards = source.cards;
      }

      setPhase("creating");
      const count = Math.min(MAX_SCENE_COUNT, Math.max(MIN_SCENE_COUNT, cards.length + 2));
      const topic = `${trend.name} 밈 — ${chosen.displayName}`.slice(0, 200);
      const character = chosen.displayName.slice(0, 200);
      const situation = "밈의 분위기를 살린 새로운 일상 상황 (대본을 만들 때 AI가 구체화합니다)";
      const fullStory = [
        `새 캐릭터: ${character}`,
        `새 상황: ${situation}`,
        ...Array.from({ length: count }, (_, index) => `${index + 1}장면: ${defaultBeat(index, count, cards)}`),
      ].join("\n");
      const additionalNotes = [
        `밈 관찰 카드 참고: ${trend.name}`,
        ...cards.map((card) => `- ${cardHint(card)}`),
        "원본 영상·음원·대사·로고·얼굴을 복제하지 마세요. 관찰한 리듬과 구조만 참고해 새 캐릭터·배경·말·행동으로 바꿔 주세요.",
      ].join("\n");
      const response = await createProject({
        projectId: autoProjectId(trend.name, new Date()),
        topic,
        initialStoryDraft: { projectName: topic, character, fullStory: fullStory.slice(0, 6000), additionalNotes: additionalNotes.slice(0, 6000), sceneCount: count },
      });
      // 주인공 연결은 프로젝트가 이미 만들어진 뒤라서, 실패해도 프로젝트는 남습니다.
      // 🔴 실패하면 **이동하지 않습니다** — 이동하면 이 화면이 사라져 알림을 사람이 못 봅니다. 여기서 알리고, 다시 연결하거나
      // 연결 없이 프로젝트를 열게 합니다.
      try {
        await linkLead(response.project, chosen.assetId);
      } catch (caught) {
        setCreatedProject(response.project);
        setError({ code: "CAST_LINK_FAILED", message: `프로젝트는 만들어졌지만 캐릭터를 주인공으로 연결하지 못했습니다(${toDisplayError(caught).message}).` });
        return;
      }
      onProjectCreated(response.project);
    } catch (caught) {
      const memeError = toMemeTrendDisplayError(caught);
      setError(memeError.code.startsWith("MEME_") ? memeError : { code: "CREATE_FAILED", message: toDisplayError(caught).message });
    } finally {
      busy.current = false;
      setPhase("idle");
    }
  }

  return (
    <section data-testid="meme-quick-make" aria-label="이 밈으로 만들기" className="mt-6 space-y-4 rounded-lg border border-violet-400/40 bg-violet-500/10 p-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-bone">이 밈으로 만들기</h2>
        <p className="text-xs text-bone-dim">내 캐릭터만 고르세요. 나머지(영상 분석 → 장면 계획 → 프로젝트 만들기)는 앱이 합니다.</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-bone">1. 내 캐릭터 (보관함)</p>
        {characters === null && !charactersError && <Spinner label="보관함에서 캐릭터를 불러오는 중..." />}
        {charactersError && <p role="alert" data-testid="meme-quick-characters-error" className="text-sm text-rose-400">{charactersError}</p>}
        {characters !== null && characters.length === 0 && (
          <p data-testid="meme-quick-characters-empty" className="text-xs text-bone-dim">보관함에 쓸 수 있는 캐릭터가 없습니다. 이미지 보관함에서 캐릭터를 먼저 등록해 주세요.</p>
        )}
        {characters !== null && characters.length > 0 && (
          <ul role="radiogroup" aria-label="내 캐릭터" data-testid="meme-quick-characters" className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {characters.map((asset) => {
              const selected = asset.assetId === characterId;
              const thumbnailId = asset.isFolder && asset.thumbnailAssetId ? asset.thumbnailAssetId : asset.assetId;
              return (
                <li key={asset.assetId}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`meme-quick-character-${asset.assetId}`}
                    disabled={working}
                    onClick={() => setCharacterId(asset.assetId)}
                    className={`flex w-full flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors ${selected ? "border-violet-400/50 bg-violet-500/15" : "border-line bg-ground-raised hover:border-bone-faint/60"}`}
                  >
                    {asset.imageAvailable || asset.isFolder
                      ? <img src={assetContentUrl(thumbnailId)} alt="" loading="lazy" className="aspect-square w-full rounded object-cover" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
                      : <span aria-hidden="true" className="aspect-square w-full rounded bg-slate-950/40" />}
                    <span className="truncate text-xs font-medium text-bone">{asset.displayName}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-bone">2. 만들기</p>
        <p data-testid="meme-quick-plan" className="text-xs text-bone-dim">
          {workspaceError
            ? "저장된 분석 기록을 읽지 못했습니다 — 읽기 전에는 분석을 부르지 않습니다."
            : workspace === null
              ? "기록을 확인하는 중…"
              : hasCards
                ? `이미 저장한 관찰 카드 ${workspace.cards.length}장을 그대로 씁니다 — 분석 횟수를 쓰지 않습니다.`
                : reuseAnalysis
                  ? `이미 분석한 제안 ${storedSuggestions.length}개를 카드로 저장해 씁니다 — 분석 횟수를 쓰지 않습니다.`
                  : needsChoice
                    ? "이 밈은 이미 분석했지만 알아볼 만한 말·동작을 찾지 못했습니다. 다시 분석하려면 횟수가 한 번 더 듭니다 — 자동으로 다시 부르지 않으니 아래에서 고르세요."
                    : skipAnalysis
                  ? "분석 없이 만듭니다 — 장면 계획이 일반적인 틀로 채워지고, 대본 단계에서 AI가 구체화합니다."
                  : limitReached
                    ? `오늘 분석 횟수(${calls!.used}/${calls!.limit}회)를 다 썼습니다. 분석 없이 만들 수 있습니다.`
                    : calls === null
                      ? "오늘 쓴 분석 횟수를 모릅니다 — 확인하기 전에는 분석을 부르지 않습니다. 분석 없이 만들 수 있습니다."
                      : `아래 영상 1편만 Gemini로 분석합니다(${trend.videos.length}편 전부가 아닙니다 · 1회 사용 · 오늘 ${calls.used}/${calls.limit}회). 이 버튼을 누르는 것이 그 동의입니다.`}
        </p>
        {willAnalyze && (
          <label className="block space-y-1">
            <span className="block text-xs text-bone-dim">분석할 영상 (기본은 조회수가 가장 큰 영상)</span>
            <select
              data-testid="meme-quick-video"
              value={videoId}
              onChange={(event) => setVideoId(event.target.value)}
              disabled={working}
              className="w-full rounded border border-line bg-slate-900/70 px-2.5 py-1.5 text-sm text-bone"
            >
              {trend.videos.map((video) => (
                <option key={video.videoId} value={video.videoId}>
                  {video.title} · {video.channelTitle}{video.viewCount === null ? "" : ` · ${video.viewCount.toLocaleString("ko-KR")}회`}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" data-testid="meme-quick-run" className={primaryButton} onClick={() => void run()} disabled={!ready}>
            {working ? "만드는 중…" : willAnalyze ? "이 밈으로 만들기 (분석 1회 사용)" : "이 밈으로 만들기"}
          </button>
          {needsChoice && analyzeAllowed && (
            <button type="button" data-testid="meme-quick-reanalyze" className={smallOutlineButton} disabled={working} onClick={() => setReanalyze(true)}>
              다시 분석하기 (분석 1회 사용)
            </button>
          )}
          {!hasCards && !reuseAnalysis && workspace !== null && createdProject === null && (
            <button type="button" data-testid="meme-quick-skip" className={smallOutlineButton} disabled={working} onClick={() => setSkipAnalysis((old) => !old)}>
              {skipAnalysis ? "분석하고 만들기로 돌아가기" : "분석 없이 만들기"}
            </button>
          )}
        </div>
        {chosen === null && characters !== null && characters.length > 0 && <p className="text-xs text-bone-faint">먼저 캐릭터를 고르세요.</p>}
        {working && <Spinner label={PHASE_LABEL[phase as Exclude<Phase, "idle">]} />}
        {error && (
          <div role="alert" data-testid="meme-quick-error" data-error-code={error.code} className="space-y-2 rounded-lg border border-rose-400/30 bg-rose-500/15 p-3">
            <p className="text-sm text-rose-400">{error.message}</p>
            {error.code === "CAST_LINK_FAILED" && createdProject !== null && (
              <div className="space-y-2">
                <p className="text-xs text-bone-dim">프로젝트는 이미 만들어져 있습니다 — 새로 만들지 않아도 됩니다. 캐릭터는 다시 연결하거나, 프로젝트 설정에서 직접 고를 수 있습니다.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" data-testid="meme-quick-retry-link" className={smallOutlineButton} onClick={() => void retryLink()}>캐릭터 다시 연결</button>
                  <button type="button" data-testid="meme-quick-open-project" className={smallOutlineButton} onClick={() => onProjectCreated(createdProject)}>캐릭터 없이 프로젝트 열기</button>
                </div>
              </div>
            )}
            {error.code === "MEME_ANALYSIS_KEY_MISSING" && (
              <div className="flex flex-wrap gap-2">
                <button type="button" data-testid="meme-quick-open-settings" className={smallOutlineButton} onClick={onOpenSettings}>API 설정 열기</button>
                <button type="button" className={smallOutlineButton} onClick={() => { setSkipAnalysis(true); setError(null); }}>분석 없이 만들기</button>
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-bone-faint">
          만들어지면 단기 프로젝트로 이어집니다. 대본 승인·그림·영상 단계에서 비용을 확인하고, 영상 전송은 직접 승인해야만 나갑니다.
        </p>
      </div>
    </section>
  );
}
