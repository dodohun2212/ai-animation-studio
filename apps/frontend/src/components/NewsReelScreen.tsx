import { useEffect, useMemo, useState } from "react";

import { NEWS_CHECK_SCOPE_NOTICE, NEWS_REEL_TEXT_FIELDS, checkNewsSummary, newsReelTextBox, type NewsClaimCheck, type NewsDailyCallCount, type NewsFeedItem, type NewsFetchRefusalReason, type NewsPublisher, type NewsPublisherBody, type NewsReelTextField } from "@ai-animation-studio/shared";
import { NEWS_LEDGER_UNREADABLE_MESSAGE, NewsApiError, createNewsReelCardText, createNewsSummary, fetchNewsArticle, getNewsFeed, getNewsReelSetup } from "../api/newsApi.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { ScreenHeader } from "./ui/ScreenHeader.js";
import { Spinner } from "./Spinner.js";
import { cardSectionRoomy as cardSection, outlineButton, primaryButton } from "./ui/surfaces.js";
import { CountedField, newsReelFieldValue } from "./ui/CountedField.js";
import type { NewsReelDraft } from "./NewsReelCreateScreen.js";
import { PicturePicker } from "./ui/PicturePicker.js";
import { PHOTO_CARD_DURATIONS, PHOTO_CARD_MAX_PICTURES, type Asset, type PhotoCardDurationSeconds } from "@ai-animation-studio/shared";
import { listAssets, toAssetDisplayError } from "../api/assetsApi.js";

