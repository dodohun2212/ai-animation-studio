import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NEWS_REEL_TEXT_BOXES, type NewsReelTextField } from "@ai-animation-studio/shared";
import { makeAsset, makeAssetFolder, stubFetchByRoute } from "../api/testUtils.js";
import { NewsReelScreen, feedItemIsFlash, feedItemTime, newsArticleLead } from "./NewsReelScreen.js";

const PUBLISHERS = [
  /* 🔴 Three answers, not two rows — the screen has to draw "주소만으로 됨", "늘 붙여넣기" and
     "아직 모름" differently, and a fixture carrying only one of them would let two of those branches
     rot unseen. `unknown` in particular must never be drawn as a promise either way. */
  { host: "yna.co.kr", name: "연합뉴스", body: "address" as const },
  { host: "imbc.com", name: "MBC", body: "paste" as const },
  { host: "sedaily.com", name: "서울경제", body: "unknown" as const },
];

const SETUP = { publishers: PUBLISHERS, dailyCalls: { used: 2, limit: 10 } };

/**
 * 이 화면은 열리자마자 **둘을** 부릅니다 — `GET /news/setup` 과 `GET /news/feed`.
 *
 * 🟠 둘 다 세워 둡니다. 안 세우면 짝이 진짜 네트워크를 건드리고, 기사 목록은 **남의 서버 여섯 곳**입니다.
 * 🟢 기본 목록은 **비어 있습니다** — 기존 짝들은 기사 목록에 대해 아무 주장도 안 하므로, 그것들이 목록의
 * 내용에 따라 흔들리면 안 됩니다. 목록을 보는 짝은 자기 것을 실어서 옵니다.
 */
function stubRoutes(extra: Record<string, unknown> = {}, setup: unknown = SETUP): ReturnType<typeof vi.fn> {
  /* 그림 고르개가 열리자마자 `/assets` 를 부릅니다 — 빼 두면 그 실패가 빨간 상자로 떠 다른 짝을 흐립니다. */
  const routes: Record<string, unknown> = { "GET /news/setup": setup, "GET /news/feed": { items: [], unavailable: [] }, "GET /assets": { assets: [] } };
  const errors: Record<string, { status: number; body: unknown }> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (value && typeof value === "object" && "status" in (value as object)) errors[key] = value as { status: number; body: unknown };
    else routes[key] = value;
  }
  const mock = stubFetchByRoute(routes, errors);
  vi.stubGlobal("fetch", mock);
  return mock;
}

const ARTICLE = [
  "국회는 2026년 9월 17일 검찰청 폐지에 따른 후속 법률 51건을 통과시켰다.",
  "개정법은 10월 2일부터 시행된다. 검찰청은 공소청으로 이름이 바뀐다.",
  "야당은 \"제대로 된 개혁이라 할 수 있느냐\"고 비판했다.",
].join("\n");

/** 목록 한 줄 — 여러 짝이 같은 줄을 봅니다. */
const FEED_ITEM = {
  url: "https://www.yna.co.kr/view/AKR20260917000100001",
  host: "yna.co.kr",
  publisher: "연합뉴스",
  title: "국회, 검찰청 폐지 후속 법률 51건 통과",
  publishedAt: "2026-09-17T09:12:00.000Z",
  imageUrl: null,
};

function renderScreen(): void {
  render(<NewsReelScreen onBack={() => {}} onNext={vi.fn()} />);
}


async function typeUrlAndFetch(url: string): Promise<void> {
  fireEvent.change(screen.getByTestId("news-fetch-url"), { target: { value: url } });
  fireEvent.click(screen.getByTestId("news-fetch"));
}

