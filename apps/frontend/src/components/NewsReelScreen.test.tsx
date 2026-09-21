import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NEWS_REEL_TEXT_BOXES, type NewsReelTextField } from "@ai-animation-studio/shared";
import { stubFetchByRoute } from "../api/testUtils.js";
import { NewsReelScreen, feedItemTime } from "./NewsReelScreen.js";

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
  const routes: Record<string, unknown> = { "GET /news/setup": setup, "GET /news/feed": { items: [], unavailable: [] } };
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

function renderScreen(): void {
  render(<NewsReelScreen onBack={() => {}} onUseCard={vi.fn()} />);
}

/** 넘겨주는 쪽을 보는 짝은 **그 함수**를 돌려받아야 합니다 — 위 헬퍼는 요약 쪽을 돌려줍니다. */
function renderScreenForCard(): ReturnType<typeof vi.fn> {
  const onUseCard = vi.fn();
  render(<NewsReelScreen onBack={() => {}} onUseCard={onUseCard} />);
  return onUseCard;
}

async function typeUrlAndFetch(url: string): Promise<void> {
  fireEvent.change(screen.getByTestId("news-fetch-url"), { target: { value: url } });
  fireEvent.click(screen.getByTestId("news-fetch"));
}

function fill(article: string, summary: string, withSource = true): void {
  fireEvent.change(screen.getByTestId("news-article"), { target: { value: article } });
  fireEvent.change(screen.getByTestId("news-summary"), { target: { value: summary } });
  if (withSource) {
    fireEvent.change(screen.getByTestId("news-outlet"), { target: { value: "서울경제" } });
    fireEvent.change(screen.getByTestId("news-published"), { target: { value: "2026-09-17" } });
    fireEvent.change(screen.getByTestId("news-url"), { target: { value: "https://example.test/a" } });
  }
}

