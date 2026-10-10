import { useEffect, useRef, useState } from "react";
import {
  MEME_GROWTH_MIN_INTERVAL_MS,
  MEME_TREND_MIN_CHANNELS,
  MEME_TREND_MIN_THIRD_CREATOR_VIEWS,
  MEME_TREND_MIN_VIDEOS,
  MEME_TREND_REFRESH_LIMIT_PER_PACIFIC_DAY,
  memeVideoAgeAverageViewsPerHour,
  memeVideoGrowth,
  type MemeTrend,
  type MemeTrendEvidence,
  type MemeTrendFeedResponse,
  type MemeTrendVideo,
  type Project,
} from "@ai-animation-studio/shared";

import { getMemeTrends, refreshMemeTrends, toMemeTrendDisplayError } from "../api/memeTrendsApi.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { MemeObservationPanel } from "./MemeObservationPanel.js";
import { MemeQuickMake } from "./MemeQuickMake.js";
import { Spinner } from "./Spinner.js";
import { StepRibbon, type RibbonStep } from "./ui/StepRibbon.js";
import { outlineButton, smallOutlineButton } from "./ui/surfaces.js";

interface Props {
  /** 고른 밈 후보 — 주소(`#/memeTrends?trendId=…`)에 실려 새로고침해도 남습니다. */
  trendId?: string;
  onSelect: (trendId: string | undefined) => void;
  /** 키가 없을 때 갈 곳. 키를 넣는 칸은 API 설정에 있습니다. */
  onOpenSettings: () => void;
  onProjectCreated: (project: Project) => void;
}

type DisplayError = { code: string; message: string };

/** 마지막 수집이 이보다 오래됐으면 「조회수가 지금과 다를 수 있다」고 말합니다. 숫자는 읽은 시각의 것입니다. */
export const MEME_TRENDS_STALE_HOURS = 24;

const views = (count: number) => `${count.toLocaleString("ko-KR")}회`;

/** 근거 글자를 본 그대로 — 해시태그는 `#` 째로, 문구는 따옴표 안에. 다듬거나 번역하지 않습니다. */
const evidenceText = (evidence: MemeTrendEvidence) =>
  evidence.kind === "hashtag" ? (evidence.text.startsWith("#") ? evidence.text : `#${evidence.text}`) : `“${evidence.text}”`;

/** 공개된 조회수 중 가장 큰 것. 모두 비공개면 null — 0으로 채우지 않습니다. */
function topViews(trend: MemeTrend): number | null {
  const known = trend.videos.map((video) => video.viewCount).filter((count): count is number => count !== null);
  return known.length > 0 ? Math.max(...known) : null;
}

function latestPublished(trend: MemeTrend): string {
  return trend.videos.reduce((latest, video) => (Date.parse(video.publishedAt) > Date.parse(latest) ? video.publishedAt : latest), trend.videos[0]!.publishedAt);
}

/**
 * 근거 숫자(CLI 1355) — 서버가 정렬에 쓰는 순서대로 따로 보여 줍니다. 하나의 점수로 합치지 않습니다(§3.11).
 * 예전 캐시에는 이 필드가 없으므로, 없으면 「미수집」이라고 말하고 0 으로 채우지 않습니다.
 */
export function trendSignals(trend: MemeTrend): { recent: string; perHour: string } {
  return {
    recent: trend.recentChannelCount === undefined ? "최근 7일 참여 미수집" : `최근 7일 참여 채널 ${trend.recentChannelCount}곳`,
    perHour: trend.medianViewsPerHour === undefined ? "시간당 조회수 미수집"
      : trend.medianViewsPerHour === null ? "시간당 조회수 계산 안 됨"
        : `시간당 ${trend.medianViewsPerHour.toLocaleString("ko-KR")}회(중간값)`,
  };
}

const DISCOVERY_LABEL: Record<NonNullable<MemeTrend["discoverySources"]>[number], string> = {
  search: "검색",
  popular: "인기 동영상",
  "music-chart": "음악 차트 곡 검색",
};
const REGION_LABEL: Record<"KR" | "US" | "JP", string> = { KR: "한국", US: "미국", JP: "일본" };

/** 구독자 대비 조회수 — 1 이면 구독자 수만큼 봤다는 뜻. 작은 채널에서 크게 터졌는지를 봅니다. */
const perSubscriber = (value: number) => `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}배`;