describe("NewsReelScreen", () => {
  beforeEach(() => { stubRoutes(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("sends an address whose host is not on the list, instead of refusing it here", async () => {
    const mock = stubRoutes({
      "POST /news/article": { outcome: "refused", reason: "publisher_not_allowed", publishers: PUBLISHERS },
    });
    renderScreen();
    await screen.findByTestId("news-publishers");

    await typeUrlAndFetch("https://nytimes.com/2026/09/17/whatever");

    await waitFor(() => expect(screen.getByTestId("news-fetch-refused")).toBeTruthy());
    expect(mock.mock.calls.some(([input]) => String(input).endsWith("/news/article"))).toBe(true);
    expect(screen.getByTestId("news-fetch-refused").getAttribute("data-reason")).toBe("publisher_not_allowed");
  });

  /**
   * 🔴 네 거절은 사람이 할 일이 전부 다릅니다. 특히 `private_address` 가 「다른 언론사로 해 보세요」로 읽히면
   * 안 됩니다 — 자기 공유기 주소를 붙여 넣은 사람은 신문사 하나 차이로 성공하는 게 아닙니다(CLI Round 929 §3).
   */
  it("does not tell someone who pasted a network address to try another publisher", async () => {
    stubRoutes({ "POST /news/article": { outcome: "refused", reason: "private_address", publishers: PUBLISHERS } });
    renderScreen();

    await typeUrlAndFetch("https://192.168.0.1/article");

    const refused = await screen.findByTestId("news-fetch-refused");
    expect(refused.textContent).toContain("주소를 다시 확인해 주세요");
    expect(refused.textContent).not.toContain("언론사");
  });

  /**
   * 🔴 `body_not_found` 는 거절도 오류도 아닙니다. 서버는 문을 두드렸고 페이지를 받았고 어느 부분이 기사인지
   * 못 갈랐습니다 — **우리가 한 일을 우리가 잘못 말하지 않으려고** 값이 따로 있습니다(Cowork Round 931 §4).
   * 그리고 그 길은 **같은 화면 안**이어야 합니다: 다른 데로 보내면 방금 받은 주소·언론사·발행일이 날아가고
   * 사람은 처음부터 다시 칩니다.
   */
  it("opens the paste box in place, with everything but the body already filled", async () => {
    stubRoutes({
      "POST /news/article": {
        outcome: "body_not_found",
        sourceUrl: "https://sedaily.com/final",
        publisher: "서울경제",
        title: "검찰청 폐지 후속 법안 통과",
        publishedAt: "2026-09-17",
      },
    });
    renderScreen();

    await typeUrlAndFetch("https://sedaily.com/short");

    const notice = await screen.findByTestId("news-fetch-body-not-found");
    expect(notice.textContent).toContain("붙여넣어 주세요");
    // 실패로 읽히면 안 됩니다 — 아무것도 실패하지 않았습니다.
    expect(notice.textContent).not.toContain("실패");
    expect(screen.queryByTestId("news-fetch-refused")).toBeNull();

    expect((screen.getByTestId("news-title") as HTMLInputElement).value).toBe("검찰청 폐지 후속 법안 통과");
    expect((screen.getByTestId("news-outlet") as HTMLInputElement).value).toBe("서울경제");
    expect((screen.getByTestId("news-published") as HTMLInputElement).value).toBe("2026-09-17");
    // 🔴 리다이렉트 이후 주소. 자막 출처는 사람이 친 주소가 아니라 이것이어야 합니다.
    expect((screen.getByTestId("news-url") as HTMLInputElement).value).toBe("https://sedaily.com/final");
    expect((screen.getByTestId("news-article") as HTMLTextAreaElement).value).toBe("");
  });

  it("fills the article from a successful fetch, and keeps the address the body actually came from", async () => {
    stubRoutes({
      "POST /news/article": {
        outcome: "article",
        article: {
          title: "검찰청 폐지 후속 법안 통과",
          body: ARTICLE,
          publisher: "서울경제",
          publishedAt: "2026-09-17",
          sourceUrl: "https://sedaily.com/final",
        },
      },
    });
    renderScreen();

    await typeUrlAndFetch("https://sedaily.com/short");

    await screen.findByTestId("news-fetch-ok");
    expect((screen.getByTestId("news-article") as HTMLTextAreaElement).value).toContain("51건");
    /* 출처 줄은 없어졌지만, 다음 화면으로 넘기는 주소는 여전히 **본문이 실제로 온 주소**입니다. */
    expect((screen.getByTestId("news-url") as HTMLInputElement).value).toBe("https://sedaily.com/final");
  });

  /**
   * 🟠 목록은 **막히기 전에** 보입니다. 거절당한 뒤에만 보이면 그건 안내가 아니라 설명이고, 그러면 빈 화면이
   * 할 말이 없어 제가 「주요 종합지 기사를 넣어 주세요」를 손으로 적게 됩니다 — 그 순간 목록이 두 벌이 되고,
   * 13번째 언론사가 더해지는 날 제 문장만 조용히 틀립니다(Cowork Round 931 §2).
   */
  it("shows which publishers work before anyone has typed anything", async () => {
    renderScreen();

    const list = await screen.findByTestId("news-publishers");
    expect(list.textContent).toContain("연합뉴스");
    expect(list.textContent).toContain("yna.co.kr");
  });

  /**
   * 🔴 이 네 짝이 지키는 건 **화면이 서버가 하지 않은 약속을 하지 않는 것**입니다.
   *
   * 서버는 언론사마다 「주소만으로 읽혔다 / 기사마다 달랐다 / 본문이 문서에 없다 / 아직 안 재 봤다」를
   * **재 본 결과로** 돌려줍니다. 화면이 할 일은 그걸 그대로 말하는 것뿐인데, 네 갈래를 한 줄로 뭉개면
   * 사람은 **목록에 있으니 다 되는 줄** 압니다 — 그게 지금까지의 화면이었습니다.
   */
  describe("언론사 목록 — 네 답을 네 답으로", () => {
    const FOUR = [
      { host: "yna.co.kr", name: "연합뉴스", body: "address" as const },
      { host: "chosun.com", name: "조선일보", body: "varies" as const },
      { host: "imbc.com", name: "MBC", body: "paste" as const },
      { host: "sedaily.com", name: "서울경제", body: "unknown" as const },
    ];

    async function renderFour(): Promise<void> {
      stubRoutes({}, { publishers: FOUR, dailyCalls: { used: 0, limit: 10 } });
      renderScreen();
      await screen.findByTestId("news-publishers");
    }

    it("네 답이 각자 자기 묶음에 들어가고, 한 언론사는 한 번만 나온다", async () => {
      await renderFour();

      for (const [body, name] of [["address", "연합뉴스"], ["varies", "조선일보"], ["paste", "MBC"], ["unknown", "서울경제"]] as const) {
        expect(screen.getByTestId(`news-publishers-${body}`).textContent).toContain(name);
      }
      /*
       * 🟠 「한 번만」이 중요합니다. 묶음을 거르는 조건이 겹치면 같은 언론사가 두 묶음에 나오고, 그러면
       * 화면이 **서로 반대되는 두 말**을 동시에 합니다 — 「주소만 넣으면 됩니다」와 「늘 붙여넣어야 합니다」.
       */
      /*
       * 🔴 **모든 언론사를 봅니다 — 둘만 보면 안 됩니다.** 이 줄이 처음엔 연합뉴스와 MBC 만 셌는데, 거르는
       * 조건을 겹치게 해서 **`unknown` 이 `paste` 묶음에도 나오게** 주입해 보니 **아무것도 안 빨개졌습니다.**
       * 위 반복문은 네 답을 다 부르는데 중복 검사만 둘이었고, 겹침은 **검사 안 하는 답에서** 일어날 수 있습니다.
       * 픽스처에서 이름을 끌어오면 답이 늘어도 이 구멍이 다시 생기지 않습니다.
       */
      const all = screen.getByTestId("news-publishers").textContent ?? "";
      for (const one of FOUR) {
        expect(all.split(one.name).length - 1, one.name).toBe(1);
      }
    });

    /**
     * 🔴 이 짝이 이 묶음의 핵심입니다. `unknown` 은 **아직 아무도 안 본 것**이라, 「될 겁니다」도
     * 「안 됩니다」도 화면이 해선 안 되는 말입니다. 어느 한쪽으로 그리는 순간 화면이 서버 대신 약속합니다.
     */
    it("「아직 재 보지 않았습니다」는 어느 쪽 약속으로도 그리지 않는다", async () => {
      await renderFour();

      const unknown = screen.getByTestId("news-publishers-unknown").textContent ?? "";
      expect(unknown).toContain("서울경제");
      expect(unknown).not.toContain("주소만 넣으면");
      expect(unknown).not.toContain("늘 붙여넣어야");
      // 대신 말해야 하는 것: 판정은 서버가 그 자리에서 한다.
      expect(unknown).toContain("넣어 보시면");
    });

    /**
     * 🔴 `paste` 의 문장은 **기다림을 허용하면 안 됩니다.** 「아직 안 됩니다」로 읽히면 사람은 며칠 뒤
     * 다시 시도하는데, 본문이 문서 안에 없는 건 파서가 좋아져서 해결되는 종류가 아닙니다.
     */
    it("「늘 붙여넣어야 합니다」는 기다리면 된다고 말하지 않는다", async () => {
      await renderFour();

      const paste = screen.getByTestId("news-publishers-paste").textContent ?? "";
      expect(paste).toContain("MBC");
      expect(paste).toContain("기다리면 되는 종류가 아닙니다");
      expect(paste).not.toContain("아직");
      expect(paste).not.toContain("지금은");
    });

    /**
     * 🟠 없는 묶음은 **머리말도 안 그립니다.** 열두 곳이 전부 주소로 되는 날 「늘 붙여넣어야 합니다」라는
     * 제목이 빈 채로 남아 있으면, 그 화면은 있지도 않은 문제를 말하고 있는 것입니다.
     */
    it("해당하는 언론사가 없는 묶음은 제목도 안 나온다", async () => {
      stubRoutes({}, { publishers: [FOUR[0]], dailyCalls: { used: 0, limit: 10 } });
      renderScreen();
      await screen.findByTestId("news-publishers");

      expect(screen.getByTestId("news-publishers-address")).toBeTruthy();
      expect(screen.queryByTestId("news-publishers-paste")).toBeNull();
      expect(screen.queryByTestId("news-publishers-unknown")).toBeNull();
      expect(screen.getByTestId("news-publishers").textContent).not.toContain("늘 붙여넣어야 합니다");
    });
  });

  /** 목록을 못 불러와도 화면은 돕니다 — 판정은 어차피 서버가 하니까요. */
  it("still lets someone try an address when the publisher list could not be loaded", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({}, { "GET /news/setup": { status: 500, body: { code: "INTERNAL_ERROR", message: "" } } }));
    renderScreen();

    await screen.findByTestId("news-publishers-error");
    fireEvent.change(screen.getByTestId("news-fetch-url"), { target: { value: "https://sedaily.com/a" } });
    expect(screen.getByTestId("news-fetch")).not.toBeDisabled();
  });

});

describe("NewsReelScreen 기사 목록", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("puts the address in the box when a row is pressed, and touches nothing else", async () => {
    stubRoutes({ "GET /news/feed": { items: [FEED_ITEM], unavailable: [] } });
    renderScreen();

    fireEvent.click(await screen.findByTestId(`news-feed-item-${FEED_ITEM.url}`));

    expect((screen.getByTestId("news-fetch-url") as HTMLInputElement).value).toBe(FEED_ITEM.url);
    /* 🔴 **가져오기까지 하지 않습니다.** 가져오기는 성공하면 제목·본문을 덮어쓰고, 아래에 본문을 붙여넣어
       둔 사람이 잘못 누르면 그게 날아갑니다. 한 번 더 누르는 수고와 맞바꾸지 않습니다. */
    expect((screen.getByTestId("news-article") as HTMLTextAreaElement).value, "본문은 그대로입니다").toBe("");
    expect(screen.queryByTestId("news-fetch-ok"), "누른 것만으로 가져오지 않습니다").toBeNull();
  });

  it("names the publishers that are not coming in today", async () => {
    // 🔴 목록이 조용히 짧으면 **화면이 오늘을 잘못 말하는 것**입니다.
    stubRoutes({ "GET /news/feed": { items: [FEED_ITEM], unavailable: [{ host: "imbc.com", name: "MBC", body: "paste" }] } });
    renderScreen();

    const line = await screen.findByTestId("news-feed-unavailable");
    expect(line.textContent).toContain("MBC");
    expect(line.textContent, "막다른 길로 두지 않습니다").toContain("주소를 직접 넣어");
  });

  it("says a row will still need pasting before it is pressed, not after", async () => {
    /* 🔴 SBS·MBC·YTN 은 주소가 채워져도 본문이 안 따라옵니다. 누른 다음에 말하면 그건 안내가 아니라
       변명입니다. `host` 가 `publisher` 옆에 실려 오는 이유가 이것입니다. */
    const mbcItem = { ...FEED_ITEM, url: "https://imbc.com/news/1", publisher: "MBC", host: "imbc.com" };
    stubRoutes({ "GET /news/feed": { items: [FEED_ITEM, mbcItem], unavailable: [] } });
    renderScreen();

    expect(await screen.findByTestId(`news-feed-paste-${mbcItem.url}`)).toBeTruthy();
    expect(screen.queryByTestId(`news-feed-paste-${FEED_ITEM.url}`), "주소만으로 되는 곳에는 안 붙습니다").toBeNull();
  });

  it("keeps the typed-address path when the feed does not answer", async () => {
    // 🟠 목록은 지름길입니다. 지름길이 막혔다고 큰길을 빨갛게 칠하지 않습니다.
    stubRoutes({ "GET /news/feed": { status: 500, body: { code: "INTERNAL_ERROR" } } });
    renderScreen();

    expect((await screen.findByTestId("news-feed-error")).textContent).toContain("주소를 직접 넣으시면");
    expect(screen.getByTestId("news-fetch-url"), "주소 칸은 그대로 있습니다").toBeTruthy();
    expect(screen.queryByRole("alert"), "빨간 상자가 아닙니다").toBeNull();
  });

  it("says the feed gave no time rather than pretending it knows", () => {
    // 🔴 `null` 은 오류가 아니라 **피드가 안 줬다**는 것입니다.
    expect(feedItemTime(null)).toBe("시각 없음");
    expect(feedItemTime("2026-09-17T09:12:00.000Z")).not.toBe("시각 없음");
  });
});

