import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function renderScreen(onUseSummary = vi.fn()) {
  render(<NewsReelScreen onBack={() => {}} onUseSummary={onUseSummary} />);
  return onUseSummary;
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
  it("will not hand a summary on while anything in it is missing from the article", () => {
    const onUseSummary = renderScreen();
    fill(ARTICLE, "국회가 후속 법안 53건을 통과시켰다.");

    expect(screen.getByTestId("news-check-failed").textContent).toContain("53건");
    expect(screen.getByTestId("news-use-summary")).toBeDisabled();
    fireEvent.click(screen.getByTestId("news-use-summary"));
    expect(onUseSummary).not.toHaveBeenCalled();
  });

  it("names what it could not find, and what kind of thing it was", () => {
    renderScreen();
    fill(ARTICLE, '개정법은 10월 12일부터 시행된다. 여당은 "완벽한 개혁이다"라고 말했다.');

    expect(screen.getByTestId("news-unverified-date").textContent).toContain("10월 12일");
    expect(screen.getByTestId("news-unverified-quote").textContent).toContain("완벽한 개혁이다");
  });

  it("hands the summary and its source line on once everything checks out", () => {
    const onUseSummary = renderScreen();
    fill(ARTICLE, "국회가 2026년 9월 17일 후속 법안 51건을 통과시켰다. 10월 2일부터 시행된다.");

    expect(screen.getByTestId("news-check-passed")).toBeTruthy();
    fireEvent.click(screen.getByTestId("news-use-summary"));

    const [quote, sourceLine] = onUseSummary.mock.calls[0] as [string, string];
    expect(quote).toContain("51건");
    expect(sourceLine).toContain("서울경제");
    expect(sourceLine).toContain("https://example.test/a");
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
    // 막지는 않습니다 — 딱딱한 사실이 없는 요약이 틀렸다는 뜻은 아닙니다.
    expect(screen.getByTestId("news-use-summary")).not.toBeDisabled();
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

  /** 출처 없이 남의 글을 요약해 올리는 것은 이 기능이 하려던 일이 아닙니다. */
  it("will not hand anything on without a source line", () => {
    renderScreen();
    fill(ARTICLE, "국회가 후속 법안 51건을 통과시켰다.", false);

    expect(screen.getByTestId("news-use-summary")).toBeDisabled();
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