describe("NewsReelScreen", () => {
  beforeEach(() => { stubRoutes(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  /**
   * 🔴 이 화면의 존재 이유는 편의가 아니라 **막는 것**입니다. 요약 AI 는 원문에 없는 숫자·날짜·인용문을
   * 그럴듯하게 지어내고, 뉴스에서는 그게 틀린 사실을 예쁘게 만들어 퍼뜨립니다. 그래서 짝의 첫 줄은
   * 「대조가 걸리면 넘어갈 수 없다」입니다 — 경고만 띄우고 버튼을 살려 두면 사람은 버튼을 누릅니다.
   */
  it("will not hand the four lines on while anything in them is missing from the article", () => {
    const onUseCard = renderScreenForCard();
    fill(ARTICLE, "국회가 후속 법안 51건을 통과시켰다.");
    /* 🔴 구워지는 것은 **네 줄**입니다 — 요약이 통과해도 네 줄이 지어내면 막혀야 합니다. */
    fireEvent.change(screen.getByTestId("news-reel-headline1"), { target: { value: "후속 법안 53건" } });
    fireEvent.change(screen.getByTestId("news-reel-headline2"), { target: { value: "국회 본회의 통과" } });
    fireEvent.change(screen.getByTestId("news-reel-caption1"), { target: { value: "재석 289명 중 180명 찬성" } });

    expect(screen.getByTestId("news-reel-check-failed").textContent).toContain("53건");
    expect(screen.getByTestId("news-reel-use")).toBeDisabled();
    expect(screen.getByTestId("news-reel-use-why").textContent).toContain("대조");
    fireEvent.click(screen.getByTestId("news-reel-use"));
    expect(onUseCard).not.toHaveBeenCalled();
  });

  it("names what it could not find, and what kind of thing it was", () => {
    renderScreen();
    fill(ARTICLE, '개정법은 10월 12일부터 시행된다. 여당은 "완벽한 개혁이다"라고 말했다.');

    expect(screen.getByTestId("news-unverified-date").textContent).toContain("10월 12일");
    expect(screen.getByTestId("news-unverified-quote").textContent).toContain("완벽한 개혁이다");
  });

  it("hands the four lines on once they check out against the article", () => {
    const onUseCard = renderScreenForCard();
    fill(ARTICLE, "국회가 2026년 9월 17일 후속 법안 51건을 통과시켰다.");
    fireEvent.change(screen.getByTestId("news-reel-headline1"), { target: { value: "후속 법안 51건" } });
    fireEvent.change(screen.getByTestId("news-reel-headline2"), { target: { value: "국회 본회의 통과" } });
    fireEvent.change(screen.getByTestId("news-reel-caption1"), { target: { value: "10월 2일부터 시행" } });

    expect(screen.queryByTestId("news-reel-check-failed")).toBeNull();
    fireEvent.click(screen.getByTestId("news-reel-use"));

    expect(onUseCard.mock.calls[0]?.[0].headline.line1).toContain("51건");
  });

  /**
   * 🔴 「검사할 게 없었다」와 「통과했다」는 다른 사실입니다. 숫자도 날짜도 따옴표도 없는 요약은 이 검사가
   * 아무것도 보지 못한 것이고, 초록으로 칠하면 **보지 않은 것을 봤다고 말하는 셈**입니다. 막지는 않되
   * 초록이라고도 하지 않는 자리가 따로 있어야 합니다.
   */
  it("does not call an unchecked summary verified", () => {
    renderScreen();
    fill(ARTICLE, "국회가 검찰 제도를 크게 바꾸기로 했다.");

    expect(screen.queryByTestId("news-check-passed")).toBeNull();
    expect(screen.getByTestId("news-check-empty").textContent).toContain("확인된 것도 없습니다");
  });

  /* 🔴 대조할 것이 없는 네 줄도 **막지 않습니다** — 딱딱한 사실이 없다고 틀린 글은 아닙니다. */
  it("does not block four lines that simply have nothing to check", () => {
    renderScreenForCard();
    fill(ARTICLE, "국회가 검찰 제도를 크게 바꾸기로 했다.");
    fireEvent.change(screen.getByTestId("news-reel-headline1"), { target: { value: "검찰 제도 개편" } });
    fireEvent.change(screen.getByTestId("news-reel-headline2"), { target: { value: "국회가 결정했다" } });
    fireEvent.change(screen.getByTestId("news-reel-caption1"), { target: { value: "본회의 표결 뒤 회의장" } });

    expect(screen.queryByTestId("news-reel-check-failed")).toBeNull();
    expect(screen.getByTestId("news-reel-use")).not.toBeDisabled();
  });

  /**
   * 🔴 초록 한 줄은 「사실 확인 끝」으로 읽힙니다. 이 검사는 기사에 **없는** 값만 잡고, 있는 값을 엉뚱한
   * 곳에 붙였거나 뜻을 뒤집은 것은 못 잡습니다. 화면이 그걸 직접 말하지 않으면 이 화면은 자기가 막으려던
   * 것보다 더 나쁜 오해를 만듭니다 — 그래서 한계 문구는 통과했을 때도 그대로 있어야 합니다.
   */
  it("says what the check cannot catch, even while it is green", () => {
    renderScreen();
    fill(ARTICLE, "국회가 후속 법안 51건을 통과시켰다.");

    expect(screen.getByTestId("news-check-passed")).toBeTruthy();
    const limit = screen.getByTestId("news-check-limit").textContent ?? "";
    expect(limit).toContain("못 잡습니다");
    expect(limit).toContain("기사와 한 번 읽어");
  });

  /**
   * 🔴 출처 없이 남의 글로 무언가를 만드는 것은 이 기능이 하려던 일이 아닙니다.
   *
   * 🟠 넘기는 길이 바뀌면서 그 자리를 **언론사 칸**이 맡습니다 — 릴은 출처 한 줄이 아니라 **위 띠에 언론사
   * 이름**을 박고, 계약이 `publisher` 를 필수로 받습니다. 「출처 없이는 안 넘어간다」는 규칙은 그대로입니다.
   */
  it("will not hand anything on without a publisher", () => {
    const onUseCard = renderScreenForCard();
    fill(ARTICLE, "국회가 후속 법안 51건을 통과시켰다.", false);
    fireEvent.change(screen.getByTestId("news-reel-headline1"), { target: { value: "후속 법안 51건" } });
    fireEvent.change(screen.getByTestId("news-reel-headline2"), { target: { value: "국회 본회의 통과" } });
    fireEvent.change(screen.getByTestId("news-reel-caption1"), { target: { value: "표결 직후 본회의장" } });

    expect(screen.getByTestId("news-reel-use")).toBeDisabled();
    fireEvent.click(screen.getByTestId("news-reel-use"));
    expect(onUseCard).not.toHaveBeenCalled();
  });

  /**
   * 🔴 이 짝이 붙드는 것은 **화면이 문지기가 되지 않는 것**입니다.
   *
   * 언론사 목록이 화면에 오는 이유는 사람에게 **보여 주려고**지 화면이 판정하라고가 아닙니다. 정말로 중요한
   * 호스트는 리다이렉트가 마지막에 떨어지는 곳이고 그건 서버만 봅니다(CLI Round 929 §2). 여기서 미리 걸러 주면
   * 친절해 보이지만 **진짜 검사가 존재하는 이유인 바로 그 주소들에 대해 틀린** 두 번째 사본이 됩니다.
   *
   * 위험한 건 코드가 아니라 **나중에 들어올 선의**라, 그 선의가 닿는 자리에 짝을 놓습니다 — 누가
   * `disabled` 에 목록 조건을 더하는 순간 이 줄이 웁니다.
   */
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
    expect(screen.getByTestId("news-source-line").textContent).toContain("https://sedaily.com/final");
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

  /**
   * 🔴 **940 의 짝이 여기서 제 역할을 끝냈습니다.** 그때는 「이 수를 깎는 버튼이 없으니 수도 안 보인다」를 붙들고
   * 있었고, 그 버튼이 생기는 순간 울도록 짜 두었습니다. 울었고, 그래서 이 자리로 바뀌었습니다 — 주석이었으면
   * 아무도 안 깨웠을 것입니다(CLI Round 937 §2).
   */
  it("shows the day's count beside the button that spends it", async () => {
    renderScreen();

    expect((await screen.findByTestId("news-daily-calls")).textContent).toContain("2 / 10");
    expect(screen.getByTestId("news-summarize")).toBeTruthy();
  });

  /**
   * 🔴 `dailyCalls: null` 은 **「여유 있음」이 아니라 「모르니까 안 부른다」**입니다. 숫자를 안 그리는 것만으로는
   * 모자랍니다 — 아무 말이 없으면 사람은 **문제가 없다고** 읽고 버튼을 찾습니다. 그래서 세 줄이 함께 섭니다:
   * 숫자는 없고, 이유는 있고, 버튼은 닫힙니다.
   *
   * 🟠 그리고 그 이유가 **어느 파일을 볼지** 말해야 합니다. 「이번 달 사용액」을 말하는 예산 쪽 문장을 그대로
   * 썼다면 사람이 `api_budget_usage.json` 을 열어 보고 멀쩡한 걸 확인한 뒤 막힌 이유를 못 찾습니다(CLI 935 §1).
   */
  it("closes the button and says which file, when the ledger cannot be read", async () => {
    stubRoutes({}, { publishers: PUBLISHERS, dailyCalls: null });
    renderScreen();

    const notice = await screen.findByTestId("news-calls-unknown");
    expect(notice.textContent).toContain("news_call_usage.json");
    expect(screen.queryByTestId("news-daily-calls")).toBeNull();
    expect(screen.getByTestId("news-summarize")).toBeDisabled();
  });

  it("closes the button when today's allowance is already spent", async () => {
    stubRoutes({}, { publishers: PUBLISHERS, dailyCalls: { used: 10, limit: 10 } });
    renderScreen();

    await screen.findByTestId("news-daily-calls");
    expect(screen.getByTestId("news-summarize")).toBeDisabled();
  });

  /**
   * 🔴 거절은 **새 건수를 싣고 오지 않습니다.** 그러면 화면이 들고 있는 수는 한 번 낡은 것이고, 그 낡은 수로
   * 버튼을 열어 두면 다음 누름이 또 거절됩니다 — 서버가 방금 「다 썼다」고 말했는데도요.
   */
  it("closes the button when the server says the day is spent, even though the count it holds says otherwise", async () => {
    stubRoutes({ "POST /news/summaries": { status: 409, body: { code: "NEWS_DAILY_LIMIT_REACHED", message: "" } } });
    renderScreen();
    await screen.findByTestId("news-daily-calls");
    fireEvent.change(screen.getByTestId("news-article"), { target: { value: ARTICLE } });

    fireEvent.click(screen.getByTestId("news-summarize"));

    expect((await screen.findByTestId("news-summary-error")).textContent).toContain("내일");
    // 들고 있는 수는 2/10 이라 「8번 남음」인데도 닫혀 있어야 합니다.
    expect(screen.getByTestId("news-summarize")).toBeDisabled();
  });

  it("fills the summary and moves the count on, then checks what came back", async () => {
    stubRoutes({
      "POST /news/summaries": {
        summary: "국회가 후속 법안 51건을 통과시켰다.",
        check: { claims: [], missing: [] },
        dailyCalls: { used: 3, limit: 10 },
      },
    });
    renderScreen();
    await screen.findByTestId("news-daily-calls");
    fireEvent.change(screen.getByTestId("news-article"), { target: { value: ARTICLE } });

    fireEvent.click(screen.getByTestId("news-summarize"));

    await waitFor(() => expect((screen.getByTestId("news-summary") as HTMLTextAreaElement).value).toContain("51건"));
    expect(screen.getByTestId("news-daily-calls").textContent).toContain("3 / 10");
    /* 🔴 서버가 준 `check` 를 따로 그리지 않고, **화면의 살아 있는 대조**가 같은 결론을 냅니다. 둘을 다 그리면
       사람이 문장을 고치는 순간 서버 것은 「옛 문장에 대한 판정」으로 굳어 남습니다. */
    expect(screen.getByTestId("news-check-passed")).toBeTruthy();
  });

  /**
   * 🔴 길다고 **자르지 않습니다.** 길이로 자르면 `4,000` 이 `4,0` 이 되고, 그러면 대조기가 **우리 편집을 보고**
   * 「기사에 없는 숫자」라고 합니다 — 가드가 우리 때문에 우는 자리입니다(CLI 943 §1).
   */
  it("says a summary is too long without shortening it", async () => {
    const long = "국회가 후속 법안 51건을 통과시켰다. " + "길어진 문장입니다. ".repeat(20);
    stubRoutes({
      "POST /news/summaries": {
        summary: long,
        check: { claims: [], missing: [] },
        dailyCalls: { used: 3, limit: 10 },
        tooLong: true,
      },
    });
    renderScreen();
    await screen.findByTestId("news-daily-calls");
    fireEvent.change(screen.getByTestId("news-article"), { target: { value: ARTICLE } });

    fireEvent.click(screen.getByTestId("news-summarize"));

    await screen.findByTestId("news-summary-too-long");
    expect((screen.getByTestId("news-summary") as HTMLTextAreaElement).value).toBe(long);
  });

  it("waits for both halves before saying anything about the summary", () => {
    renderScreen();
    expect(screen.getByTestId("news-check-idle")).toBeTruthy();

    fireEvent.change(screen.getByTestId("news-summary"), { target: { value: "요약만 있습니다." } });
    // 기사 본문이 없으면 대조할 대상이 없습니다 — 그때 초록을 띄우면 아무 근거 없이 통과시킨 것입니다.
    expect(screen.getByTestId("news-check-idle")).toBeTruthy();
    expect(screen.queryByTestId("news-check-passed")).toBeNull();
  });
});

const FEED_ITEM = {
  title: "국회, 검찰청 폐지 후속 법률 51건 통과",
  url: "https://www.yna.co.kr/view/AKR20260917000100001",
  publisher: "연합뉴스",
  host: "yna.co.kr",
  publishedAt: "2026-09-17T09:12:00.000Z",
  // 🟠 The contract carries a picture address and half the rows have none — 뉴시스, 경향, 한겨레 advertise
  // no picture at all — so `null` is what an ordinary row looks like, not a missing field.
  imageUrl: null,
};

/**
 * 🔴 캡틴D: *「뉴스 릴은 내가 직접 주소를 쳐야 하잖아. 그게 너무 귀찮은데」*
 *
 * 목록은 **주소를 치는 수고만** 없앱니다 — 본문은 여전히 같은 허용 목록과 같은 리다이렉트 검사를 지나
 * `POST /news/article` 로 갑니다. 「더 믿을 수 있는 길」이 아닙니다.
 */
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

  it("opens itself when a fetch fills the boxes, because now there is something to look at", async () => {
    stubRoutes({
      "POST /news/article": { outcome: "article", article: { title: "국회, 검찰청 폐지 후속 법률 51건 통과", body: ARTICLE, publisher: "연합뉴스", publishedAt: "2026-09-17T09:12:00.000Z", sourceUrl: "https://www.yna.co.kr/view/AKR1" } },
    });
    renderScreen();
    await screen.findByTestId("news-article-disclosure");

    await typeUrlAndFetch("https://www.yna.co.kr/view/AKR1");

    await waitFor(() => {
      expect((screen.getByTestId("news-article-disclosure") as HTMLDetailsElement).open, "채워졌으니 펼칩니다").toBe(true);
    });
    expect(screen.getByTestId("news-article-disclosure").textContent).toContain("채워져 있습니다");
  });

  /**
   * 🔴 본문만 못 찾은 것은 **실패가 아니라 남은 한 걸음이 사람 것**이라는 뜻이고, 그 한 걸음이 바로 이 칸
   * 안에 있습니다. 접어 둔 채로 두면 **할 일을 감춘 채 하라고 하는 것**입니다.
   */
  it("opens itself when the body could not be found, because that is where the person's step is", async () => {
    stubRoutes({
      "POST /news/article": { outcome: "body_not_found", title: "태풍 북상", publisher: "MBC", publishedAt: "2026-09-17T09:12:00.000Z", sourceUrl: "https://imbc.com/news/1" },
    });
    renderScreen();
    await screen.findByTestId("news-article-disclosure");

    await typeUrlAndFetch("https://imbc.com/news/1");

    await waitFor(() => {
      expect((screen.getByTestId("news-article-disclosure") as HTMLDetailsElement).open).toBe(true);
    });
  });
});

/**
 * 릴에 박히는 네 줄.
 *
 * 🔴 **짝이 15·20 을 직접 안 적습니다.** 계약에서 읽어 와서 그 길이로 글자를 만듭니다 — 숫자를 여기 적으면
 * 계약이 바뀌는 날 **짝이 옛 숫자를 지키게** 되고, 그때 빨개지는 건 화면이 아니라 짝입니다.
 */
describe("NewsReelScreen 릴 문구", () => {
  beforeEach(() => { stubRoutes(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const filler = (count: number): string => "가".repeat(count);
  const limitOf = (field: NewsReelTextField): number => NEWS_REEL_TEXT_BOXES[field].limit;

  it("counts against the contract's limit, not a number written into the screen", async () => {
    renderScreen();
    const limit = limitOf("headline.line1");

    fireEvent.change(screen.getByTestId("news-reel-headline1"), { target: { value: filler(limit) } });

    /* 🟠 「limit/limit」 그대로입니다 — 꽉 찬 것은 넘은 것이 아닙니다. */
    expect(screen.getByTestId("news-reel-headline1-count").textContent).toContain(`${limit}/${limit}`);
    expect(screen.getByTestId("news-reel-headline1-count").textContent).not.toContain("넘었습니다");

    /* 🔴 **한도가 다른 칸을 같이 칩니다.** 제목만 보면 화면이 15를 박아 넣어도 이 짝은 초록입니다 — 제목의
       한도가 마침 15라서입니다. 실제로 주입해 보니 그랬습니다(CLI Round 1037 §1): 잡은 것은 이 짝이 아니라
       자막을 치는 옆 짝이었고, 그건 우연이었습니다. **한 값만 치는 짝은 그 값이 맞는지만 압니다.** */
    const captionLimit = limitOf("caption.line1");
    expect(captionLimit, "두 칸의 한도가 달라야 이 짝이 뜻이 있습니다").not.toBe(limit);
    fireEvent.change(screen.getByTestId("news-reel-caption1"), { target: { value: filler(captionLimit) } });
    expect(screen.getByTestId("news-reel-caption1-count").textContent).toContain(`${captionLimit}/${captionLimit}`);
  });

  it("says how far over, not just that it is over", async () => {
    renderScreen();
    const limit = limitOf("caption.line1");

    fireEvent.change(screen.getByTestId("news-reel-caption1"), { target: { value: filler(limit + 3) } });

    /* 🔴 「넘었습니다」만 적으면 **얼마나 지울지**를 사람이 세어야 합니다. */
    expect(screen.getByTestId("news-reel-caption1-count").textContent).toContain("3자 넘었습니다");
  });

  it("leaves an untouched box quiet — not yet written is not the same as wrong", async () => {
    renderScreen();

    for (const box of ["headline1", "headline2", "caption1", "caption2"]) {
      expect(screen.getByTestId(`news-reel-${box}-count`).className).not.toContain("rose");
    }
  });

  it("counts a box of only spaces as empty, so it never becomes an empty string in the card", async () => {
    renderScreen();

    fireEvent.change(screen.getByTestId("news-reel-caption2"), { target: { value: "   " } });

    /* 🔴 `""` 는 계약이 값으로 안 칩니다(CLI 1029 §3). 공백만 친 칸도 **없는 것**이라야 `null` 로 넘어갑니다. */
    expect(screen.getByTestId("news-reel-caption2-count").textContent).toContain("0/");
  });

});

/**
 * 「기사에서 네 줄 뽑기」 — `POST /news/card-text`.
 *
 * 🔴 돈이 나간 답이라 **버리는 것이 없어야** 합니다. 칸은 받은 그대로 채우고(자르지 않음), 두 번 온 칸은
 * 고르지 않고 비워 두고, 못 넣은 줄은 보여 줍니다.
 */
describe("NewsReelScreen 네 줄 뽑기", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const answer = (overrides: Record<string, unknown> = {}) => ({
    values: {},
    missing: [],
    repeated: [],
    ignored: [],
    check: { claims: [], missing: [] },
    dailyCalls: { used: 3, limit: 10 },
    ...overrides,
  });

  async function drawWith(response: unknown): Promise<void> {
    stubRoutes({ "POST /news/card-text": response });
    renderScreen();
    await screen.findByTestId("news-daily-calls");
    fireEvent.change(screen.getByTestId("news-article"), { target: { value: ARTICLE } });
    fireEvent.click(screen.getByTestId("news-reel-draw"));
  }

  it("fills the boxes with what came back, without shortening any of them, and moves the count on", async () => {
    const tooLong = "가".repeat(NEWS_REEL_TEXT_BOXES["headline.line1"].limit + 4);
    await drawWith(answer({
      values: { "headline.line1": tooLong, "headline.line2": "검찰청 62년 만에 폐지", "caption.line1": "재석 289명 중 180명 찬성" },
      missing: ["caption.line2"],
    }));

    await waitFor(() => expect((screen.getByTestId("news-reel-headline1") as HTMLInputElement).value).toBe(tooLong));
    expect((screen.getByTestId("news-reel-headline2") as HTMLInputElement).value).toBe("검찰청 62년 만에 폐지");
    expect((screen.getByTestId("news-reel-caption1") as HTMLInputElement).value).toBe("재석 289명 중 180명 찬성");
    /* 🟠 잘라 주지 않고 칸이 넘었다고 셉니다 — 무엇을 지울지는 사람이 정합니다. */
    expect(screen.getByTestId("news-reel-headline1-count").textContent).toContain("4자 넘었습니다");
    expect(screen.getByTestId("news-daily-calls").textContent).toContain("3 / 10");
    expect(screen.getByTestId("news-reel-draw-missing").textContent).toContain("자막 둘째 줄");
  });

  it("leaves a box that came back twice empty, and says so instead of choosing", async () => {
    await drawWith(answer({
      values: { "headline.line1": "국회 본회의 통과", "headline.line2": "하나를 골랐다면 이것" },
      repeated: ["headline.line2"],
      ignored: ["라벨 없이 온 줄"],
    }));

    await waitFor(() => expect((screen.getByTestId("news-reel-headline1") as HTMLInputElement).value).toBe("국회 본회의 통과"));
    expect((screen.getByTestId("news-reel-headline2") as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("news-reel-draw-repeated").textContent).toContain("제목 둘째 줄");
    expect(screen.getByTestId("news-reel-draw-ignored").textContent).toContain("라벨 없이 온 줄");
  });

  /** 🔴 한 칸도 못 읽은 답도 **모양은 맞는 답**입니다 — 「서버 응답 이상」으로 버리면 무엇이 없었는지 못 봅니다. */
  it("keeps an answer with no values, and names every box as missing", async () => {
    await drawWith(answer({ missing: ["headline.line1", "headline.line2", "caption.line1"] }));

    const missing = await screen.findByTestId("news-reel-draw-missing");
    expect(missing.textContent).toContain("제목 첫 줄");
    expect(screen.queryByTestId("news-reel-draw-error")).toBeNull();
  });

  it("refuses an answer whose box names are not the contract's, rather than filling a box it does not have", async () => {
    await drawWith(answer({ values: { "headline.line3": "없는 칸" } }));

    await screen.findByTestId("news-reel-draw-error");
    expect((screen.getByTestId("news-reel-headline1") as HTMLInputElement).value).toBe("");
  });

  it("closes both buttons when the server says the day is spent", async () => {
    await drawWith({ status: 409, body: { code: "NEWS_DAILY_LIMIT_REACHED", message: "" } });

    await screen.findByTestId("news-reel-draw-error");
    expect(screen.getByTestId("news-reel-draw")).toBeDisabled();
    expect(screen.getByTestId("news-summarize")).toBeDisabled();
  });
});

/**
 * 「이 글로 릴 만들기」 — **여기서 굽지 않습니다.** 글을 들고 넘어가는 것뿐입니다.
 */
describe("NewsReelScreen 릴로 넘기기", () => {
  beforeEach(() => { stubRoutes(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  function fillFour(): void {
    fireEvent.change(screen.getByTestId("news-reel-headline1"), { target: { value: "국회 본회의 통과" } });
    fireEvent.change(screen.getByTestId("news-reel-headline2"), { target: { value: "검찰청 62년 만에 폐지" } });
    fireEvent.change(screen.getByTestId("news-reel-caption1"), { target: { value: "재석 289명 중 180명 찬성" } });
    fireEvent.change(screen.getByTestId("news-outlet"), { target: { value: "연합뉴스" } });
  }

  it("hands over the four lines and the publisher, and nothing else", async () => {
    const onUseCard = renderScreenForCard();
    fillFour();

    fireEvent.click(screen.getByTestId("news-reel-use"));

    /* 🔴 출처 두 칸은 **안 넘깁니다** — 그림에 딸린 것이고 그림은 다음 화면에서 고릅니다. */
    expect(onUseCard).toHaveBeenCalledWith({
      publisher: "연합뉴스",
      headline: { line1: "국회 본회의 통과", line2: "검찰청 62년 만에 폐지" },
      caption: { line1: "재석 289명 중 180명 찬성", line2: null },
    });
  });

  it("sends an empty second caption line as null, never as an empty string", async () => {
    const onUseCard = renderScreenForCard();
    fillFour();
    /* 공백만 친 칸도 없는 것입니다 — 계약은 빈 문자열을 값으로 치지 않습니다. */
    fireEvent.change(screen.getByTestId("news-reel-caption2"), { target: { value: "   " } });

    fireEvent.click(screen.getByTestId("news-reel-use"));

    expect(onUseCard.mock.calls[0]?.[0].caption.line2).toBeNull();
  });

  it("will not hand over without a publisher — that name goes in the band", async () => {
    const onUseCard = renderScreenForCard();
    fillFour();
    fireEvent.change(screen.getByTestId("news-outlet"), { target: { value: "" } });

    expect(screen.getByTestId("news-reel-use")).toBeDisabled();
    expect(screen.getByTestId("news-reel-use-why").textContent).toContain("언론사");
    fireEvent.click(screen.getByTestId("news-reel-use"));
    expect(onUseCard).not.toHaveBeenCalled();
  });

  it("will not hand over a box that is over its limit", async () => {
    const onUseCard = renderScreenForCard();
    fillFour();
    const limit = NEWS_REEL_TEXT_BOXES["headline.line1"].limit;
    fireEvent.change(screen.getByTestId("news-reel-headline1"), { target: { value: "가".repeat(limit + 1) } });

    expect(screen.getByTestId("news-reel-use")).toBeDisabled();
    expect(screen.getByTestId("news-reel-use-why").textContent).toContain("글자 수");
    fireEvent.click(screen.getByTestId("news-reel-use"));
    expect(onUseCard).not.toHaveBeenCalled();
  });
});

/**
 * 🔴 목록에서 줄을 누르면 **주소만** 채워집니다 — 붙여넣은 본문을 지우지 않으려고 그렇게 두었는데,
 * 그러면 화면이 **두 기사를 동시에** 들고 있게 됩니다. 캡틴D: *「다른 기사로 터치가 안 된다」* — 눌리긴
 * 눌렸고, 아래 칸이 안 바뀌어 안 눌린 것처럼 보였습니다.
 */
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