/**
 * 🔴 캡틴D: *「너무 세로로 길잖아」*
 *
 * 언론사 목록은 네 무리 × (제목 + 설명 + 칩) 이라 펼쳐 두면 늘 170px 쯤을 씁니다. 🟠 **한 번 읽는
 * 참고**이고, 이제 위에 오늘 기사 목록이 따로 있습니다. 🔴 **안 지웁니다** — 목록에 없는 언론사를 직접
 * 넣으려는 사람에게는 여전히 유일한 답입니다.
 */
describe("NewsReelScreen 세로 길이", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("folds the publisher list, and says how many are in there", async () => {
    stubRoutes();
    renderScreen();

    const disclosure = await screen.findByTestId("news-publishers-disclosure");
    expect((disclosure as HTMLDetailsElement).open, "접힌 채로 엽니다").toBe(false);
    expect(disclosure.textContent, "몇 곳인지는 접힌 채로도 보입니다").toContain(`${PUBLISHERS.length}곳`);
  });

  it("keeps the list itself, because a publisher that is not in today's feed has nowhere else to be read", async () => {
    /* 🟠 이 반쪽이 없으면 위의 짝은 「목록을 아예 안 그린다」는 구현으로도 초록입니다 — 그러면 직접 주소를
       넣으려는 사람이 **어디가 되는지 알 곳이 없어집니다.** */
    stubRoutes();
    renderScreen();

    const list = await screen.findByTestId("news-publishers");
    expect(list.textContent).toContain("연합뉴스");
    expect(list.textContent).toContain("MBC");
  });
});

/**
 * 🔴 캡틴D: *「각 기사마다 사진 같은 거 하나씩 옆에 표시해서」*
 *
 * 🟠 **여섯 중 셋이 그림을 아예 안 줍니다**(CLI Round 1009 §0: 뉴시스·경향·한겨레). 백열 줄에서 절반이
 * `null` 이라, **없을 때 무엇을 안 그리는지**가 있을 때 무엇을 그리는지만큼 중요합니다.
 */
