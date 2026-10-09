import { useEffect, useState } from "react";
import {
  MEME_GROWTH_MIN_INTERVAL_MS,
  MEME_TREND_MIN_CHANNELS,
  MEME_TREND_MIN_VIDEOS,
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
  const selected = trendId && feed ? feed.trends.find((trend) => trend.id === trendId) ?? null : null;
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
  const stageHint = [
    hasTrends ? "목록에서 밈 후보를 하나 고르세요." : "먼저 「YouTube에서 다시 모으기」로 후보를 모으세요.",
    "내 캐릭터를 고르고 「이 밈으로 만들기」를 누르세요. 분석과 장면 계획은 앱이 합니다.",
    "저장된 관찰 카드가 있습니다. 캐릭터를 고르고 「이 밈으로 만들기」를 누르거나, 아래에서 카드를 고쳐도 됩니다. 영상 제작은 만들어진 단기 프로젝트에서 이어집니다.",
  ][stage];

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
          출처: YouTube 공식 API · 한국 · 최근 4분 미만 영상 ·{" "}
          {feed?.collectedAt
            ? <>마지막 수집 <span data-testid="meme-trends-collected-at">{formatDateTime(feed.collectedAt)}</span></>
            : "아직 모은 적 없음"}
        </p>
        <p className="text-bone-faint">
          YouTube 밈 후보입니다. Instagram·TikTok 유행은 포함하지 않고, 영상 속 말·동작은 아직 분석하지 않았습니다.
          서로 다른 채널 {MEME_TREND_MIN_CHANNELS}곳 이상, 영상 {MEME_TREND_MIN_VIDEOS}편 이상에서 같은 해시태그·문구가 보인 것만 묶었습니다.
        </p>
      </div>

      {/* 🟠 스크롤해도 따라옵니다 — 후보를 고르면 상세·관찰 카드가 아래로 길게 이어져, 띠가 화면 밖으로 나가면 「어디까지 왔나」를 잃습니다. */}
      <div className="sticky top-0 z-10 -mx-1 mt-5 bg-ground px-1 py-2" data-testid="meme-flow">
        <StepRibbon steps={steps} currentIndex={stage} />
        <p className="mt-2 text-xs text-bone-dim" data-testid="meme-flow-hint">{stageHint}</p>
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
          마지막 수집이 {Math.floor(hoursSince(feed.collectedAt, now))}시간 전입니다. 아래 조회수는 그때 읽은 값이라 지금과 다를 수 있습니다.
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
        <div className="mt-4 flex items-center gap-3 text-xs text-bone-dim">
          <span>고른 밈 후보만 보이고 있습니다.</span>
          <button type="button" data-testid="meme-trends-show-all" className={smallOutlineButton} onClick={() => onSelect(undefined)}>다른 밈 고르기</button>
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

      {selected && feed?.collectedAt && <MemeQuickMake key={`quick-${selected.id}`} trend={selected} onOpenSettings={onOpenSettings} onProjectCreated={onProjectCreated} />}
      {selected && feed?.collectedAt && <TrendDetail trend={selected} />}
      {/* ② 관찰 카드 — 후보마다 따로 저장되므로 후보가 바뀌면 새로 엽니다(key). 열 때는 저장본만 읽습니다. */}
      {selected && feed?.collectedAt && (
        <details className="mt-6" data-testid="meme-observations-details">
          <summary className="cursor-pointer text-xs text-bone-dim hover:text-bone">직접 관찰 카드 확인·고치기 (선택)</summary>
          <MemeObservationPanel key={selected.id} trend={selected} onOpenSettings={onOpenSettings} onProjectCreated={onProjectCreated} onSavedCardCount={(count) => setSavedCards({ trendId: selected.id, count })} />
        </details>
      )}

      <p className="mt-9 border-t border-line pt-3 text-[11px] text-bone-faint">
        조회수는 YouTube가 준 값을 그대로, 읽은 시각과 함께 적습니다. 점수를 매기거나 다른 출처의 숫자를 더하지 않습니다.
      </p>
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
        <EvidenceChips evidence={trend.evidence.slice(0, 3)} />
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
 * 이전 값이 없는 까닭은 단정하지 않습니다 — 첫 수집일 수도, 백엔드가 감소·30일 경과로 기준을 비운 것일 수도 있습니다.
 */
function Growth({ video }: { video: MemeTrendVideo }) {
  const testId = `meme-video-growth-${video.videoId}`;
  if (video.viewCount === null) return null;
  if (video.previousViewCount === undefined || video.previousViewCountObservedAt === undefined) {
    return (
      <span className="block text-bone-faint" data-testid={testId} data-growth="no-baseline">
        비교할 이전 조회수가 없습니다. 24시간 이상 간격으로 다시 모아 주세요.
      </span>
    );
  }
  const growth = memeVideoGrowth(video);
  if (growth) {
    return (
      <span className="block text-bone-dim" data-testid={testId} data-growth="measured">
        관찰 기간 평균 +{growth.viewsPerDay.toLocaleString("ko-KR")}회/일
        <span className="text-bone-faint">
          {" "}· 실제 +{growth.viewsGained.toLocaleString("ko-KR")}회 · 비교 기준 {formatDateTime(video.previousViewCountObservedAt)} → {formatDateTime(video.viewCountObservedAt)}
        </span>
      </span>
    );
  }
  const elapsedMs = Date.parse(video.viewCountObservedAt) - Date.parse(video.previousViewCountObservedAt);
  const tooShort = Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < MEME_GROWTH_MIN_INTERVAL_MS;
  return (
    <span className="block text-bone-faint" data-testid={testId} data-growth={tooShort ? "too-short" : "invalid"}>
      {tooShort
        ? "비교 기준(" + formatDateTime(video.previousViewCountObservedAt) + ")과 24시간이 안 지나 속도를 계산하지 않았습니다. 24시간 이상 뒤에 다시 모아 주세요."
        : "비교 기준과 조회수가 맞지 않아 속도를 계산하지 않았습니다. 조회수가 줄었거나 기준이 30일을 넘었을 수 있습니다."}
    </span>
  );
}

function TrendDetail({ trend }: { trend: MemeTrend }) {
  return (
    <section data-testid="meme-trend-detail" aria-label={`${trend.name} 묶인 영상`} className="mt-8 space-y-4 rounded-lg border border-line bg-ground-raised p-5">
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-bone">{trend.name}</h2>
        <p className="text-xs text-bone-dim">
          같은 밈으로 묶은 근거 — 제목·설명·태그에서 실제로 본 글자입니다. 영상 내용은 아직 보지 않았습니다.
        </p>
        <EvidenceChips evidence={trend.evidence} withCounts />
        <p className="text-[11px] text-bone-faint">
          처음 본 수집 {formatDateTime(trend.firstObservedAt)} · 마지막으로 본 수집 {formatDateTime(trend.lastObservedAt)} · 서로 다른 채널 {trend.channelCount}곳
        </p>
      </div>
      <ul className="divide-y divide-line" data-testid="meme-trend-videos">
        {trend.videos.map((video) => (
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
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
