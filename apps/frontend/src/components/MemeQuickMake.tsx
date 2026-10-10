import { useEffect, useRef, useState } from "react";
import {
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  SHORT_PROJECT_LEAD_CAST_ROLE,
  type Asset,
  type MemeObservationCard,
  type MemeTrend,
  type MemeTrendWorkspace,
  type Project,
} from "@ai-animation-studio/shared";

import { assetContentUrl, listAssets } from "../api/assetsApi.js";
import { getMemeTrendWorkspace, toMemeTrendDisplayError } from "../api/memeTrendsApi.js";
import { createProject, toDisplayError, updateProjectCast } from "../api/projectsApi.js";
import { cardHint, defaultBeat } from "./MemeRemixDraftPanel.js";
import { Spinner } from "./Spinner.js";
import { primaryButton, smallOutlineButton } from "./ui/surfaces.js";

interface Props {
  trend: MemeTrend;
  onProjectCreated: (project: Project) => void;
  /** 아래 관찰 카드(분석·제안 비교·저장)를 펼쳐 보여 줍니다. */
  onOpenCards?: () => void;
  /** 관찰 카드 칸이 알린 저장 시각 — 내가 읽은 것과 다르면 저장된 카드를 다시 읽습니다(Gemini 호출 없음). */
  cardsSavedAt?: string | null;
}

type DisplayError = { code: string; message: string };

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
 * 「이 밈으로 만들기」 — 캐릭터를 고르고, **사람이 저장한 관찰 카드**로 장면 계획을 채워 단기 프로젝트를 만듭니다.
 *
 * 🔴 **분석 제안을 그대로 카드로 만들지 않습니다(CLI 1340).** 예전에는 이 버튼이 분석 → 제안 전부를 카드로 저장 →
 * 프로젝트까지 한 번에 했는데, 그러면 사람이 제안을 비교·고르는 단계를 건너뜁니다. 이제 분석과 제안 고르기는 아래
 * 관찰 카드 칸에서 사람이 하고, 이 버튼은 **저장된 카드만** `initialStoryDraft` 에 씁니다. 카드가 없으면 그 칸을 열거나
 * 분석 없이(일반적인 틀로) 만들 수 있습니다. 이 컴포넌트는 Gemini·OpenAI·Runway 를 부르지 않습니다 — 프로젝트가
 * 만들어진 뒤의 대본 승인·영상 전송 승인은 기존 흐름 그대로입니다.
 */