function hoursSince(iso: string, now: number): number {
  return (now - Date.parse(iso)) / 3_600_000;
}

/**
 * 밈·챌린지 후보 — **YouTube 공식 API 로 모은 것만** 보여 줍니다(CLI Round 1268·1269).
 *
 * 🔴 이 화면이 하지 않는 말이 이 화면의 절반입니다.
 * - **트렌드 점수가 없습니다.** 보이는 숫자는 YouTube 가 준 조회수, 묶인 영상 수, 서로 다른 채널 수뿐이고,
 *   조회수는 **읽은 시각과 함께** 적습니다. 순서는 서버가 준 그대로입니다.
 * - **Instagram·TikTok 유행이 아닙니다.** 첫 자동 출처는 YouTube 하나이고, 범위 줄이 그걸 항상 말합니다.
 * - **영상 내용을 본 게 아닙니다.** 「같은 밈」의 근거는 제목·설명·태그에서 실제로 본 해시태그·문구뿐이라,
 *   말·동작·타이밍 설명은 적지 않습니다. 영상 분석은 다음 단계입니다.
 *
 * 🟠 화면을 열 때는 저장된 마지막 수집만 읽습니다 — YouTube 를 부르지 않습니다. 할당량을 쓰는 건
 * 「YouTube에서 다시 모으기」를 누를 때뿐이고, 실패해도 보고 있던 목록은 그대로 둡니다.
 */
