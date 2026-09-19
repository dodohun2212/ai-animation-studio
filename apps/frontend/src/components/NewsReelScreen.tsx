import { useEffect, useMemo, useState } from "react";

import { NEWS_CHECK_SCOPE_NOTICE, checkNewsSummary, type NewsClaimCheck, type NewsDailyCallCount, type NewsFetchRefusalReason, type NewsPublisher } from "@ai-animation-studio/shared";
import { NEWS_LEDGER_UNREADABLE_MESSAGE, NewsApiError, createNewsSummary, fetchNewsArticle, getNewsReelSetup } from "../api/newsApi.js";
import { ScreenHeader } from "./ui/ScreenHeader.js";
import { Spinner } from "./Spinner.js";
import { cardSectionRoomy as cardSection, outlineButton, primaryButton } from "./ui/surfaces.js";

interface Props {
  onBack: () => void;
  /**
   * Hands the verified summary and its source line to the card flow.
   *
   * 🔴 Only ever called with a summary that passed the check. The button that calls it is disabled otherwise,
   * and that is deliberate rather than a warning: a person who is told "this might be wrong" and given a
   * working button presses the button.
   */
  onUseSummary: (quote: string, sourceLine: string) => void;
}

const field = "w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600";
const label = "block text-sm text-slate-300";

/** 화면이 못 찾은 것을 무엇이라 부를지 — 사람이 고칠 자리를 가리키는 말로. */
const CLAIM_LABEL: Record<NewsClaimCheck["kind"], string> = {
  number: "숫자",
  date: "날짜",
  quote: "따옴표 안의 말",
};

/**
 * 거절 넷은 **사람이 할 일이 전부 다릅니다.** 그래서 네 문장이고, 하나로 줄이지 않습니다.
 *
 * 🔴 `private_address` 가 「다른 언론사로 해 보세요」로 읽히면 안 됩니다(CLI Round 929 §3). 자기 공유기 주소를
 * 붙여 넣은 사람은 신문사 하나 차이로 성공하는 게 아니라 **주소를 잘못 가져온 것**입니다.
 */
const REFUSAL_MESSAGE: Record<NewsFetchRefusalReason, string> = {
  publisher_not_allowed: "이 언론사는 아직 넣을 수 없습니다. 아래 목록의 언론사 기사 주소를 넣어 주세요.",
  private_address: "이 주소는 기사가 아니라 이 컴퓨터나 같은 네트워크 안을 가리킵니다. 주소를 다시 확인해 주세요.",
  unsupported_address: "이 주소로는 기사를 가져올 수 없습니다. https 로 시작하는 기사 주소를 넣어 주세요.",
  too_many_redirects: "주소가 계속 다른 곳으로 넘겨서 끝까지 따라가지 못했습니다. 기사 본문 주소를 직접 넣어 주세요.",
  /**
   * 🟠 CLI Round 940 에서 실측으로 갈라져 나온 갈래입니다. 조선일보 첫 페이지가 3.3MB 라 여기 걸리는데,
   * `unsupported_address` 에 묶여 있을 때는 **이미 https 로 시작하는 주소**를 두고 「https 로 시작하는 주소를
   * 넣어 주세요」라고 말했습니다. 여기서 할 일은 다른 갈래와 달라서 — **첫 화면 말고 기사 하나를 가리키는 것**.
   */
  /* 🟠 「목록이나 첫 화면으로 보입니다」로 **단정**하지 않습니다. 서버가 아는 건 「너무 커서 읽다 멈췄다」뿐이고,
     그게 첫 화면인 건 **제일 흔한 이유지 확인된 사실이 아닙니다.** 진짜로 큰 기사 페이지일 수도 있는데, 그때
     「이건 목록입니다」는 사람이 자기 눈으로 보고 있는 것과 싸웁니다 — 그러면 문장을 안 믿고 같은 주소를 다시
     넣습니다. 그래서 **한 일 → 흔한 이유 → 할 일** 순서로 적습니다. */
  page_too_large: "이 페이지는 기사 하나로 보기엔 너무 커서 읽다가 멈췄습니다. 첫 화면이나 기사 목록 주소일 때 흔히 그렇습니다 — 읽고 싶은 기사를 열어서 그 주소를 넣어 주세요.",
};