describe("NewsReelScreen 기사 사진", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("puts the feed's picture beside the row", async () => {
    const withImage = { ...FEED_ITEM, imageUrl: "https://img.yna.co.kr/photo/ap/2026/09/17/a.jpg" };
    stubRoutes({ "GET /news/feed": { items: [withImage], unavailable: [] } });
    renderScreen();

    const image = await screen.findByTestId(`news-feed-image-${withImage.url}`);
    expect(image.getAttribute("src")).toBe(withImage.imageUrl);
    /* 🟠 기사 그림은 제목이 이미 말하는 것을 다시 말합니다 — 스크린 리더가 읽을 게 없습니다. */
    expect(image.getAttribute("alt"), "제목이 곧 설명입니다").toBe("");
  });

  it("keeps the space even when there is no picture, so the titles stay in one column", async () => {
    /* 🔴 **이게 이 설계의 핵심인데 짝이 없었습니다**(CLI Round 1013 §1: 자리를 없애도 서른셋이 전부 초록).
       110 줄 중 **48 줄(44%)만** 그림이 있습니다 — 자리가 사라지면 **62 줄이 왼쪽으로 밀려** 목록이
       들쭉날쭉해지고, 백열 줄을 훑는 일이 그만큼 어려워집니다. */
    const noImage = { ...FEED_ITEM, imageUrl: null };
    const withImage = { ...FEED_ITEM, url: "https://www.yna.co.kr/view/AKR2", imageUrl: "https://img.yna.co.kr/a.jpg" };
    stubRoutes({ "GET /news/feed": { items: [withImage, noImage], unavailable: [] } });
    renderScreen();

    await screen.findByTestId(`news-feed-item-${noImage.url}`);
    const empty = screen.getByTestId(`news-feed-slot-${noImage.url}`);
    expect(empty, "자리는 그림이 없어도 남습니다").toBeTruthy();
    expect(empty.textContent, "🔴 그 자리에 글자를 쓰면 「못 가져왔다」가 됩니다").toBe("");
    expect(empty.className).toBe(screen.getByTestId(`news-feed-slot-${withImage.url}`).className);
  });

  it("draws nothing at all when the feed gave no picture", async () => {
    /* 🔴 빈 자리에 테두리나 아이콘을 그리면 **「못 가져왔다」로 읽힙니다.** 그건 저쪽 편집 판단이지 이 화면이
       실패한 게 아닙니다 — 절반이 그렇습니다. */
    stubRoutes({ "GET /news/feed": { items: [{ ...FEED_ITEM, imageUrl: null }], unavailable: [] } });
    renderScreen();

    await screen.findByTestId(`news-feed-item-${FEED_ITEM.url}`);
    expect(screen.queryByTestId(`news-feed-image-${FEED_ITEM.url}`)).toBeNull();
    expect(screen.queryByText(/사진을 가져오지|이미지 없음/), "없는 걸 실패라고 말하지 않습니다").toBeNull();
  });

  it("still opens the address when a row with a picture is pressed", async () => {
    // 🟠 그림을 붙이면서 배선이 끊기는 게 제일 흔한 사고입니다 — 이제 누르는 자리가 `<img>` 를 품고 있습니다.
    const withImage = { ...FEED_ITEM, imageUrl: "https://img.yna.co.kr/photo/ap/2026/09/17/a.jpg" };
    stubRoutes({ "GET /news/feed": { items: [withImage], unavailable: [] } });
    renderScreen();

    fireEvent.click(await screen.findByTestId(`news-feed-item-${withImage.url}`));
    expect((screen.getByTestId("news-fetch-url") as HTMLInputElement).value).toBe(withImage.url);
  });
});

/**
 * 🔴 오늘 목록은 **110줄**이고 보이는 창은 **327px — 여섯 줄**이다(Cowork Round 1032 §2 실측). 열여덟 번을
 * 굴려야 끝에 닿는다. 캡틴D가 *「주소 치기 귀찮다」*고 해서 만든 목록이 **찾기 귀찮은 목록**이 되어 있었다.
 *
 * 🔴 **화면을 거쳐서 친다.** `matchesFeedQuery` 만 불러 보면 그 함수가 옳다는 것만 남고 **화면이 그걸 쓰는지는
 * 아무도 안 붙든다** — Cowork Round 990 이 그 짝을 실제로 만들었었다(*「짝이 계산을 대신하면 그 계산은 안
 * 붙들린다」*). 그래서 아래는 전부 칸에 글자를 넣고 **줄이 줄어드는지**를 본다.
 */