interface Props {
  onBack: () => void;
  /**
   * 기사와 **고른 그림들**을 글 쓰는 화면으로 넘깁니다.
   *
   * 🔴 **그림이 먼저인 이유**: 자막이 장면마다 하나라, **몇 장을 골랐는지 알아야** 자막 칸을 몇 개 열지 압니다.
   * 「글 뽑기」도 모델에게 장면 수를 말해 줘야 그만큼 받아 옵니다(CLI 1067 §1). 글을 먼저 쓰면 그 수를
   * 모르는 채로 쓰게 됩니다 — 캡틴D: *「릴스가 몇 장면 몇 분인 줄 알고 이렇게 적음?」*
   */
  onNext: (draft: NewsReelDraft) => void;
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

/**
 * 기사 목록의 세 상태.
 *
 * 🟠 `error` 가 화면을 막지 않습니다 — 주소를 손으로 넣는 길이 **원래 길**이고 목록은 지름길입니다.
 * 지름길이 막혔다고 큰길을 빨갛게 칠하지 않습니다.
 */
type Feed =
  | { status: "loading" }
  | { status: "ready"; items: NewsFeedItem[]; unavailable: NewsPublisher[] }
  | { status: "error" };

/**
 * 기사 한 줄에 적을 시각.
 *
 * 🔴 `publishedAt` 이 `null` 인 건 **오류가 아니라 피드가 안 줬다는 것**입니다. 「알 수 없음」이라고 쓰면
 * 화면이 못 한 일처럼 읽히고, 빈칸으로 두면 줄이 흔들립니다 — **없다는 걸 그대로** 적습니다.
 */
/**
 * 목록에서 한 줄을 남길지.
 *
 * 🟠 **제목과 언론사 둘 다** 봅니다 — 「연합」이라고 치면 언론사로 걸러지고, 「아시안게임」이면 제목으로 걸러집니다.
 * 칸 하나로 둘을 다 하는 대신, 언론사 단추를 따로 두지 않았습니다.
 *
 * 🔴 **주소는 안 봅니다.** 주소에는 `yna.co.kr` 같은 말이 들어 있어서, 「co」 두 글자에 백열 줄이 전부 걸립니다.
 */
export function matchesFeedQuery(item: NewsFeedItem, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return true;
  return item.title.toLowerCase().includes(wanted) || item.publisher.toLowerCase().includes(wanted);
}

/**
 * 속보인가 — **제목으로만** 봅니다.
 *
 * 🔴 **누르기 전에 말하려고** 있습니다. 속보는 본문이 한두 문장이라 서버의 400자 칸(「크롤러용 요약 토막을
 * 본문으로 받지 않는다」)에 걸려 `body_not_found` 가 됩니다 — 고장이 아니라 **기사가 얇은 것**인데, 누른 뒤에
 * 「본문을 못 찾았습니다」만 뜨면 사람은 앱이 깨진 줄 압니다(캡틴D, 실측 4/4).
 *
 * 🟠 **막지는 않습니다.** 속보에도 본문이 붙는 날이 있고, 붙여넣으면 그대로 됩니다 — 말해 주기만 합니다.
 *
 * 🟠 제목 맨 앞의 대괄호만 봅니다. 「[속보]」와 「[1보]」는 같은 것이고, 「[종합]」은 본문이 있는 기사라
 * 여기 안 넣습니다.
 */
export function feedItemIsFlash(title: string): boolean {
  return /^\s*\[\s*(?:속보|1보|긴급)\s*\]/.test(title);
}

export function feedItemTime(publishedAt: string | null): string {
  return publishedAt === null ? "시각 없음" : formatDateTime(publishedAt);
}

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
/**
 * 언론사 목록을 **네 답으로 나눠** 그립니다 — 이 화면에서 제일 자주 나올 질문이 「왜 이건 붙여넣어야 하나」라서요.
 *
 * 🔴 네 답은 서버가 **재 본 결과**지 이 화면의 짐작이 아닙니다(`NewsPublisherBody`). 그래서 여기서 하는 일은
 * 딱 하나 — **재 본 것을 재 본 대로 말하는 것**입니다. 특히 `unknown` 은 「아마 될 것」도 「안 될 것」도 아니라,
 * **아직 아무도 안 봤다**는 뜻입니다. 둘 중 하나로 그리면 그 순간 화면이 서버가 하지 않은 약속을 합니다.
 *
 * 🟠 `paste` 의 문장이 제일 중요합니다. 「지금은 안 됩니다」로 적으면 사람이 **기다립니다** — 그런데 이건
 * 기다려서 되는 종류가 아닙니다. 본문이 문서 안에 아예 없으면 어떤 파서도 주소만으로는 못 읽습니다.
 *
 * 🟠 다섯째 값이 오는 경우는 **여기서 막지 않습니다.** `isNewsReelSetupResponse` 가 네 개 중 하나가 아니면
 * 응답 자체를 거절하므로, 화면까지 오지 못합니다. 대신 아래 `Record<NewsPublisherBody, ...>` 가
 * **계약에 다섯째가 생기면 이 파일을 컴파일 에러로 세웁니다** — 그게 이 층에서 할 수 있는 몫입니다.
 */
const PUBLISHER_GROUPS: Record<NewsPublisherBody, { title: string; note: string; tone: string }> = {
  address: {
    title: "주소만 넣으면 됩니다",
    note: "재 본 기사가 전부 주소만으로 읽혔습니다.",
    tone: "text-emerald-300",
  },
  varies: {
    title: "기사마다 다릅니다",
    note: "같은 언론사인데 읽히는 기사와 안 읽히는 기사가 있었습니다. 넣어 보시고, 본문이 비어 있으면 그때 붙여넣어 주세요.",
    tone: "text-amber-300",
  },
  unknown: {
    title: "아직 재 보지 않았습니다",
    note: "된다고도 안 된다고도 말씀드릴 수 없습니다. 주소를 넣어 보시면 서버가 그 자리에서 알려 줍니다.",
    tone: "text-slate-300",
  },
  paste: {
    title: "늘 붙여넣어야 합니다",
    note: "본문이 문서 안에 아예 없어서, 주소만으로는 어떤 도구도 읽지 못합니다. 기다리면 되는 종류가 아닙니다 — 기사를 열어 본문을 복사해 아래에 붙여넣어 주세요.",
    tone: "text-slate-300",
  },
};

/**
 * 🟠 되는 것부터, 못 되는 것을 맨 끝에. 사람이 목록을 훑는 이유는 **자기 언론사를 찾으려는 것**이고, 그때
 * 제일 먼저 보고 싶은 건 「그냥 넣으면 되는 곳」입니다. `paste` 를 맨 위에 두면 이 기능이 안 되는 기능처럼
 * 읽힙니다 — 열두 곳 중 둘입니다.
 */
const PUBLISHER_GROUP_ORDER: NewsPublisherBody[] = ["address", "varies", "unknown", "paste"];

export function NewsReelScreen({ onBack, onNext }: Props) {
  const [setup, setSetup] = useState<Setup>({ status: "loading" });
  const [feed, setFeed] = useState<Feed>({ status: "loading" });
  const [url, setUrl] = useState("");
  /**
   * 🔴 **아래 「기사」 칸의 글이 어느 주소에서 온 것인지.**
   *
   * 목록에서 줄을 누르면 **주소 칸만** 채워집니다(붙여넣은 본문이 날아가지 않게) — 그런데 아래 칸은
   * 앞 기사 그대로라, 캡틴D는 **새 기사를 고른 줄 알고** 그 글로 릴을 만듭니다. 화면이 「앞 기사입니다」라고
   * 말해야 그 일이 안 생깁니다.
   */
  const [fetchedUrl, setFetchedUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [notice, setNotice] = useState<FetchNotice | null>(null);

  const [title, setTitle] = useState("");
  const [articleText, setArticleText] = useState("");
  const [outlet, setOutlet] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");

  /* 🔴 이제 이 수를 깎는 버튼이 생겼으니 그립니다(940 까지는 일부러 안 그렸습니다 — 아무것도 안 깎는 잔량을
     보여 주는 셈이었으니까요). `null` 은 **「예산 있음」이 아니라 「모르니까 안 부른다」**입니다. */
  const [dailyCalls, setDailyCalls] = useState<NewsDailyCallCount | null>(null);
  /* 🟠 서버가 「오늘 다 썼다」고 말한 순간을 따로 듭니다. 거절은 예외 경로라 새 건수를 안 싣고 오는데, 그때
     제가 들고 있는 수는 **한 번 낡은 것**입니다 — 그 낡은 수로 버튼을 열어 두면 다음 누름이 또 거절됩니다. */
  const [limitReached, setLimitReached] = useState(false);
  /* 🔴 비어 있는 칸 다섯이 1440×900 에서 **392px** 을 먹습니다(실측). 칸을 없애는 게 아니라 **안 볼 때 접습니다** —
     가져오면 저절로 열리고, 붙여넣어야 하는 언론사(MBC·YTN)에서만 사람이 엽니다. */
  const [articleOpen, setArticleOpen] = useState(false);
  /* 🔴 백열 줄이 여섯 줄짜리 창으로 들어옵니다(실측 110줄 · 보이는 창 327px · 한 줄 52px). 훑어서 찾는 게
     아니라 **걸러서 찾는** 자리입니다. */
  const [feedQuery, setFeedQuery] = useState("");
  /* 🔴 **그림이 먼저입니다.** 몇 장을 고르느냐가 **자막 칸을 몇 개 열지**를 정합니다 — 글을 먼저 쓰면
     그 수를 모르는 채로 씁니다(CLI 1067 §1). */
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [assetsError, setAssetsError] = useState<{ code: string; message: string } | null>(null);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [seconds, setSeconds] = useState<PhotoCardDurationSeconds>(PHOTO_CARD_DURATIONS[0]);


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

  /* 🟠 목록은 설정과 **따로** 불러옵니다. 하나가 남의 서버 여섯 곳을 두드리는 일이라 느리고, 그 느림이
     언론사 목록까지 붙잡고 있을 이유가 없습니다. 둘 중 하나가 실패해도 다른 쪽은 그립니다. */
  useEffect(() => {
    let live = true;
    getNewsFeed()
      .then((response) => { if (live) setFeed({ status: "ready", items: response.items, unavailable: response.unavailable }); })
      .catch(() => { if (live) setFeed({ status: "error" }); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listAssets()
      .then((response) => { if (!cancelled) setAssets(response.assets.filter((asset) => !asset.isFolder && asset.imageAvailable)); })
      .catch((caught: unknown) => { if (!cancelled) setAssetsError(toAssetDisplayError(caught)); });
    return () => { cancelled = true; };
  }, []);

  /* 🔴 **상한에 닿아도 빼는 것은 늘 열려 있습니다** — 잘못 고른 한 장을 못 바꾸면 사람이 갇힙니다. */
  function togglePicture(id: string): void {
    setAssetIds((current) => {
      if (current.includes(id)) return current.filter((one) => one !== id);
      if (current.length >= PHOTO_CARD_MAX_PICTURES) return current;
      return [...current, id];
    });
  }

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
        setFetchedUrl(typed);
        setArticleOpen(true);
      } else if (response.outcome === "body_not_found") {
        /* 🔴 실패가 아닙니다. 서버는 문을 두드렸고 페이지를 받았고 어느 부분이 기사인지 못 갈랐습니다 — 남은 한
           걸음이 사람의 것일 뿐입니다. 그래서 채울 수 있는 건 전부 채워 두고 본문 칸만 비웁니다. */
        setTitle(response.title);
        setArticleText("");
        setOutlet(response.publisher);
        setPublishedAt(response.publishedAt ?? "");
        setSourceUrl(response.sourceUrl);
        setNotice({ kind: "body_not_found" });
        setFetchedUrl(typed);
        setArticleOpen(true);
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


  /* 🟠 `useMemo` 인 이유는 백열 줄이라서입니다 — 글자 한 자 칠 때마다 백열 번 도는 건 괜찮지만, 이 화면은
     타이핑 중에도 다시 그려지는 곳이 많습니다. */
  const shownFeedItems = useMemo(
    () => (feed.status === "ready" ? feed.items.filter((item) => matchesFeedQuery(item, feedQuery)) : []),
    [feed, feedQuery],
  );

  /* 🔴 **언론사도 있어야 합니다** — 위 띠에 들어가는 이름이고, 계약이 `publisher` 를 필수로 받습니다.
     🟠 글자 수를 안 세는 이유는 계약의 표에 그 칸이 없어서입니다 — 띠는 폭에 맞춰 그려집니다. */

  const trimmedArticle = articleText.trim();
  /** 🟠 접힌 칸이 **비었는지 채워졌는지**를 접힌 채로 말해 줍니다 — 안 그러면 사람이 열어 봐야 압니다. */
  const articleFilled = trimmedArticle !== "" || title.trim() !== "";
  /* 🔴 셋이 다 있어야 다음 화면이 설 수 있습니다: **본문**(대조할 것), **언론사**(띠), **그림**(자막 칸 수). */
  const nextReady = trimmedArticle.length > 0 && outlet.trim().length > 0 && assetIds.length > 0;
  /* 🔴 주소는 바뀌었는데 아래 글은 안 바뀐 상태. **둘이 다른 기사**라는 것을 화면이 말해야 합니다. */
  const articleStale = articleFilled && url.trim().length > 0 && url.trim() !== fetchedUrl;

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

        {/*
          * 🔴 **오늘 들어온 기사.** 캡틴D: *「주소를 내가 직접 쳐야 하잖아. 그게 너무 귀찮은데」*
          *
          * 🟠 **누르면 주소 칸만 채웁니다 — 가져오기까지 하지 않습니다.** 가져오기는 성공하면 제목·본문·
          * 언론사·날짜를 **덮어씁니다.** 아래에 본문을 붙여넣어 둔 사람이 목록을 잘못 누르면 그게 날아갑니다.
          * 한 번 더 누르는 수고와, 붙여넣은 본문이 사라지는 일을 맞바꾸지 않습니다. 🟢 주소를 안 쳐도 되는
          * 것이 원래 부탁받은 일이고, 그건 이걸로 끝납니다.
          */}
        {feed.status === "ready" && feed.items.length > 0 && (
          <div className="mt-4 border-t border-white/10 pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs text-slate-500">오늘 들어온 기사 — 누르면 위 주소 칸에 들어갑니다</p>
              <span className="type-mono text-[11px] text-bone-faint" data-testid="news-feed-count">{feed.items.length}</span>
            </div>

            {/* 🟠 **전체 수는 그대로 두고** 걸러낸 수를 옆에 적습니다 — 「110 중 7」이라야 사람이 **덜 보고 있다는 것**을 압니다. */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="news-feed-filter">기사 걸러내기</label>
              <input
                id="news-feed-filter"
                data-testid="news-feed-filter"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600"
                value={feedQuery}
                onChange={(event) => setFeedQuery(event.target.value)}
                placeholder="제목이나 언론사로 걸러내기"
              />
              {feedQuery.trim() !== "" && (
                <span className="type-mono text-[11px] text-bone-faint" data-testid="news-feed-shown">
                  {shownFeedItems.length} / {feed.items.length}
                </span>
              )}
            </div>

            {/* 🔴 **목록이 조용히 짧으면 화면이 오늘을 잘못 말하는 것입니다.** 빠진 언론사를 이름으로
                말하고, 그쪽은 주소를 손으로 넣으면 여전히 됩니다. */}
            {feed.unavailable.length > 0 && (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-300" data-testid="news-feed-unavailable">
                지금 안 들어오는 곳: {feed.unavailable.map((one) => one.name).join(" · ")} — 이 언론사 기사는 주소를 직접 넣어 주세요.
              </p>
            )}

            {/* 🔴 걸러서 **하나도 안 남는 것**은 목록이 비어 있는 것과 다릅니다 — 찾은 말을 되짚어 주지 않으면
                사람은 오늘 기사가 없는 줄 압니다. */}
            {shownFeedItems.length === 0 && (
              <p className="mt-2 text-xs text-slate-500" data-testid="news-feed-none">
                「{feedQuery.trim()}」가 든 기사가 오늘 목록에 없습니다. 지우면 {feed.items.length}개가 다시 보입니다.
              </p>
            )}

            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1" data-testid="news-feed">
              {shownFeedItems.map((item) => {
                /* 🔴 **누르기 전에** 알아야 합니다 — 늘 붙여넣어야 하는 곳(SBS·MBC·YTN)은 주소가 채워져도
                   본문이 안 따라옵니다. 누른 다음에 말하면 그건 안내가 아니라 변명입니다. */
                const pasteNeeded = publishers.some((one) => one.host === item.host && one.body === "paste");
                const flash = feedItemIsFlash(item.title);
                return (
                  <li key={item.url}>
                    <button
                      type="button"
                      data-testid={`news-feed-item-${item.url}`}
                      className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-white/5"
                      onClick={() => setUrl(item.url)}
                    >
                      {/*
                        * 🔴 **자리는 늘 잡고, 없으면 비워 둡니다.**
                        *
                        * 여섯 중 셋이 그림을 아예 안 줍니다(공급자 여섯 중 셋이 그림을 안 줍니다 — 실측) — 백열 줄에서 **절반이 `null`**
                        * 입니다. 🟠 자리를 안 잡으면 제목의 왼쪽 끝이 줄마다 흔들려서, 백열 줄을 훑는 일이
                        * 어려워집니다. 🔴 그렇다고 빈 자리에 테두리나 아이콘을 그리면 **「못 가져왔다」로 읽힙니다** —
                        * 그건 저쪽 편집 판단이지 이 화면이 실패한 게 아닙니다. **그래서 아무것도 안 그립니다.**
                        *
                        * 🟠 **높이**: 줄은 **44 → 52px** 로 높아집니다(그림 40px + 패딩 12px, 전에는 글자 두 줄
                        * 32px + 12px). 🟢 그래도 **페이지는 안 길어집니다** — 상자가 `max-h-72` 로 고정이라
                        * 2132px 그대로이고, 대신 **보이는 줄이 6.5 → 5.5** 가 됩니다. 🔴 제가 처음에 「줄이 안
                        * 높아진다」고 적었는데 **안 재고 쓴 말이었습니다**(안 재고 쓴 말이었습니다 — 그 뒤 실측) — 40 과 32 를
                        * 같다고 본 셈입니다. 숫자를 남겨 두니 다음 사람은 다시 안 재도 됩니다.
                        *
                        * 🟠 **32px 로 줄이지 않습니다.** 8px 을 아끼면 1280×720 짜리 사진이 32px 이 되어 **뭐가
                        * 찍혔는지 안 보이고**, 그러면 그림을 붙인 이유가 없어집니다.
                        */}
                      <span
                        aria-hidden="true"
                        data-testid={`news-feed-slot-${item.url}`}
                        className="h-10 w-14 flex-shrink-0 overflow-hidden rounded"
                      >
                        {item.imageUrl !== null && (
                          /* 🟠 `onError` 로 지웁니다. 안 그러면 404 인 주소가 **브라우저의 깨진 그림 아이콘**을
                             남기는데, 그게 정확히 안 그리기로 한 「못 가져왔다」입니다. */
                          <img
                            data-testid={`news-feed-image-${item.url}`}
                            src={item.imageUrl}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                            onError={(event) => { event.currentTarget.style.display = "none"; }}
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-[11px] text-slate-500">{item.publisher}</span>
                          <span className="type-mono text-[11px] text-bone-faint">{feedItemTime(item.publishedAt)}</span>
                          {pasteNeeded && (
                            <span className="text-[11px] text-slate-400" data-testid={`news-feed-paste-${item.url}`}>· 본문은 붙여넣어야 합니다</span>
                          )}
                          {/* 🟠 **붙여넣기 안내와 같은 자리, 다른 말**입니다 — 저쪽은 「이 언론사는 늘 그렇다」고,
                              이쪽은 「이 기사가 얇다」고 말합니다. 뭉치면 어느 쪽을 고쳐야 할지 모릅니다. */}
                          {flash && (
                            <span className="text-[11px] text-amber-300/80" data-testid={`news-feed-flash-${item.url}`}>· 속보 — 본문이 짧아 못 가져올 수 있습니다</span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-sm leading-snug text-slate-200">{item.title}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* 🟠 목록이 없어도 **위의 주소 칸은 그대로 됩니다.** 그래서 한 줄이고, 빨갛지 않습니다. */}
        {feed.status === "error" && (
          <p className="mt-4 border-t border-white/10 pt-3 text-xs text-slate-500" data-testid="news-feed-error">
            오늘 기사 목록을 못 불러왔습니다. 주소를 직접 넣으시면 그대로 됩니다.
          </p>
        )}
        {feed.status === "ready" && feed.items.length === 0 && (
          <p className="mt-4 border-t border-white/10 pt-3 text-xs text-slate-500" data-testid="news-feed-empty">
            지금 들어온 기사가 없습니다. 주소를 직접 넣으시면 그대로 됩니다.
          </p>
        )}

        {fetching && <div className="mt-3"><Spinner label="기사를 가져오는 중..." /></div>}

        {/* 🔴 **주소는 새 기사, 아래 글은 앞 기사.** 목록에서 줄을 누르면 주소만 채워지는데(붙여넣은 본문을
            지우지 않으려고), 그러면 화면이 **두 기사를 동시에** 들고 있게 됩니다 — 말해 주지 않으면 앞
            기사의 글로 릴을 만들게 됩니다. */}
        {articleStale && (
          <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300" data-testid="news-fetch-stale">
            주소가 바뀌었습니다. <strong>아래 기사는 아직 앞 기사입니다</strong> — 「기사 가져오기」를 눌러야 새 기사로 바뀝니다.
          </p>
        )}

        {!articleStale && notice?.kind === "fetched" && (
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
            {/* 🔴 **이유가 다르면 할 일도 다릅니다.** 속보는 「못 가려냈다」가 아니라 **원래 짧은 것**이라,
                붙여넣어도 두세 문장입니다 — 다른 기사를 고르는 쪽이 보통 맞습니다. */}
            {feedItemIsFlash(title) && (
              <p className="text-xs text-amber-300" data-testid="news-fetch-flash-why">
                이 기사는 <strong>속보</strong>입니다. 속보는 본문이 한두 문장이라 릴에 넣을 내용이 얇습니다 — 같은 사건의 일반 기사를 고르시는 편이 낫습니다.
              </p>
            )}
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
            /*
             * 🔴 **접었습니다.** 캡틴D: *「너무 세로로 길잖아」*
             *
             * 이 목록은 네 무리 × (제목 + 설명 + 칩) 이라 펼쳐 두면 **170px 쯤**을 늘 씁니다. 🟠 그런데 이건
             * **한 번 읽는 참고**입니다 — 「내 언론사가 되나」를 한 번 확인하면 그 뒤로는 안 봅니다.
             *
             * 🟢 그리고 이게 화면의 유일한 안내이던 때와 지금은 다릅니다: **위에 오늘 기사 목록이 생겼고**,
             * 거기서 고르면 되는 곳만 나옵니다. 🔴 **안 지웁니다** — 목록에 없는 언론사를 직접 넣으려는 사람에게는
             * 여전히 이게 유일한 답입니다(Cowork Round 931 §2: 여기 없으면 제가 손으로 같은 문장을 적게 되고
             * 그 순간 목록이 두 벌이 됩니다).
             *
             * 🟠 `open` 을 안 줍니다 — 접힌 채로 시작합니다. 🟠 「거절」을 받은 사람에게는 **펼쳐진 채**로
             * 보여야 하지만, 그 사람은 이미 빨간 상자 안에서 같은 목록을 받습니다(`news-fetch-refused`).
             */
            <details data-testid="news-publishers-disclosure">
              <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-400">
                넣을 수 있는 언론사 {publishers.length}곳
              </summary>
              <div className="mt-2 space-y-3" data-testid="news-publishers">
                {PUBLISHER_GROUP_ORDER.map((body) => {
                  const members = publishers.filter((one) => one.body === body);
                  if (members.length === 0) return null;
                  const group = PUBLISHER_GROUPS[body];
                  return (
                    <div key={body} data-testid={`news-publishers-${body}`}>
                      <p className={`text-xs font-semibold ${group.tone}`}>{group.title}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{group.note}</p>
                      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                        {members.map((one) => (
                          <li key={one.host} className="text-xs text-slate-400">
                            {one.name} <span className="text-slate-600">{one.host}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      </section>

      <section className={cardSection} aria-label="기사">
        <h2 className="text-sm font-semibold text-slate-100">기사</h2>
        <p className="mt-1 text-xs text-slate-500">
          요약이 기사 안에서만 말하는지 대조하려면 <strong className="text-slate-300">본문이 있어야 합니다.</strong> 위에서 가져왔으면 채워져 있고, 아니면 붙여넣어 주세요.
        </p>
        <details
          className="mt-3"
          open={articleOpen}
          onToggle={(event) => setArticleOpen(event.currentTarget.open)}
          data-testid="news-article-disclosure"
        >
          <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-300">
            제목 · 본문 · 언론사 · 발행일 · 원문 링크
            <span className="ml-1 text-slate-500">{articleFilled ? "— 채워져 있습니다" : "— 직접 붙여넣으려면 여세요"}</span>
          </summary>
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
        </details>
      </section>

      {/*
        * 🔴 **그림이 글보다 먼저인 자리.** 자막은 **장면마다 하나**라, 몇 장을 고르셨는지가 다음 화면의
        * 자막 칸 수를 정합니다. 캡틴D: *「릴스가 몇 장면 몇 분인 줄 알고 이렇게 적음?」* — 그래서 뒤집었습니다.
        */}
      <section className={cardSection} aria-label="그림과 길이">
        <h2 className="text-sm font-semibold text-slate-100">그림 고르기</h2>
        <p className="mt-1 text-xs text-slate-500">
          고른 <strong className="text-slate-300">순서대로 한 장씩</strong> 이어 붙고, <strong className="text-slate-300">그림마다 자막이 하나</strong>씩 붙습니다. 여기서도 돈이 나가지 않습니다.
        </p>

        <div className="mt-3">
          <PicturePicker
            assets={assets}
            listError={assetsError}
            assetIds={assetIds}
            onToggle={togglePicture}
            max={PHOTO_CARD_MAX_PICTURES}
            seconds={seconds}
            testIdPrefix="news-reel-picture"
          />
        </div>

        <label className="mt-4 block text-sm text-slate-300">
          한 장당 길이
          <select
            data-testid="news-reel-seconds"
            className={`${field} mt-1`}
            value={seconds}
            onChange={(event) => setSeconds(Number(event.target.value) as PhotoCardDurationSeconds)}
          >
            {PHOTO_CARD_DURATIONS.map((value) => <option key={value} value={value}>{value}초</option>)}
          </select>
        </label>

        {/* 🔴 여기서 굽지 않습니다 — 다음 화면에서 **그림마다 자막**을 쓰고 만듭니다. 돈은 어느 쪽에서도 안 나갑니다. */}
        <div className="mt-4 space-y-2">
          <button
            type="button"
            data-testid="news-reel-next"
            className={primaryButton}
            disabled={!nextReady}
            onClick={() => {
              if (!nextReady) return;
              onNext({
                article: {
                  title: title.trim(),
                  body: trimmedArticle,
                  publisher: outlet.trim(),
                  publishedAt: publishedAt.trim(),
                  sourceUrl: sourceUrl.trim(),
                },
                assetIds,
                clipDurationSeconds: seconds,
              });
            }}
          >
            {assetIds.length > 0 ? `그림 ${assetIds.length}장으로 글 쓰기` : "글 쓰러 가기"}
          </button>
          {/* 🟠 못 누르는 이유를 **이유별로** — 닫힌 버튼만 두면 화면이 고장 난 것으로 읽힙니다. */}
          {!nextReady && (
            <p className="text-xs text-slate-500" data-testid="news-reel-next-why">
              {trimmedArticle.length === 0
                ? "기사 본문이 있어야 합니다 — 위에서 가져오시거나 붙여넣어 주세요."
                : outlet.trim().length === 0
                  ? "언론사 칸이 비어 있습니다 — 위 띠에 들어갈 이름입니다."
                  : "그림을 한 장 이상 골라 주세요. 그림 수만큼 자막 칸이 열립니다."}
            </p>
          )}
        </div>
      </section>

    </div>
  );
}