type Setup =
  | { status: "loading" }
  | { status: "ready"; publishers: NewsPublisher[] }
  | { status: "error" };

/** 가져오기 한 번의 결과 — 네 갈래가 화면에서 서로 다른 모양이라 값도 따로 듭니다. */
type FetchNotice =
  | { kind: "fetched"; publisher: string }
  | { kind: "body_not_found" }
  | { kind: "unreachable" }
  | { kind: "refused"; reason: NewsFetchRefusalReason; publishers: NewsPublisher[] }
  | { kind: "error"; message: string };

function messageOf(caught: unknown): string {
  return caught instanceof NewsApiError ? caught.message : "기사를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

/**
 * 기사 하나를 릴 한 편으로 — 요약이 기사 안에서만 말하는지 확인한 뒤에.
 *
 * 🔴 이 화면의 존재 이유는 편의가 아니라 **막는 것**입니다. 요약을 AI 에게 시키면 원문에 없는 숫자·날짜·
 * 인용문을 그럴듯하게 지어냅니다. 꽃말 릴이면 시시하지만 뉴스는 틀린 사실이 예쁘게 만들어져 퍼집니다.
 * 그래서 대조를 통과하기 전에는 카드로 넘어가는 버튼이 눌리지 않습니다.
 *
 * 🔴 **주소를 넣으면 서버가 가져옵니다. 화면은 그 주소를 미리 거르지 않습니다.** 언론사 목록은 사람에게
 * **보여 주려고** 오는 것이지 화면이 판정하라고 오는 것이 아닙니다 — 정말로 중요한 호스트는 리다이렉트가 마지막에
 * 떨어지는 곳이고 그건 서버만 봅니다(CLI Round 929 §2). 여기서 미리 걸러 주면 친절해 보이지만, **진짜 검사가
 * 존재하는 이유인 바로 그 주소들에 대해 틀린** 두 번째 사본이 됩니다. 짝이 그 손길을 막고 있습니다.
 *
 * 🟠 붙여넣기 길은 없어지지 않았습니다. 추출기가 본문 상자를 못 알아보면 **그 자리에서** 본문 칸이 열리고
 * 주소·언론사·제목·발행일은 채워진 채로 남습니다. 파서를 완벽하게 만드는 것보다 후퇴 경로가 있는 쪽이 쌉니다.
 */
export function NewsReelScreen({ onBack, onUseSummary }: Props) {
  const [setup, setSetup] = useState<Setup>({ status: "loading" });
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [notice, setNotice] = useState<FetchNotice | null>(null);

  const [title, setTitle] = useState("");
  const [articleText, setArticleText] = useState("");
  const [outlet, setOutlet] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [summary, setSummary] = useState("");

  /* 🔴 이제 이 수를 깎는 버튼이 생겼으니 그립니다(940 까지는 일부러 안 그렸습니다 — 아무것도 안 깎는 잔량을
     보여 주는 셈이었으니까요). `null` 은 **「예산 있음」이 아니라 「모르니까 안 부른다」**입니다. */
  const [dailyCalls, setDailyCalls] = useState<NewsDailyCallCount | null>(null);
  /* 🟠 서버가 「오늘 다 썼다」고 말한 순간을 따로 듭니다. 거절은 예외 경로라 새 건수를 안 싣고 오는데, 그때
     제가 들고 있는 수는 **한 번 낡은 것**입니다 — 그 낡은 수로 버튼을 열어 두면 다음 누름이 또 거절됩니다. */
  const [limitReached, setLimitReached] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [tooLong, setTooLong] = useState(false);

  useEffect(() => {
    let live = true;
    getNewsReelSetup()
      .then((response) => {
        if (!live) return;
        setSetup({ status: "ready", publishers: response.publishers });
        setDailyCalls(response.dailyCalls);
      })
      .catch(() => { if (live) setSetup({ status: "error" }); });
    return () => { live = false; };
  }, []);

  async function load(): Promise<void> {
    const typed = url.trim();
    if (!typed || fetching) return;
    setFetching(true);
    setNotice(null);
    try {
      const response = await fetchNewsArticle(typed);
      if (response.outcome === "article") {
        const { article } = response;
        setTitle(article.title);
        setArticleText(article.body);
        setOutlet(article.publisher);
        setPublishedAt(article.publishedAt);
        setSourceUrl(article.sourceUrl);
        setNotice({ kind: "fetched", publisher: article.publisher });
      } else if (response.outcome === "body_not_found") {
        /* 🔴 실패가 아닙니다. 서버는 문을 두드렸고 페이지를 받았고 어느 부분이 기사인지 못 갈랐습니다 — 남은 한
           걸음이 사람의 것일 뿐입니다. 그래서 채울 수 있는 건 전부 채워 두고 본문 칸만 비웁니다. */
        setTitle(response.title);
        setArticleText("");
        setOutlet(response.publisher);
        setPublishedAt(response.publishedAt ?? "");
        setSourceUrl(response.sourceUrl);
        setNotice({ kind: "body_not_found" });
      } else if (response.outcome === "unreachable") {
        setSourceUrl(response.sourceUrl);
        setNotice({ kind: "unreachable" });
      } else {
        setNotice({ kind: "refused", reason: response.reason, publishers: response.publishers });
      }
    } catch (caught) {
      setNotice({ kind: "error", message: messageOf(caught) });
    } finally {
      setFetching(false);
    }
  }

  /**
   * 🔴 **이 화면에서 오늘 쓸 수 있는 횟수를 깎는 유일한 버튼입니다.** 기사 가져오기는 공짜고 이것만 셉니다 —
   * 두 버튼을 같은 모양으로 그리면 사람은 가져오기를 몇 번 눌러 보다가 하루치를 태운 줄 알게 됩니다(927 §4).
   *
   * 🔴 받은 `check` 를 **일부러** 그리지 않습니다. 이유는 「같은 함수라 결과가 같아서」가 아닙니다 — 그건
   * 도착한 그 순간에만 참입니다(CLI 945 §1 이 여섯 모양으로 재 봤고 전부 같았습니다). 사람이 본문 칸을 한 글자라도
   * 손대는 순간 둘은 갈라지고, 그때 **맞는 쪽은 화면입니다**: 화면의 대조는 **지금 화면에 있는 글**에 대한 답이고,
   * 서버의 `check` 는 **그때 보낸 글**에 대한 답입니다. 실측(945 §1) — 사람이 본문을 줄이면 서버는 `missing: []`
   * (초록)인데 화면은 없어진 날짜를 집어냅니다. 둘 다 그렸으면 그 초록 한 줄이 남아서 **방금 짧아진 본문을 보증**합니다.
   *
   * 그래서 계약이 `check` 를 계속 돌려주는 것도 맞습니다 — 다시 계산하지 않는 클라이언트에는 그게 유일한 근거고,
   * **호출 시점에 참이었던 것의 기록**이기도 합니다. 이 화면은 다시 계산하는 쪽이라 살아 있는 것만 그립니다.
   */
  async function summarise(): Promise<void> {
    if (summarizing || !canSummarise) return;
    setSummarizing(true);
    setSummaryError(null);
    setTooLong(false);
    try {
      const response = await createNewsSummary({
        title: title.trim(),
        body: trimmedArticle,
        publisher: outlet.trim(),
        publishedAt: publishedAt.trim(),
        sourceUrl: sourceUrl.trim(),
      });
      setSummary(response.summary);
      setDailyCalls(response.dailyCalls);
      setTooLong(response.tooLong === true);
    } catch (caught) {
      setSummaryError(messageOf(caught));
      /* 🔴 서버가 한도를 말했으면 제가 들고 있는 수와 관계없이 닫습니다 — 거절은 새 건수를 안 싣고 옵니다. */
      if (caught instanceof NewsApiError && caught.code === "NEWS_DAILY_LIMIT_REACHED") setLimitReached(true);
    } finally {
      setSummarizing(false);
    }
  }

  const trimmedSummary = summary.trim();
  const trimmedArticle = articleText.trim();
  const ready = trimmedSummary.length > 0 && trimmedArticle.length > 0;

  /* 글자를 칠 때마다 다시 봅니다 — 순수 함수라 서버도 돈도 안 듭니다. 「확인」 버튼을 따로 두면 사람이
     누르지 않은 채로 넘어갈 수 있고, 그러면 막는 장치가 있으나 마나입니다. */
  const check = useMemo(
    () => (ready ? checkNewsSummary(trimmedSummary, trimmedArticle) : { claims: [], missing: [] }),
    [ready, trimmedSummary, trimmedArticle],
  );

  const blocked = check.missing.length > 0;
  const sourceLine = [outlet.trim(), publishedAt.trim(), sourceUrl.trim()].filter((part) => part.length > 0).join(" · ");

  /* 🔴 `dailyCalls === null` 은 **막힘**입니다 — 「모르니까 안 부른다」이지 「여유 있음」이 아닙니다. 남은 수가
     0 이어도, 서버가 한도를 말한 뒤에도 닫힙니다. 그리고 본문이 없으면 애초에 요약할 것이 없습니다. */
  const callsLeft = dailyCalls ? Math.max(0, dailyCalls.limit - dailyCalls.used) : 0;
  const canSummarise = trimmedArticle.length > 0 && dailyCalls !== null && callsLeft > 0 && !limitReached;

  /* 거절이 들고 온 목록이 있으면 그걸 씁니다 — 화면이 오래 열려 있었을 수 있고, 거절에 실려 온 쪽이 그 순간의
     사실입니다(CLI Round 932 §2). */
  const publishers = notice?.kind === "refused" ? notice.publishers
    : setup.status === "ready" ? setup.publishers
      : [];

  return (
    <div className="space-y-6">
      <ScreenHeader title="뉴스 릴 만들기" backLabel="돌아가기" onBack={onBack} />

      <section className={cardSection} aria-label="기사 주소">
        <h2 className="text-sm font-semibold text-slate-100">기사 주소</h2>
        <p className="mt-1 text-xs text-slate-500">주소를 넣으면 서버가 기사를 가져옵니다. 가져오기는 비용이 들지 않습니다.</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="news-fetch-url-input">기사 주소</label>
          <input
            id="news-fetch-url-input"
            data-testid="news-fetch-url"
            className={`${field} flex-1`}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://..."
          />
          {/* 🔴 `disabled` 조건에 언론사 목록이 없습니다. 목록에 없는 주소여도 눌리고 서버로 갑니다 — 거절은
              서버가 합니다. 짝이 이 줄을 붙들고 있습니다. */}
          <button
            type="button"
            data-testid="news-fetch"
            className={outlineButton}
            disabled={fetching || url.trim().length === 0}
            onClick={() => void load()}
          >
            {fetching ? "가져오는 중..." : "기사 가져오기"}
          </button>
        </div>

        {fetching && <div className="mt-3"><Spinner label="기사를 가져오는 중..." /></div>}

        {notice?.kind === "fetched" && (
          <p className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300" data-testid="news-fetch-ok">
            {notice.publisher} 기사를 가져왔습니다. 아래에서 본문을 확인하신 뒤 요약을 적어 주세요.
          </p>
        )}

        {/* 🔴 앰버입니다. 빨강이 아닙니다 — 아무것도 실패하지 않았습니다. */}
        {notice?.kind === "body_not_found" && (
          <div className="mt-3 space-y-1 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3" data-testid="news-fetch-body-not-found">
            <p className="text-sm font-semibold text-amber-300">기사 본문을 찾지 못했습니다 — 아래에 붙여넣어 주세요.</p>
            <p className="text-xs text-slate-300">
              페이지는 받았는데 어디부터 어디까지가 기사인지 가려내지 못했습니다. <strong className="text-slate-200">주소·언론사·제목·발행일은 채워 뒀으니</strong> 본문만 복사해 붙여넣으시면 됩니다.
            </p>
          </div>
        )}

        {notice?.kind === "unreachable" && (
          <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300" data-testid="news-fetch-unreachable">
            그 주소에 연결하지 못했습니다. 잠시 후 다시 시도하시거나, 기사 본문을 아래에 붙여넣어 주세요.
          </p>
        )}

        {notice?.kind === "refused" && (
          <p role="alert" className="mt-3 rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200" data-testid="news-fetch-refused" data-reason={notice.reason}>
            {REFUSAL_MESSAGE[notice.reason]}
          </p>
        )}

        {notice?.kind === "error" && (
          <p role="alert" className="mt-3 rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200" data-testid="news-fetch-error">
            {notice.message}
          </p>
        )}

        {/* 🔴 목록은 막히기 전에 보입니다. 거절당한 뒤에만 보이면 그건 안내가 아니라 설명입니다 — 그리고 여기에
            목록이 없으면 제가 「주요 종합지 기사를 넣어 주세요」 같은 문장을 손으로 적게 되고, 그 순간 목록이
            두 벌이 됩니다(Cowork Round 931 §2). 판정은 서버가 하고, 화면은 말만 합니다. */}
        <div className="mt-4 border-t border-white/10 pt-3">
          {setup.status === "loading" && <p className="text-xs text-slate-500" data-testid="news-publishers-loading">넣을 수 있는 언론사를 불러오는 중...</p>}
          {setup.status === "error" && publishers.length === 0 && (
            <p className="text-xs text-amber-300" data-testid="news-publishers-error">
              넣을 수 있는 언론사 목록을 불러오지 못했습니다. 주소를 넣어 보시면 서버가 되는지 알려 줍니다.
            </p>
          )}
          {publishers.length > 0 && (
            <>
              <p className="text-xs text-slate-500">넣을 수 있는 언론사</p>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1" data-testid="news-publishers">
                {publishers.map((one) => (
                  <li key={one.host} className="text-xs text-slate-400">
                    {one.name} <span className="text-slate-600">{one.host}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <section className={cardSection} aria-label="기사">
        <h2 className="text-sm font-semibold text-slate-100">기사</h2>
        <p className="mt-1 text-xs text-slate-500">
          요약이 기사 안에서만 말하는지 대조하려면 <strong className="text-slate-300">본문이 있어야 합니다.</strong> 위에서 가져왔으면 채워져 있고, 아니면 붙여넣어 주세요.
        </p>
        <div className="mt-4 space-y-3">
          <label className={label}>
            제목
            <input data-testid="news-title" className={`${field} mt-1`} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className={label}>
            본문
            <textarea
              data-testid="news-article"
              rows={10}
              className={`${field} mt-1`}
              value={articleText}
              onChange={(event) => setArticleText(event.target.value)}
              placeholder="기사 본문을 그대로 붙여넣어 주세요."
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={label}>
              언론사
              <input data-testid="news-outlet" className={`${field} mt-1`} value={outlet} onChange={(event) => setOutlet(event.target.value)} />
            </label>
            <label className={label}>
              발행일
              <input data-testid="news-published" className={`${field} mt-1`} value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} placeholder="2026-09-17" />
            </label>
            <label className={label}>
              원문 링크
              <input data-testid="news-url" className={`${field} mt-1`} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} />
            </label>
          </div>
        </div>
      </section>

      <section className={cardSection} aria-label="요약">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-100">요약</h2>
          {dailyCalls && (
            <span className="text-xs tabular-nums text-slate-500" data-testid="news-daily-calls">
              오늘 쓴 요약 {dailyCalls.used} / {dailyCalls.limit}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">릴에 들어갈 문장입니다. 첫 줄이 제목처럼 크게 들어갑니다. 직접 쓰셔도 되고, 아래 버튼으로 뽑으셔도 됩니다.</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            data-testid="news-summarize"
            className={outlineButton}
            disabled={summarizing || !canSummarise}
            onClick={() => void summarise()}
          >
            {summarizing ? "요약을 받는 중..." : "AI로 요약 뽑기"}
          </button>
          {/* 🔴 값을 버튼 옆에 적습니다. 위 「기사 가져오기」는 공짜라 아무 말도 안 하는데, 둘이 같은 모양이면
              사람은 **어느 쪽이 깎는지 모른 채** 누릅니다(927 §4). */}
          <span className="text-xs text-slate-500">
            {dailyCalls ? `누를 때마다 하나씩 씁니다 — 오늘 ${callsLeft}번 남았습니다.` : "누를 때마다 오늘 쓸 수 있는 횟수를 하나 씁니다."}
          </span>
        </div>

        {/* 🔴 「모르니까 안 부른다」입니다. 숫자 자리를 비워 두거나 0 으로 그리면 「여유 있음」으로 읽힙니다. */}
        {dailyCalls === null && setup.status === "ready" && (
          <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300" data-testid="news-calls-unknown">
            {NEWS_LEDGER_UNREADABLE_MESSAGE}
          </p>
        )}

        {summaryError && (
          <p role="alert" className="mt-3 rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200" data-testid="news-summary-error">
            {summaryError}
          </p>
        )}

        {/* 🟠 자르지 않고 알립니다. 길이로 자르면 `4,000` 이 `4,0` 이 되고, 그러면 **대조기가 우리 편집을 보고
            「지어냈다」**고 합니다 — 어느 문장을 버릴지는 읽은 사람이 정할 일입니다(CLI 943 §1). */}
        {tooLong && (
          <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300" data-testid="news-summary-too-long">
            요약이 카드에 들어가기엔 깁니다. 그대로 두었으니 <strong>뺄 문장을 직접 골라</strong> 줄여 주세요 — 저희가 잘라내면 숫자가 반토막 나서 아래 대조가 엉뚱하게 걸립니다.
          </p>
        )}

        <textarea
          data-testid="news-summary"
          rows={5}
          className={`${field} mt-3`}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="기사가 말하는 것만 적어 주세요."
        />
      </section>

      <section className={cardSection} aria-label="원문 대조">
        <h2 className="text-sm font-semibold text-slate-100">원문 대조</h2>

        {!ready && (
          <p className="mt-2 text-sm text-slate-400" data-testid="news-check-idle">
            기사 본문과 요약을 채우면 여기서 대조합니다.
          </p>
        )}

        {ready && blocked && (
          <div className="mt-3 space-y-2 rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3" data-testid="news-check-failed">
            <p className="text-sm font-semibold text-rose-200">
              요약에 기사에서 찾을 수 없는 것이 {check.missing.length}개 있습니다.
            </p>
            <ul className="space-y-1">
              {check.missing.map((claim) => (
                <li key={`${claim.kind}:${claim.text}`} className="text-sm text-rose-200" data-testid={`news-unverified-${claim.kind}`}>
                  {CLAIM_LABEL[claim.kind]} <strong className="font-semibold">{claim.text}</strong> — 기사 본문에 없습니다.
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-300">
              지어낸 값일 수도 있고, 기사에 있는데 다르게 적으신 것일 수도 있습니다. 기사에 적힌 그대로 고치거나, 그 문장을 빼 주세요.
            </p>
          </div>
        )}

        {ready && !blocked && check.claims.length > 0 && (
          <p className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300" data-testid="news-check-passed">
            요약의 숫자·날짜·인용문 {check.claims.length}개를 기사 본문에서 찾았습니다.
          </p>
        )}

        {/* 🔴 「검사할 게 없었다」와 「통과했다」는 다른 사실입니다. 숫자도 날짜도 따옴표도 없는 요약은 이
            검사가 아무것도 보지 못한 것이고, 초록으로 칠하면 보지 않은 것을 봤다고 말하는 셈입니다. */}
        {ready && !blocked && check.claims.length === 0 && (
          <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300" data-testid="news-check-empty">
            이 요약에는 대조할 숫자·날짜·인용문이 없습니다. 막지는 않지만, <strong>확인된 것도 없습니다.</strong>
          </p>
        )}

        {/* 🔴 이 검사의 한계를 화면이 직접 말합니다. 안 적으면 초록 한 줄이 「사실 확인 끝」으로 읽히고,
            그건 이 화면이 막으려던 것보다 더 나쁜 오해입니다. */}
        <p className="mt-3 text-xs text-slate-500" data-testid="news-check-limit">
          {NEWS_CHECK_SCOPE_NOTICE}
        </p>
      </section>

      <section className={cardSection} aria-label="출처">
        <h2 className="text-sm font-semibold text-slate-100">출처</h2>
        <p className="mt-1 text-xs text-slate-500">화면과 캡션에 이 줄이 같이 들어갑니다. 요약은 기사의 것이지 우리 것이 아닙니다.</p>
        <p className="mt-3 break-all text-sm text-slate-300" data-testid="news-source-line">
          {sourceLine || "언론사·발행일·링크를 채워 주세요."}
        </p>
      </section>

      <button
        type="button"
        data-testid="news-use-summary"
        className={primaryButton}
        disabled={!ready || blocked || sourceLine.length === 0}
        onClick={() => onUseSummary(trimmedSummary, sourceLine)}
      >
        이 요약으로 카드 만들기
      </button>
      {ready && blocked && (
        <p className="text-xs text-slate-500" data-testid="news-use-blocked-why">
          대조에서 걸린 것을 고쳐야 넘어갈 수 있습니다.
        </p>
      )}
    </div>
  );
}