describe("NewsReelScreen 기사 걸러내기", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const SPORTS = { ...FEED_ITEM, url: "https://www.yna.co.kr/view/AKR9", title: "아시안게임 축구 결승 오늘 밤" };
  const MBC_ITEM = { ...FEED_ITEM, url: "https://imbc.com/news/1", title: "태풍 북상, 내일 새벽 상륙", publisher: "MBC", host: "imbc.com" };

  async function renderFeed(items: unknown[] = [FEED_ITEM, SPORTS, MBC_ITEM]): Promise<void> {
    stubRoutes({ "GET /news/feed": { items, unavailable: [] } });
    renderScreen();
    await screen.findByTestId("news-feed");
  }

  const type = (value: string): void => {
    fireEvent.change(screen.getByTestId("news-feed-filter"), { target: { value } });
  };

  // 🟠 `queryAll` 입니다 — 한 줄도 안 남는 것이 이 짝들이 실제로 보려는 답 중 하나라, 없을 때 던지면 안 됩니다.
  const rows = (): number => screen.queryAllByTestId(/^news-feed-item-/).length;

  it("narrows the list by the title, and says how many of how many are left", async () => {
    await renderFeed();
    expect(rows()).toBe(3);

    type("아시안게임");

    expect(rows(), "제목이 걸리는 한 줄만 남습니다").toBe(1);
    expect(screen.getByTestId(`news-feed-item-${SPORTS.url}`)).toBeTruthy();
    /* 🔴 「1」만 적으면 **덜 보고 있다는 것**을 알 길이 없습니다. 전체를 같이 적어야 걸러진 목록입니다. */
    expect(screen.getByTestId("news-feed-shown").textContent).toBe("1 / 3");
  });

  it("narrows by the publisher too, which is why there is no separate publisher button", async () => {
    // 🟠 「연합」은 어느 제목에도 없습니다 — 언론사로만 걸립니다.
    await renderFeed();

    type("연합");

    expect(rows()).toBe(2);
    expect(screen.queryByTestId(`news-feed-item-${MBC_ITEM.url}`), "MBC 줄은 빠집니다").toBeNull();
  });

  /**
   * 🔴 이 짝이 없으면 「주소도 본다」는 구현이 **전부 초록**입니다. 그리고 그 구현은 조용히 쓸모가 없습니다 —
   * 주소마다 `co.kr` 이 들어 있어서 **「co」 두 글자에 백열 줄이 전부** 걸립니다. 걸러내기가 아니라
   * 안 걸러내기가 됩니다.
   */
  it("never matches the address, however much of it the query looks like", async () => {
    await renderFeed();

    type("co");

    expect(rows(), "주소의 co.kr 로는 한 줄도 안 걸립니다").toBe(0);
    type("yna");
    expect(rows(), "호스트 이름으로도 안 걸립니다").toBe(0);
  });

  /**
   * 🔴 **걸러서 0 이 되는 것과 오늘 기사가 없는 것은 다릅니다.** 되짚어 주지 않으면 사람은 오늘 기사가 없는
   * 줄 알고 창을 닫습니다 — 실제로는 자기가 친 다섯 글자 때문입니다.
   */
  it("says which word emptied the list, and how many come back when it is cleared", async () => {
    await renderFeed();

    type("zzzz");

    const none = screen.getByTestId("news-feed-none");
    expect(none.textContent, "친 말을 되짚습니다").toContain("zzzz");
    expect(none.textContent, "지우면 몇 개가 돌아오는지 말합니다").toContain("3개");
    expect(screen.queryAllByTestId(/^news-feed-item-/), "줄은 하나도 없습니다").toHaveLength(0);
  });

  it("puts every row back when the box is cleared, and stops saying how many are shown", async () => {
    await renderFeed();
    type("연합");
    expect(rows()).toBe(2);

    type("");

    expect(rows()).toBe(3);
    /* 🟠 안 거를 때 「3 / 3」이 남아 있으면 **늘 걸러진 것처럼** 보입니다. 걸러낼 때만 그립니다. */
    expect(screen.queryByTestId("news-feed-shown"), "안 거르면 아예 안 그립니다").toBeNull();
  });

  it("leaves the total alone — it is today's count, not what is on screen", async () => {
    /* 🔴 전체 수가 걸러낸 수를 따라가면 **오늘 몇 개가 들어왔는지 말하는 곳이 사라집니다.** 그러면
       「지우면 3개가 다시 보입니다」도 자기 말을 못 지킵니다. */
    await renderFeed();
    expect(screen.getByTestId("news-feed-count").textContent).toBe("3");

    type("연합");

    expect(screen.getByTestId("news-feed-count").textContent, "오늘 들어온 수는 안 변합니다").toBe("3");
  });
});

/**
 * 🔴 1440×900 첫 화면에서 **비어 있는 「기사」 칸 다섯이 392px** 을 먹고 있었다(Cowork Round 1030 §3 실측,
 * 전체 2012px). 위에서 가져와야 채워지는 칸이 **가져오기 전부터 화면 절반**을 차지한다. 접은 뒤 1636px.
 *
 * 🔴 **지우는 게 아니라 접는다.** 붙여넣어야 하는 언론사(MBC·YTN)에서는 사람이 직접 채우는 유일한 자리다.
 */