export function MemeQuickMake({ trend, onProjectCreated, onOpenCards, cardsSavedAt }: Props) {
  const [workspace, setWorkspace] = useState<MemeTrendWorkspace | null>(null);
  const [workspaceError, setWorkspaceError] = useState<DisplayError | null>(null);
  const [characters, setCharacters] = useState<Asset[] | null>(null);
  const [charactersError, setCharactersError] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [skipAnalysis, setSkipAnalysis] = useState(false);
  /** 프로젝트는 만들어졌는데 캐릭터 연결이 실패한 경우 — 이동하지 않고 여기서 알립니다(이동하면 이 화면이 사라져 알림을 못 봅니다). */
  const [createdProject, setCreatedProject] = useState<Project | null>(null);
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

  // 관찰 카드 칸에서 저장하면 그 시각이 바뀝니다 — 내가 읽은 것과 다를 때만 저장본을 다시 읽습니다(읽기 전용 GET).
  const knownSavedAt = workspace?.cardsSavedAt;
  useEffect(() => {
    if (cardsSavedAt === undefined || workspace === null || cardsSavedAt === knownSavedAt) return;
    let cancelled = false;
    getMemeTrendWorkspace(trend.id)
      .then((next) => { if (!cancelled) { setWorkspace(next); setWorkspaceError(null); } })
      .catch((caught: unknown) => { if (!cancelled) setWorkspaceError(toMemeTrendDisplayError(caught)); });
    return () => { cancelled = true; };
  }, [cardsSavedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const cards = workspace?.cards ?? [];
  const hasCards = cards.length > 0;
  const analyses = workspace?.analyses ?? [];
  const suggestionCount = analyses.reduce((sum, analysis) => sum + analysis.suggestions.length, 0);
  const chosen = characters?.find((asset) => asset.assetId === characterId) ?? null;
  const ready = workspace !== null && chosen !== null && !working && (hasCards || skipAnalysis) && createdProject === null;

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
    setWorking(true);
    // 🔴 저장된 카드만 — 분석 제안은 사람이 관찰 카드 칸에서 골라 저장한 것만 여기 들어옵니다.
    const usedCards: MemeObservationCard[] = skipAnalysis && !hasCards ? [] : workspace.cards;
    try {
      const count = Math.min(MAX_SCENE_COUNT, Math.max(MIN_SCENE_COUNT, usedCards.length + 2));
      const topic = `${trend.name} 밈 — ${chosen.displayName}`.slice(0, 200);
      const character = chosen.displayName.slice(0, 200);
      const situation = "밈의 분위기를 살린 새로운 일상 상황 (대본을 만들 때 AI가 구체화합니다)";
      const fullStory = [
        `새 캐릭터: ${character}`,
        `새 상황: ${situation}`,
        ...Array.from({ length: count }, (_, index) => `${index + 1}장면: ${defaultBeat(index, count, usedCards)}`),
      ].join("\n");
      const additionalNotes = [
        `밈 관찰 카드 참고: ${trend.name}`,
        ...usedCards.map((card) => `- ${cardHint(card)}`),
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
      setError({ code: "CREATE_FAILED", message: toDisplayError(caught).message });
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return (
    <section data-testid="meme-quick-make" aria-label="이 밈으로 만들기" className="mt-6 space-y-4 rounded-lg border border-violet-400/40 bg-violet-500/10 p-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-bone">이 밈으로 만들기</h2>
        <p className="text-xs text-bone-dim">내 캐릭터를 고르면, 저장한 관찰 카드로 장면 계획을 채워 단기 프로젝트를 만듭니다.</p>
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
            ? "저장된 관찰 카드를 읽지 못했습니다 — 읽기 전에는 만들지 않습니다."
            : workspace === null
              ? "저장된 관찰 카드를 확인하는 중…"
              : hasCards
                ? `저장한 관찰 카드 ${cards.length}장으로 만듭니다 — 분석 횟수를 쓰지 않습니다.`
                : skipAnalysis
                  ? "분석 없이 만듭니다 — 장면 계획이 일반적인 틀로 채워지고, 대본 단계에서 AI가 구체화합니다."
                  : suggestionCount > 0
                    ? `분석한 영상 ${analyses.length}편의 제안 ${suggestionCount}개가 있지만 아직 카드로 저장하지 않았습니다. 아래 관찰 카드에서 출처별로 비교해 쓸 제안만 가져와 저장하면 그 카드로 만듭니다.`
                    : "아직 저장한 관찰 카드가 없습니다. 아래 관찰 카드에서 영상을 한 편씩 분석해 제안을 고르거나 직접 적어 저장하면 그 카드로 만듭니다."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" data-testid="meme-quick-run" className={primaryButton} onClick={() => void run()} disabled={!ready}>
            {working ? "만드는 중…" : "이 밈으로 만들기"}
          </button>
          {!hasCards && workspace !== null && createdProject === null && onOpenCards && (
            <button type="button" data-testid="meme-quick-open-cards" className={smallOutlineButton} disabled={working} onClick={onOpenCards}>
              관찰 카드 열기
            </button>
          )}
          {!hasCards && workspace !== null && createdProject === null && (
            <button type="button" data-testid="meme-quick-skip" className={smallOutlineButton} disabled={working} onClick={() => setSkipAnalysis((old) => !old)}>
              {skipAnalysis ? "카드로 만들기로 돌아가기" : "분석 없이 만들기"}
            </button>
          )}
        </div>
        {chosen === null && characters !== null && characters.length > 0 && <p className="text-xs text-bone-faint">먼저 캐릭터를 고르세요.</p>}
        {working && <Spinner label="내 캐릭터로 단기 프로젝트를 만드는 중…" />}
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
          </div>
        )}
        <p className="text-xs text-bone-faint">
          만들어지면 단기 프로젝트로 이어집니다. 대본 승인·그림·영상 단계에서 비용을 확인하고, 영상 전송은 직접 승인해야만 나갑니다.
        </p>
      </div>
    </section>
  );
}