export function MemeTrendsScreen({ trendId, onSelect, onOpenSettings, onProjectCreated }: Props) {
  const [feed, setFeed] = useState<MemeTrendFeedResponse | null>(null);
  const [loadError, setLoadError] = useState<DisplayError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<DisplayError | null>(null);
  /** 고른 후보의 저장된 카드 수 — 후보가 바뀌면 그 후보 것이 아니므로 trendId 와 함께 들고 있습니다. */
  const [savedCards, setSavedCards] = useState<{ trendId: string; count: number } | null>(null);
  /** 고른 후보의 카드 저장 시각 — 「이 밈으로 만들기」가 저장된 카드를 다시 읽는 신호입니다. */
  const [cardsSavedAt, setCardsSavedAt] = useState<{ trendId: string; savedAt: string | null } | null>(null);
  /** 관찰 카드 접힘 — 「이 밈으로 만들기」의 「관찰 카드 열기」가 펼칩니다. */
  const [cardsOpen, setCardsOpen] = useState(false);
  const cardsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    let cancelled = false;
    getMemeTrends()
      .then((response) => { if (!cancelled) setFeed(response); })
      .catch((caught: unknown) => { if (!cancelled) setLoadError(toMemeTrendDisplayError(caught)); });
    return () => { cancelled = true; };
  }, []);

  async function refresh(): Promise<void> {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const next = await refreshMemeTrends();
      setFeed(next);
      setLoadError(null);
    } catch (caught) {
      // 🔴 지난 목록을 지우지 않습니다 — 서버도 지우지 않았고, 「못 모았다」와 「없다」는 다른 말입니다.
      setRefreshError(toMemeTrendDisplayError(caught));
    } finally {
      setRefreshing(false);
    }
  }

  const now = Date.now();
  // 겹치는 후보를 서버가 합치면 예전 id 는 `aliases` 에 남습니다(CLI 1355) — 주소에 남은 옛 id 로도 같은 후보가 열립니다.
  const selected = trendId && feed ? feed.trends.find((trend) => trend.id === trendId || (trend.aliases ?? []).includes(trendId)) ?? null : null;
  const stale = feed?.collectedAt ? hoursSince(feed.collectedAt, now) >= MEME_TRENDS_STALE_HOURS : false;

  const cardCount = selected && savedCards?.trendId === selected.id ? savedCards.count : 0;
  const hasTrends = (feed?.trends.length ?? 0) > 0;
  // 🔴 「어디까지 왔나」만 말합니다 — 앞 단계는 끝난 일, 지금 단계는 한 곳, 뒤는 아직. 영상 제작은 이 화면 밖(단기 프로젝트)입니다.
  const stage = !selected ? 0 : cardCount === 0 ? 1 : 2;
  const steps: RibbonStep[] = [
    { key: "pick", label: "밈 고르기", onSelect: selected ? () => onSelect(undefined) : undefined },
    { key: "observe", label: "분석·카드" },
    { key: "draft", label: "초안 만들기" },
    { key: "make", label: "영상 제작" },
  ];
  // 후보를 고른 뒤에는 바로 아래 「이 밈으로 만들기」 카드가 할 일을 말하므로 띠 옆 안내는 첫 단계에만 둡니다(같은 말을 두 번 하지 않음).
  const stageHint = stage === 0 ? (hasTrends ? "목록에서 밈 후보를 하나 고르세요." : "먼저 「YouTube에서 다시 모으기」로 후보를 모으세요.") : null;

  return (
    <section>
      <header className="flex items-end gap-5">
        <div className="flex items-baseline gap-4">
          <span data-testid="meme-trends-count" className="type-display text-[58px] leading-[0.82] text-bone">
            {feed?.trends.length ?? 0}
          </span>
          <div className="flex flex-col gap-0.5 pb-0.5">
            <span aria-hidden="true" className="type-index text-bone-faint">Meme trends</span>
            <h1 className="text-[17px] font-medium tracking-[-0.01em] text-bone-dim">밈 트렌드</h1>
          </div>
        </div>
        <button
          type="button"
          data-testid="meme-trends-refresh"
          className={`${outlineButton} ml-auto`}
          onClick={() => void refresh()}
          disabled={refreshing || (feed === null && loadError === null)}
        >
          {refreshing ? "모으는 중…" : "YouTube에서 다시 모으기"}
        </button>
      </header>

      {/* 🔴 범위 — 항상 보입니다. 이 줄이 없으면 이 화면은 「지금의 유행 전부」처럼 읽힙니다. */}
      <div className="mt-4 space-y-1 text-xs text-bone-dim" data-testid="meme-trends-scope">
        <p>
          출처: YouTube 공식 API · 한국·미국·일본 검색과 지역별 음악 차트 곡 · 최근 4분 미만 영상 ·{" "}
          {feed?.collectedAt
            ? <>마지막 수집 <span data-testid="meme-trends-collected-at">{formatDateTime(feed.collectedAt)}</span></>
            : "아직 모은 적 없음"}
        </p>
        <p className="text-bone-faint">
          YouTube 밈 후보입니다. Instagram·TikTok 유행은 포함하지 않고, 영상 속 말·동작은 아직 분석하지 않았습니다.
          서로 다른 채널 {MEME_TREND_MIN_CHANNELS}곳 이상, 영상 {MEME_TREND_MIN_VIDEOS}편 이상에서 같은 해시태그·문구가 보인 것만 묶었고, 세 번째 채널 영상 조회수가 {MEME_TREND_MIN_THIRD_CREATOR_VIEWS.toLocaleString("ko-KR")}회 이상인 것만 남겼으며, 플랫폼·형식 태그(tiktok, shorts, 밈 맞히기 같은)는 뺐습니다. 제목·태그 같은 메타데이터로 고른 후보일 뿐 유행을 확정한 것은 아닙니다.
        </p>
        <p className="text-bone-faint" data-testid="meme-trends-order">
          순서는 최근 7일 안에 따라 한 채널 수 → 시간당 조회수 중간값 → 구독자 대비 조회수 순입니다. 하나의 점수가 아니며, 같은 음원을 쓴 쇼츠 수처럼 YouTube API가 주지 않는 지표는 없습니다.
        </p>
      </div>

      {/* 🟠 스크롤해도 따라옵니다 — 후보를 고르면 상세·관찰 카드가 아래로 길게 이어져, 띠가 화면 밖으로 나가면 「어디까지 왔나」를 잃습니다. */}
      <div className="sticky top-0 z-10 -mx-1 mt-5 bg-ground px-1 py-2" data-testid="meme-flow">
        <StepRibbon steps={steps} currentIndex={stage} />
        {stageHint && <p className="mt-2 text-xs text-bone-dim" data-testid="meme-flow-hint">{stageHint}</p>}
      </div>

      <div className="mt-5 border-b border-line" />

      {refreshing && <Spinner label="YouTube에서 모으는 중… 검색 할당량을 씁니다." className="mt-4" />}

      {refreshError && (
        <div role="alert" data-testid="meme-trends-refresh-error" data-error-code={refreshError.code} className="mt-4 space-y-2 rounded-lg border border-rose-400/30 bg-rose-500/15 p-4">
          <p className="text-sm text-rose-400">
            {refreshError.message}
            {feed?.collectedAt ? " 아래는 지난번에 모은 목록입니다." : ""}
          </p>
          {refreshError.code === "MEME_TREND_KEY_MISSING" && (
            <button type="button" data-testid="meme-trends-open-settings" className={smallOutlineButton} onClick={onOpenSettings}>
              API 설정 열기
            </button>
          )}
        </div>
      )}

      {feed === null && !loadError && <Spinner label="불러오는 중..." className="mt-6" />}

      {/* 🔴 삼키지 않습니다 — 「못 읽었다」와 「모은 게 없다」가 같아 보이면 사람은 할당량을 써서 다시 모읍니다. */}
      {loadError && (
        <p role="alert" data-testid="meme-trends-load-error" data-error-code={loadError.code} className="mt-6 text-sm text-rose-400">
          {loadError.message} — 저장된 밈 후보를 불러오지 못했습니다.
        </p>
      )}

      {stale && feed?.collectedAt && (
        <p role="status" data-testid="meme-trends-stale" className="mt-4 rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
          마지막 수집이 {Math.floor(hoursSince(feed.collectedAt, now))}시간 전입니다. 아래 조회수는 그때 읽은 값이라 지금과 다를 수 있습니다. 지금 다시 모으면 증가 속도도 계산됩니다.
        </p>
      )}
      {/* 수동 재수집 안내(캡틴D 1354) — 자동으로 모으지 않습니다. 24시간이 지나야 실측 증가가 생깁니다. */}
      {!stale && feed?.collectedAt && (
        <p data-testid="meme-trends-recollect" className="mt-4 text-xs text-bone-faint">
          마지막 수집 {Math.floor(hoursSince(feed.collectedAt, now))}시간 전 · 24시간 이상 지난 뒤 「YouTube에서 다시 모으기」를 누르면 영상별 증가 속도가 계산됩니다(자동으로 모으지 않음 · 하루 {MEME_TREND_REFRESH_LIMIT_PER_PACIFIC_DAY}회까지).
        </p>
      )}

      {feed && feed.collectedAt === null && (
        <p className="mt-6 text-bone-dim" data-testid="meme-trends-never">
          아직 모은 밈 후보가 없습니다. 오른쪽 위 「YouTube에서 다시 모으기」를 누르면 YouTube 검색 할당량을 써서 모읍니다.
        </p>
      )}

      {feed && feed.collectedAt !== null && feed.trends.length === 0 && (
        <p className="mt-6 text-bone-dim" data-testid="meme-trends-none">
          마지막 수집에서 조건에 맞는 밈 후보가 없었습니다. 여러 채널이 같은 해시태그·문구를 쓴 영상이 모이면 여기에 나옵니다.
        </p>
      )}

      {trendId && feed && !selected && (
        <div role="status" data-testid="meme-trend-missing" className="mt-4 flex items-center gap-3 rounded-lg border border-sky-400/30 bg-sky-500/10 px-4 py-2.5 text-xs text-sky-300">
          <span>고르셨던 밈 후보가 마지막 수집 목록에 없습니다.</span>
          <button type="button" className={smallOutlineButton} onClick={() => onSelect(undefined)}>목록만 보기</button>
        </div>
      )}

      {selected && (
        <div className="mt-4">
          <button type="button" data-testid="meme-trends-show-all" className={smallOutlineButton} onClick={() => onSelect(undefined)}>← 다른 밈 고르기</button>
        </div>
      )}

      {feed && feed.trends.length > 0 && (
        <ul data-testid="meme-trends-list" className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* 후보를 고르면 목록은 고른 한 장만 남깁니다 — 열두 장이 상세를 화면 아래로 밀어내지 않게. 다시 고르려면 「다른 밈 고르기」·1단계. */}
          {(selected ? feed.trends.filter((trend) => trend.id === selected.id) : feed.trends).map((trend) => (
            <li key={trend.id}>
              <TrendCard trend={trend} selected={trend.id === selected?.id} onSelect={() => onSelect(trend.id === selected?.id ? undefined : trend.id)} />
            </li>
          ))}
        </ul>
      )}

      {selected && feed?.collectedAt && (
        <MemeQuickMake
          key={`quick-${selected.id}`}
          trend={selected}
          onProjectCreated={onProjectCreated}
          onOpenCards={() => { setCardsOpen(true); requestAnimationFrame(() => cardsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" })); }}
          cardsSavedAt={cardsSavedAt?.trendId === selected.id ? cardsSavedAt.savedAt : undefined}
        />
      )}
      {selected && feed?.collectedAt && <TrendDetail trend={selected} />}
      {/* ② 관찰 카드 — 후보마다 따로 저장되므로 후보가 바뀌면 새로 엽니다(key). 열 때는 저장본만 읽습니다. */}
      {selected && feed?.collectedAt && (
        <details ref={cardsRef} className="mt-6" data-testid="meme-observations-details" open={cardsOpen} onToggle={(event) => setCardsOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer text-xs text-bone-dim hover:text-bone">관찰 카드 — 영상 분석·제안 비교·직접 적기</summary>
          <MemeObservationPanel
            key={selected.id}
            trend={selected}
            onOpenSettings={onOpenSettings}
            onProjectCreated={onProjectCreated}
            onSavedCardCount={(count) => setSavedCards({ trendId: selected.id, count })}
            onCardsSavedAt={(savedAt) => setCardsSavedAt({ trendId: selected.id, savedAt })}
          />
        </details>
      )}

    </section>
  );
}

function EvidenceChips({ evidence, withCounts = false }: { evidence: MemeTrendEvidence[]; withCounts?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {evidence.map((item) => (
        <li key={`${item.kind}:${item.text}`} className="rounded border border-line px-1.5 py-0.5 text-[11px] text-bone-dim">
          {evidenceText(item)}
          {withCounts && <span className="text-bone-faint"> · 영상 {item.videoCount}편</span>}
        </li>
      ))}
    </ul>
  );
}

function TrendCard({ trend, selected, onSelect }: { trend: MemeTrend; selected: boolean; onSelect: () => void }) {
  const top = topViews(trend);
  const signals = trendSignals(trend);
  const thumbnail = trend.videos.find((video) => video.thumbnailUrl)?.thumbnailUrl ?? null;
  return (
    <button
      type="button"
      data-testid={`meme-trend-open-${trend.id}`}
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex w-full gap-3 rounded-lg border p-3 text-left transition-colors ${selected ? "border-violet-400/50 bg-violet-500/15" : "border-line bg-ground-raised hover:border-bone-faint/60"}`}
    >
      {thumbnail
        ? <img src={thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-20 w-20 flex-shrink-0 rounded object-cover" />
        : <span aria-hidden="true" className="h-20 w-20 flex-shrink-0 rounded bg-slate-950/40" />}
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="block truncate text-sm font-medium text-bone">{trend.name}</span>
        <span className="block text-[11px] text-bone-dim" data-testid={`meme-trend-signals-${trend.id}`}>
          {signals.recent} · {signals.perHour}
        </span>
        <span className="block text-[11px] text-bone-dim" data-testid={`meme-trend-stats-${trend.id}`}>
          최고 조회수 {top === null ? "비공개" : views(top)} · 영상 {trend.videos.length}편 · 채널 {trend.channelCount}곳
        </span>
        <span className="block text-[11px] text-bone-faint">가장 최근 게시 {formatDateTime(latestPublished(trend))}</span>
      </span>
    </button>
  );
}

/**
 * 속도는 shared `memeVideoGrowth` 가 유효하다고 한 때만 — 24시간 이상·30일 미만 간격에서 조회수가 줄지 않은 경우입니다.
 * 「관찰 기간 평균」이지 지금의 속도도, 앞날의 예측도 아닙니다. 백엔드는 빠른 재수집 뒤에도 최초 비교 기준을 유지하므로
 * 「지난 수집」이 아니라 「비교 기준」이라 부릅니다.
 * 🟠 계산되지 않은 영상마다 같은 안내를 되풀이하지 않습니다 — 그건 목록 위 한 줄(`growthSummary`)이 한 번만 말합니다.
 */
function Growth({ video }: { video: MemeTrendVideo }) {
  const growth = memeVideoGrowth(video);
  if (!growth || video.previousViewCountObservedAt === undefined) {
    // 실측 증가가 없을 때만 — 게시 후 누적 조회수의 시간 평균(최소 6시간). 실측과 섞지 않게 이름을 따로 붙입니다.
    const average = memeVideoAgeAverageViewsPerHour(video);
    return average === null ? null : (
      <span className="block text-bone-faint" data-testid={`meme-video-age-average-${video.videoId}`} data-growth="age-average">
        게시 후 평균 시간당 {average.toLocaleString("ko-KR")}회 (실측 증가 아님)
      </span>
    );
  }
  return (
    <span className="block text-bone-dim" data-testid={`meme-video-growth-${video.videoId}`} data-growth="measured">
      관찰 기간 평균 +{growth.viewsPerDay.toLocaleString("ko-KR")}회/일
      <span className="text-bone-faint">
        {" "}· 실제 +{growth.viewsGained.toLocaleString("ko-KR")}회 · 비교 기준 {formatDateTime(video.previousViewCountObservedAt)} → {formatDateTime(video.viewCountObservedAt)}
      </span>
    </span>
  );
}

type GrowthSummaryState = "no-baseline" | "too-short" | "invalid" | "partial";

/** 속도가 계산되지 않은 영상이 있을 때만 — 이유는 이전 값이 없는 것, 24시간 미만, 맞지 않는 값 중 하나. 이유를 단정하지 않습니다. */
export function growthSummary(videos: MemeTrendVideo[]): { state: GrowthSummaryState; text: string } | null {
  const readable = videos.filter((video) => video.viewCount !== null);
  if (readable.length === 0) return null;
  const measured = readable.filter((video) => memeVideoGrowth(video) !== null).length;
  if (measured === readable.length) return null;
  if (measured > 0) return { state: "partial", text: "속도는 계산된 영상에만 표시합니다 — 나머지는 이전 조회수가 없거나 비교할 수 없습니다." };
  const withBaseline = readable.filter((video) => video.previousViewCount !== undefined && video.previousViewCountObservedAt !== undefined);
  if (withBaseline.length === 0) return { state: "no-baseline", text: "비교할 이전 조회수가 없어 증가 속도는 아직 없습니다. 24시간 이상 간격으로 다시 모으면 표시됩니다." };
  const tooShort = withBaseline.some((video) => {
    const elapsed = Date.parse(video.viewCountObservedAt) - Date.parse(video.previousViewCountObservedAt!);
    return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MEME_GROWTH_MIN_INTERVAL_MS;
  });
  return tooShort
    ? { state: "too-short", text: "비교 기준과 24시간이 안 지나 속도를 계산하지 않았습니다. 24시간 이상 뒤에 다시 모아 주세요." }
    : { state: "invalid", text: "비교 기준과 조회수가 맞지 않아 속도를 계산하지 않았습니다. 조회수가 줄었거나 기준이 30일을 넘었을 수 있습니다." };
}

/** 영상 한 편의 반응·채널 규모 — 숨겨진 값은 「비공개」, 예전 캐시에서 없던 값은 「미수집」. */
export function videoReactions(video: MemeTrendVideo): string {
  const amount = (value: number | null | undefined, unit: string) =>
    value === undefined ? `${unit} 미수집` : value === null ? `${unit} 비공개` : `${unit} ${value.toLocaleString("ko-KR")}`;
  const parts = [amount(video.likeCount, "좋아요"), amount(video.commentCount, "댓글"), amount(video.channelSubscriberCount, "구독자")];
  if (video.viewCount !== null && typeof video.channelSubscriberCount === "number" && video.channelSubscriberCount > 0) {
    parts.push(`구독자 대비 ${perSubscriber(video.viewCount / video.channelSubscriberCount)}`);
  }
  return parts.join(" · ");
}

/** 처음엔 이만큼만 — 많게는 수십 편이라 선택 카드 아래가 영상 줄로 가득 차지 않게(나머지는 펼쳐 봅니다). */
const DETAIL_VIDEOS_SHOWN = 5;

function TrendDetail({ trend }: { trend: MemeTrend }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? trend.videos : trend.videos.slice(0, DETAIL_VIDEOS_SHOWN);
  const summary = growthSummary(trend.videos);
  const signals = trendSignals(trend);
  return (
    <section data-testid="meme-trend-detail" aria-label={`${trend.name} 묶인 영상`} className="mt-8 space-y-4 rounded-lg border border-line bg-ground-raised p-5">
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-bone">묶은 근거</h2>
        <EvidenceChips evidence={trend.evidence} withCounts />
        <p className="text-[11px] text-bone-faint">
          제목·설명·태그에서 본 글자 · 처음 본 수집 {formatDateTime(trend.firstObservedAt)} · 마지막으로 본 수집 {formatDateTime(trend.lastObservedAt)} · 서로 다른 채널 {trend.channelCount}곳
        </p>
        {summary && <p className="text-[11px] text-bone-faint" data-testid="meme-growth-summary" data-growth={summary.state}>{summary.text}</p>}
      </div>
      <dl data-testid="meme-trend-signals" className="grid gap-x-3 gap-y-1 text-[11px] sm:grid-cols-[auto_1fr]">
        <dt className="text-bone-faint">참여 확산</dt>
        <dd className="text-bone-dim">{signals.recent} · 전체 채널 {trend.channelCount}곳</dd>
        <dt className="text-bone-faint">속도</dt>
        <dd className="text-bone-dim">{signals.perHour} — 실측 증가가 있는 영상은 그 값, 없으면 게시 후 평균</dd>
        <dt className="text-bone-faint">구독자 대비</dt>
        <dd className="text-bone-dim" data-testid="meme-trend-per-subscriber">
          {trend.medianViewsPerSubscriber === undefined ? "미수집" : trend.medianViewsPerSubscriber === null ? "계산 안 됨(구독자 수 비공개)" : `조회수가 구독자의 ${perSubscriber(trend.medianViewsPerSubscriber)}(중간값)`}
          {/* 서버 순위 계산은 `viewCount / max(subscriberCount, 1000)` 이라 영상 줄의 실제 비율과 다를 수 있습니다(CLI 1358). */}
          {trend.medianViewsPerSubscriber !== undefined && trend.medianViewsPerSubscriber !== null && (
            <span className="text-bone-faint" data-testid="meme-trend-per-subscriber-note"> · 순위 계산은 구독자 1,000명 미만을 1,000명으로 계산</span>
          )}
        </dd>
        <dt className="text-bone-faint">찾은 경로</dt>
        <dd className="text-bone-dim" data-testid="meme-trend-sources">
          {trend.discoverySources && trend.discoverySources.length > 0 ? trend.discoverySources.map((source) => DISCOVERY_LABEL[source]).join(" · ") : "미수집"}
        </dd>
        {trend.songs && trend.songs.length > 0 && (
          <>
            <dt className="text-bone-faint">차트 곡</dt>
            <dd className="text-bone-dim" data-testid="meme-trend-songs">
              {trend.songs.map((song, index) => (
                <span key={`${song.regionCode}:${song.chartVideoId}`}>
                  {index > 0 ? " · " : ""}
                  <a href={`https://www.youtube.com/watch?v=${song.chartVideoId}`} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{song.title}</a>
                  {" "}({REGION_LABEL[song.regionCode]} 음악 차트)
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
      <ul className="divide-y divide-line" data-testid="meme-trend-videos">
        {shown.map((video) => (
          <li key={video.videoId} className="flex gap-3 py-3" data-testid={`meme-video-${video.videoId}`}>
            {video.thumbnailUrl
              ? <img src={video.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-16 w-28 flex-shrink-0 rounded object-cover" />
              : <span aria-hidden="true" className="h-16 w-28 flex-shrink-0 rounded bg-slate-950/40" />}
            <div className="min-w-0 flex-1 space-y-1">
              <a href={video.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm text-bone underline-offset-2 hover:underline">
                {video.title}
                <span className="sr-only"> (YouTube, 새 탭)</span>
              </a>
              <p className="text-[11px] text-bone-dim">
                {video.channelTitle} · 게시 {formatDateTime(video.publishedAt)}
              </p>
              <p className="text-[11px] text-bone-dim" data-testid={`meme-video-views-${video.videoId}`}>
                {video.viewCount === null ? "조회수 비공개" : `조회수 ${views(video.viewCount)}`}
                <span className="text-bone-faint"> ({formatDateTime(video.viewCountObservedAt)}에 읽음)</span>
                <Growth video={video} />
              </p>
              <p className="text-[11px] text-bone-faint" data-testid={`meme-video-reactions-${video.videoId}`}>{videoReactions(video)}</p>
            </div>
          </li>
        ))}
      </ul>
      {trend.videos.length > DETAIL_VIDEOS_SHOWN && (
        <button type="button" data-testid="meme-videos-toggle" className={smallOutlineButton} onClick={() => setShowAll((old) => !old)}>
          {showAll ? "영상 줄여 보기" : `나머지 영상 ${trend.videos.length - DETAIL_VIDEOS_SHOWN}편 더 보기`}
        </button>
      )}
    </section>
  );
}