describe("NewsReelScreen 기사 칸 접기", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("starts folded, and says from the outside that there is nothing in it yet", async () => {
    stubRoutes();
    renderScreen();

    const disclosure = await screen.findByTestId("news-article-disclosure");
    expect((disclosure as HTMLDetailsElement).open, "접힌 채로 엽니다").toBe(false);
    /* 🟠 접힌 줄이 **비었는지 채워졌는지**를 말해야 합니다 — 안 그러면 열어 봐야 압니다. */
    expect(disclosure.textContent).toContain("직접 붙여넣으려면 여세요");
  });

  /**
   * 🔴 **접혀 있어도 칸은 DOM 에 그대로 있어야 합니다.** 안 그리는 구현으로 바꾸면 이 화면의 기존 짝 서른몇이
   * 칸을 못 찾고, 더 나쁜 것은 **붙여넣은 본문이 접을 때마다 사라지는** 것입니다.
   */
  it("keeps the fields themselves while folded, so nothing typed into them is lost", async () => {
    stubRoutes();
    renderScreen();
    await screen.findByTestId("news-article-disclosure");

    fireEvent.change(screen.getByTestId("news-article"), { target: { value: ARTICLE } });

    expect((screen.getByTestId("news-article") as HTMLTextAreaElement).value).toBe(ARTICLE);
    expect((screen.getByTestId("news-article-disclosure") as HTMLDetailsElement).open, "여전히 접힌 채입니다").toBe(false);
  });

  /**
   * 🔴 **뒤집었습니다(1084).** 이 짝은 원래 「채워졌으니 펼칩니다」였습니다 — 그때는 본문을 펴 주는 것이
   * **무슨 기사인지 알 수 있는 유일한 길**이었기 때문입니다. 이제 그 일을 위의 **리드**가 합니다.
   *
   * 🟠 열 줄짜리 본문 칸은 볼 것을 주는 대신 **그림 격자를 화면 밖으로 밉니다** — 그리고 그림을 고르는 것이
   * 이 화면에서 다음에 할 일입니다. 접힌 줄이 「채워져 있습니다」라고 말하므로, 고칠 때만 열면 됩니다.
   */
  it("stays folded when a fetch fills the boxes, and says so from the outside", async () => {
    stubRoutes({
      "POST /news/article": { outcome: "article", article: { title: "국회, 검찰청 폐지 후속 법률 51건 통과", body: ARTICLE, publisher: "연합뉴스", publishedAt: "2026-09-17T09:12:00.000Z", sourceUrl: "https://www.yna.co.kr/view/AKR1" } },
    });
    renderScreen();
    await screen.findByTestId("news-article-disclosure");

    await typeUrlAndFetch("https://www.yna.co.kr/view/AKR1");

    await waitFor(() => expect(screen.getByTestId("news-article-disclosure").textContent).toContain("채워져 있습니다"));
    expect((screen.getByTestId("news-article-disclosure") as HTMLDetailsElement).open, "리드가 대신 보여 주므로 접힌 채로 둡니다").toBe(false);
    /* 🟢 대신 리드가 떠 있습니다 — 접어 두는 것이 「아무것도 안 보인다」가 되지 않는 이유입니다. */
    expect(screen.getByTestId("news-reel-article-lead").textContent).toContain("검찰청");
  });

  /**
   * 🔴 **본문을 못 찾았을 때는 여전히 폅니다 — 그리고 이 둘은 다릅니다.** 그쪽은 볼 것이 아니라 **할 일**이
   * 생긴 것이고, 사람이 본문을 붙여넣어야 다음으로 갑니다. 접어 두면 할 일이 접힌 칸 안에 숨습니다.
   */
  it("still opens itself when the body could not be found, because now there is something to do", async () => {
    stubRoutes({
      "POST /news/article": { outcome: "body_not_found", title: "국회, 검찰청 폐지 후속 법률 51건 통과", publisher: "연합뉴스", publishedAt: "2026-09-17T09:12:00.000Z", sourceUrl: "https://www.yna.co.kr/view/AKR1" },
    });
    renderScreen();
    await screen.findByTestId("news-article-disclosure");

    await typeUrlAndFetch("https://www.yna.co.kr/view/AKR1");

    await waitFor(() => {
      expect((screen.getByTestId("news-article-disclosure") as HTMLDetailsElement).open, "붙여넣을 칸을 열어 둡니다").toBe(true);
    });
  });

  describe("NewsReelScreen 주소와 본문이 어긋날 때", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const FEED = {
    items: [
      { url: "https://www.yna.co.kr/view/1", host: "yna.co.kr", publisher: "연합뉴스", title: "첫 기사", publishedAt: "2026-09-22T00:00:00.000Z", imageUrl: null },
      { url: "https://www.yna.co.kr/view/2", host: "yna.co.kr", publisher: "연합뉴스", title: "두 번째 기사", publishedAt: "2026-09-22T01:00:00.000Z", imageUrl: null },
    ],
    unavailable: [],
  };

  it("says the article below is still the previous one when another row is pressed", async () => {
    stubRoutes({
      "GET /news/feed": FEED,
      "POST /news/article": { outcome: "article", article: { title: "첫 기사", body: ARTICLE, publisher: "연합뉴스", publishedAt: "2026-09-22", sourceUrl: FEED.items[0]!.url } },
    });
    renderScreen();

    fireEvent.click(await screen.findByTestId(`news-feed-item-${FEED.items[0]!.url}`));
    fireEvent.click(screen.getByTestId("news-fetch"));
    await screen.findByTestId("news-fetch-ok");

    /* 두 번째 줄을 누르면 주소만 바뀝니다 — 아래 글은 아직 첫 기사입니다. */
    fireEvent.click(screen.getByTestId(`news-feed-item-${FEED.items[1]!.url}`));

    expect(screen.getByTestId("news-fetch-stale").textContent).toContain("앞 기사");
    /* 🔴 「가져왔습니다」 초록 줄이 남아 있으면, 그 줄이 **지금 아래 글을 보증하는 것처럼** 읽힙니다. */
    expect(screen.queryByTestId("news-fetch-ok")).toBeNull();
  });

  it("says nothing while the address and the article below are the same one", async () => {
    stubRoutes({
      "GET /news/feed": FEED,
      "POST /news/article": { outcome: "article", article: { title: "첫 기사", body: ARTICLE, publisher: "연합뉴스", publishedAt: "2026-09-22", sourceUrl: FEED.items[0]!.url } },
    });
    renderScreen();

    fireEvent.click(await screen.findByTestId(`news-feed-item-${FEED.items[0]!.url}`));
    fireEvent.click(screen.getByTestId("news-fetch"));
    await screen.findByTestId("news-fetch-ok");

    expect(screen.queryByTestId("news-fetch-stale")).toBeNull();
  });

  it("does not cry stale before anything has been fetched at all", async () => {
    stubRoutes({ "GET /news/feed": FEED });
    renderScreen();

    fireEvent.click(await screen.findByTestId(`news-feed-item-${FEED.items[0]!.url}`));

    /* 아래 칸이 비어 있으면 어긋날 것이 없습니다. */
    expect(screen.queryByTestId("news-fetch-stale")).toBeNull();
  });
});

});

/**
 * 🔴 **누르기 전에 말합니다.** 속보는 본문이 한두 문장이라 서버의 400자 칸에 걸려 못 가져옵니다 — 고장이
 * 아니라 기사가 얇은 것인데, 누른 뒤에 「본문을 못 찾았습니다」만 뜨면 앱이 깨진 줄 압니다.
 */
describe("NewsReelScreen 속보", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const FLASH = { url: "https://www.yna.co.kr/view/f1", host: "yna.co.kr", publisher: "연합뉴스", title: "[속보] 한미일 \"대만해협 평화 유지\"", publishedAt: "2026-09-22T01:22:00.000Z", imageUrl: null };
  const PLAIN = { url: "https://www.yna.co.kr/view/p1", host: "yna.co.kr", publisher: "연합뉴스", title: "한미일 외교장관 회담 결과", publishedAt: "2026-09-22T01:00:00.000Z", imageUrl: null };

  it("knows a flash by its bracket, and does not mistake a wrap-up for one", () => {
    expect(feedItemIsFlash("[속보] 한미일 회담")).toBe(true);
    expect(feedItemIsFlash("[1보] 한미일 회담")).toBe(true);
    /* 🟠 「종합」은 본문이 있는 기사입니다 — 같이 묶으면 멀쩡한 기사에 경고가 붙습니다. */
    expect(feedItemIsFlash("[종합] 한미일 회담")).toBe(false);
    expect(feedItemIsFlash("한미일 회담 결과")).toBe(false);
  });

  it("says so on the row, before it is pressed", async () => {
    stubRoutes({ "GET /news/feed": { items: [FLASH, PLAIN], unavailable: [] } });
    renderScreen();

    await screen.findByTestId(`news-feed-item-${FLASH.url}`);
    expect(screen.getByTestId(`news-feed-flash-${FLASH.url}`).textContent).toContain("속보");
    /* 🔴 일반 기사에는 안 붙습니다 — 다 붙으면 아무 말도 아닙니다. */
    expect(screen.queryByTestId(`news-feed-flash-${PLAIN.url}`)).toBeNull();
  });

  it("does not block it — a flash with a body still works", async () => {
    stubRoutes({
      "GET /news/feed": { items: [FLASH], unavailable: [] },
      "POST /news/article": { outcome: "article", article: { title: FLASH.title, body: ARTICLE, publisher: "연합뉴스", publishedAt: "2026-09-22", sourceUrl: FLASH.url } },
    });
    renderScreen();

    fireEvent.click(await screen.findByTestId(`news-feed-item-${FLASH.url}`));
    expect(screen.getByTestId("news-fetch")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("news-fetch"));

    await screen.findByTestId("news-fetch-ok");
  });

  it("gives the real reason when the body could not be found, not the generic one alone", async () => {
    stubRoutes({
      "GET /news/feed": { items: [FLASH], unavailable: [] },
      "POST /news/article": { outcome: "body_not_found", title: FLASH.title, publisher: "연합뉴스", publishedAt: "2026-09-22", sourceUrl: FLASH.url },
    });
    renderScreen();

    fireEvent.click(await screen.findByTestId(`news-feed-item-${FLASH.url}`));
    fireEvent.click(screen.getByTestId("news-fetch"));

    const why = await screen.findByTestId("news-fetch-flash-why");
    /* 🔴 「못 가려냈다」와 「원래 짧다」는 할 일이 다릅니다 — 뒤엣것은 다른 기사를 고르는 게 답입니다. */
    expect(why.textContent).toContain("일반 기사");
  });

  it("says nothing about flashes when an ordinary article simply failed", async () => {
    stubRoutes({
      "GET /news/feed": { items: [PLAIN], unavailable: [] },
      "POST /news/article": { outcome: "body_not_found", title: PLAIN.title, publisher: "연합뉴스", publishedAt: "2026-09-22", sourceUrl: PLAIN.url },
    });
    renderScreen();

    fireEvent.click(await screen.findByTestId(`news-feed-item-${PLAIN.url}`));
    fireEvent.click(screen.getByTestId("news-fetch"));

    await screen.findByTestId("news-fetch-body-not-found");
    expect(screen.queryByTestId("news-fetch-flash-why")).toBeNull();
  });
});

/**
 * 🔴 **그림이 글보다 먼저입니다.** 자막이 장면마다 하나라, **몇 장을 골랐는지**가 다음 화면의 자막 칸 수를
 * 정합니다 — 캡틴D: *「릴스가 몇 장면 몇 분인 줄 알고 이렇게 적음?」*
 */
describe("NewsReelScreen 그림 먼저", () => {
  const ASSETS = [
    makeAsset({ assetId: "ASSET-GENERAL-000000000001", displayName: "국회 본회의장" }),
    makeAsset({ assetId: "ASSET-GENERAL-000000000002", displayName: "법원 앞" }),
  ];

  function stubWithAssets(extra: Record<string, unknown> = {}): void {
    stubRoutes({ "GET /assets": { assets: ASSETS }, ...extra });
  }

  function renderForNext(): ReturnType<typeof vi.fn> {
    const onNext = vi.fn();
    render(<NewsReelScreen onBack={() => {}} onNext={onNext} />);
    return onNext;
  }

  async function fetchArticle(): Promise<void> {
    fireEvent.change(screen.getByTestId("news-fetch-url"), { target: { value: "https://www.yna.co.kr/view/1" } });
    fireEvent.click(screen.getByTestId("news-fetch"));
    await screen.findByTestId("news-fetch-ok");
  }

  afterEach(() => { vi.unstubAllGlobals(); });

  it("will not go on without a picture, and says the pictures decide the caption boxes", async () => {
    stubWithAssets({ "POST /news/article": { outcome: "article", article: { title: "첫 기사", body: ARTICLE, publisher: "연합뉴스", publishedAt: "2026-09-22", sourceUrl: "https://www.yna.co.kr/view/1" } } });
    renderForNext();
    await fetchArticle();

    expect(screen.getByTestId("news-reel-next")).toBeDisabled();
    expect(screen.getByTestId("news-reel-next-why").textContent).toContain("그림");
  });

  it("hands the article and the pictures on, in the order they were pressed", async () => {
    stubWithAssets({ "POST /news/article": { outcome: "article", article: { title: "첫 기사", body: ARTICLE, publisher: "연합뉴스", publishedAt: "2026-09-22", sourceUrl: "https://www.yna.co.kr/view/1" } } });
    const onNext = renderForNext();
    await fetchArticle();

    fireEvent.click(await screen.findByTestId(`news-reel-picture-asset-${ASSETS[1]!.assetId}`));
    fireEvent.click(screen.getByTestId(`news-reel-picture-asset-${ASSETS[0]!.assetId}`));
    fireEvent.click(screen.getByTestId("news-reel-next"));

    const draft = onNext.mock.calls[0]?.[0];
    /* 🔴 고른 순서가 곧 장면 순서입니다. */
    expect(draft.assetIds).toEqual([ASSETS[1]!.assetId, ASSETS[0]!.assetId]);
    expect(draft.article.body).toContain("검찰청");
    expect(draft.article.publisher).toBe("연합뉴스");
    expect(draft.clipDurationSeconds).toBe(5);
  });

  it("says how many pictures the next screen will ask captions for", async () => {
    stubWithAssets({ "POST /news/article": { outcome: "article", article: { title: "첫 기사", body: ARTICLE, publisher: "연합뉴스", publishedAt: "2026-09-22", sourceUrl: "https://www.yna.co.kr/view/1" } } });
    renderForNext();
    await fetchArticle();

    fireEvent.click(await screen.findByTestId(`news-reel-picture-asset-${ASSETS[0]!.assetId}`));

    expect(screen.getByTestId("news-reel-next").textContent).toContain("1장");
  });

  it("will not go on without the publisher — that name goes in the band", async () => {
    stubWithAssets({ "POST /news/article": { outcome: "article", article: { title: "첫 기사", body: ARTICLE, publisher: "연합뉴스", publishedAt: "2026-09-22", sourceUrl: "https://www.yna.co.kr/view/1" } } });
    const onNext = renderForNext();
    await fetchArticle();
    fireEvent.click(await screen.findByTestId(`news-reel-picture-asset-${ASSETS[0]!.assetId}`));
    fireEvent.change(screen.getByTestId("news-outlet"), { target: { value: "" } });

    expect(screen.getByTestId("news-reel-next")).toBeDisabled();
    expect(screen.getByTestId("news-reel-next-why").textContent).toContain("언론사");
    fireEvent.click(screen.getByTestId("news-reel-next"));
    expect(onNext).not.toHaveBeenCalled();
  });
});

/**
 * 🔴 캡틴D, 2026-09-22: *「난 기사 내용을 모르는데 사진을 골라도 됨?」* · *「스포츠를 넣어야 할지 주식인지
 * 국회인지 몰라」* — 그림을 고르는 자리에서 **기사가 안 보였습니다.** 제목은 사람·기관 이름을 빼고 쓰는 일이
 * 많아 읽어도 무슨 일인지 모르고, 본문은 접힌 칸 안에 있었습니다.
 */
describe("NewsReelScreen 무엇에 대한 기사인지", () => {
  const 국회 = makeAsset({ assetId: "ASSET-GENERAL-000000000001", displayName: "국회 본회의장", parentFolderId: "FOLDER-NEWS" });
  const 법원 = makeAsset({ assetId: "ASSET-GENERAL-000000000002", displayName: "법원 앞", parentFolderId: "FOLDER-NEWS" });
  const 주식 = makeAsset({ assetId: "ASSET-GENERAL-000000000003", displayName: "전광판", parentFolderId: "FOLDER-ECON" });
  const 떠도는것 = makeAsset({ assetId: "ASSET-GENERAL-000000000004", displayName: "폴더 밖 그림", parentFolderId: "" });
  const 뉴스폴더 = makeAssetFolder({ assetId: "FOLDER-NEWS", displayName: "뉴스릴스", childAssetIds: [국회.assetId, 법원.assetId] });
  const 경제폴더 = makeAssetFolder({ assetId: "FOLDER-ECON", displayName: "경제", childAssetIds: [주식.assetId] });
  /* 🟠 그림이 한 장도 없는 폴더 — 줄이 되면 안 됩니다(고르면 빈 격자가 나옵니다). */
  const 빈폴더 = makeAssetFolder({ assetId: "FOLDER-EMPTY", displayName: "스포츠릴스", childAssetIds: [] });
  /* 🔴 프로젝트가 스스로 만든 폴더 — 캡틴D 보관함에 **열여섯 개**가 있고, 전부 주제가 아니라 작업 부산물입니다. */
  const 부산물 = makeAsset({ assetId: "ASSET-GENERAL-000000000005", displayName: "회차 그림", parentFolderId: "FOLDER-EP01", sourceProjectId: "12" });
  const 부산물폴더 = makeAssetFolder({ assetId: "FOLDER-EP01", displayName: "12/Episode01 generated images", sourceProjectId: "12", childAssetIds: [부산물.assetId] });

  const ARTICLE_WITH_TAILS = [
    "(서울=연합뉴스) 김유아 기자 = 조희대 대법원장이 청와대의 재제청 요구를 거부했다.",
    "법원 내부에서는 사법부 독립을 지킨 판단이라는 평가가 나온다.",
    "반면 여권에서는 자기 정치라는 비판도 제기된다.",
    "네 번째 문장은 리드에 안 들어간다.",
    "2026/09/22 19:19 송고",
  ].join("\n");

  function stubWithFolders(): void {
    stubRoutes({
      "GET /assets": { assets: [뉴스폴더, 경제폴더, 빈폴더, 부산물폴더, 국회, 법원, 주식, 떠도는것, 부산물] },
      "POST /news/article": { outcome: "article", article: { title: "\"대법원장 자기 정치\" vs \"법리적 판단\"", body: ARTICLE_WITH_TAILS, publisher: "연합뉴스", publishedAt: "2026-09-22", sourceUrl: "https://www.yna.co.kr/view/1" } },
    });
  }

  async function open(): Promise<void> {
    render(<NewsReelScreen onBack={() => {}} onNext={vi.fn()} />);
    fireEvent.change(screen.getByTestId("news-fetch-url"), { target: { value: "https://www.yna.co.kr/view/1" } });
    fireEvent.click(screen.getByTestId("news-fetch"));
    await screen.findByTestId("news-fetch-ok");
  }

  afterEach(() => { vi.unstubAllGlobals(); });

  it("reads a lead out of the body: no dateline, no filing line, first sentences only", () => {
    const lead = newsArticleLead(ARTICLE_WITH_TAILS);

    expect(lead).toContain("조희대 대법원장이 청와대의 재제청 요구를 거부했다");
    /* 어느 기사에나 붙는 머리표와 꼬리표는 읽을 것이 없습니다. */
    expect(lead).not.toContain("기자 =");
    expect(lead).not.toContain("송고");
    /* 🟠 리드는 **앞 세 문장**입니다 — 본문 전체를 옮기면 접힌 칸을 편 것과 같아집니다. */
    expect(lead).not.toContain("네 번째 문장");
  });

  it("shows that lead beside the pictures, without the article box being opened", async () => {
    stubWithFolders();
    await open();

    expect(screen.getByTestId("news-reel-article-lead").textContent).toContain("재제청 요구를 거부했다");
    /* 🔴 접힌 칸은 접힌 그대로입니다 — 리드는 그것을 펴지 않고도 보이라고 있는 것입니다. */
    expect((screen.getByTestId("news-article-disclosure") as HTMLDetailsElement).open).toBe(false);
  });

  /**
   * 🔴 캡틴D, 2026-09-22: *「폴더 보기가 너무 힘들어」* — 폴더 스물셋을 단추로 늘어놓으니 여섯 줄이 됐고,
   * 그 중 열여섯이 **프로젝트가 스스로 만든 폴더**였습니다. 주제가 아니라 작업 부산물입니다.
   */
  it("offers only the folders a person made, with counts, and skips one that holds no picture", async () => {
    stubWithFolders();
    await open();

    await screen.findByTestId(`news-reel-picture-asset-${국회.assetId}`);
    const topics = screen.getByTestId("news-reel-picture-folder") as HTMLSelectElement;
    const labels = [...topics.options].map((option) => option.textContent ?? "");

    /* 🟠 장수를 같이 적습니다 — 2장인지 20장인지 모르고 고르면 고른 뒤에야 빈 격자를 봅니다. */
    expect(labels.some((one) => one.includes("뉴스릴스") && one.includes("2장"))).toBe(true);
    expect(labels.some((one) => one.includes("경제") && one.includes("1장"))).toBe(true);
    expect(labels.some((one) => one.includes("전체"))).toBe(true);
    /* 그림 없는 폴더도, 프로젝트가 만든 폴더도 주제가 아닙니다. */
    expect(labels.some((one) => one.includes("스포츠릴스"))).toBe(false);
    expect(labels.some((one) => one.includes("generated images"))).toBe(false);
  });

  it("narrows the grid to one topic, and keeps what was already picked", async () => {
    stubWithFolders();
    await open();

    fireEvent.click(await screen.findByTestId(`news-reel-picture-asset-${국회.assetId}`));
    fireEvent.change(screen.getByTestId("news-reel-picture-folder"), { target: { value: "FOLDER-ECON" } });

    expect(screen.getByTestId(`news-reel-picture-asset-${주식.assetId}`)).toBeTruthy();
    expect(screen.queryByTestId(`news-reel-picture-asset-${국회.assetId}`)).toBeNull();
    /* 🔴 안 보이는 것과 안 골라진 것은 다릅니다 — 고른 수는 그대로고, 몇 장이 숨었는지 말합니다. */
    expect(screen.getByTestId("news-reel-picture-length").textContent).toContain("1장");
    expect(screen.getByTestId("news-reel-picture-folder-hidden").textContent).toContain("1장");

    fireEvent.change(screen.getByTestId("news-reel-picture-folder"), { target: { value: "__all__" } });
    expect(screen.getByTestId(`news-reel-picture-asset-${국회.assetId}`)).toBeTruthy();
    expect(screen.queryByTestId("news-reel-picture-folder-hidden")).toBeNull();
  });
});
