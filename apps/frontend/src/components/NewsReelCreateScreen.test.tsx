import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEWS_REEL_TEXT_BOXES } from "@ai-animation-studio/shared";

import { makeAsset, makeProject, stubFetchByRoute } from "../api/testUtils.js";
import { NewsReelCreateScreen, type NewsReelDraft } from "./NewsReelCreateScreen.js";

const ONE = makeAsset({ assetId: "ASSET-GENERAL-000000000001", displayName: "국회 본회의장" });
const TWO = makeAsset({ assetId: "ASSET-GENERAL-000000000002", displayName: "법원 앞" });

const ARTICLE = [
  "국회는 2026년 9월 17일 검찰청 폐지에 따른 후속 법률 51건을 통과시켰다.",
  "개정법은 10월 2일부터 시행된다. 재석 289명 중 180명이 찬성했다.",
].join("\n");

const DRAFT: NewsReelDraft = {
  article: { title: "국회, 검찰청 폐지 후속 법률 51건 통과", body: ARTICLE, publisher: "연합뉴스", publishedAt: "2026-09-17", sourceUrl: "https://www.yna.co.kr/view/1" },
  assetIds: [ONE.assetId, TWO.assetId],
  clipDurationSeconds: 5,
};

function stubRoutes(extra: Record<string, unknown> = {}, errors: Record<string, { status: number; body: unknown }> = {}): ReturnType<typeof vi.fn> {
  const mock = stubFetchByRoute({
    "GET /assets": { assets: [ONE, TWO] },
    "GET /projects": { projects: [] },
    "GET /news/setup": { publishers: [], dailyCalls: { used: 2, limit: 30 } },
    /* 🔴 `newsReelCard` 가 없는 답은 릴이 아니라서 가드가 거절합니다 — 빼 두면 「넘어가지 않는다」가 됩니다. */
    "POST /news/reels": { project: makeProject({ id: "뉴스릴-0922", newsReelCard: { publisher: "연합뉴스", headline: { line1: "후속 법안 51건", line2: "국회 본회의 통과" }, captions: [{ line1: "재석 289명 중 180명 찬성", line2: null }, { line1: "10월 2일부터 시행", line2: null }], creditRequired: false } }) },
    ...extra,
  }, errors);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function renderScreen(draft: NewsReelDraft | null = DRAFT): ReturnType<typeof vi.fn> {
  const onCreated = vi.fn();
  render(<NewsReelCreateScreen draft={draft} onBack={() => {}} onCreated={onCreated} />);
  return onCreated;
}

/** 보낸 요청의 본문 — 「무엇을 보냈나」를 문자열이 아니라 값으로 봅니다. */
function sentBody(mock: ReturnType<typeof vi.fn>, suffix = "/news/reels"): Record<string, unknown> {
  const call = mock.mock.calls.find(([url, init]) => String(url).endsWith(suffix) && (init as RequestInit | undefined)?.method === "POST");
  return JSON.parse(String((call?.[1] as RequestInit).body)) as Record<string, unknown>;
}

function fillLines(): void {
  fireEvent.change(screen.getByTestId("news-reel-headline1"), { target: { value: "후속 법안 51건" } });
  fireEvent.change(screen.getByTestId("news-reel-headline2"), { target: { value: "국회 본회의 통과" } });
  fireEvent.change(screen.getByTestId("news-reel-caption1-0"), { target: { value: "재석 289명 중 180명 찬성" } });
  fireEvent.change(screen.getByTestId("news-reel-caption1-1"), { target: { value: "10월 2일부터 시행" } });
  fireEvent.change(screen.getByTestId("news-reel-create-name"), { target: { value: "뉴스릴-0922" } });
}

describe("NewsReelCreateScreen 장면마다 자막", () => {
  beforeEach(() => { stubRoutes(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  /**
   * 🔴 캡틴D: *「릴스가 몇 장면 몇 분인 줄 알고 이렇게 적음?」* — 자막 칸 수는 **고른 그림 수**가 정합니다.
   */
  it("opens one caption pair per picture, and says how long the reel will be", () => {
    renderScreen();

    expect(screen.getAllByTestId(/^news-reel-scene-\d+$/)).toHaveLength(2);
    expect(screen.getByTestId("news-reel-caption1-1")).toBeTruthy();
    expect(screen.queryByTestId("news-reel-caption1-2")).toBeNull();
    /* 그림 2장 × 5초 = 10초 — 글을 쓰기 전에 알고 씁니다. */
    expect(document.body.textContent).toContain("모두 10초");
  });

  it("sends one caption per picture, in the pictures' own order", async () => {
    const mock = stubRoutes();
    renderScreen();
    fillLines();

    fireEvent.click(screen.getByTestId("news-reel-create-submit"));

    await waitFor(() => {
      const card = sentBody(mock).card as { captions: { line1: string; line2: string | null }[] };
      expect(card.captions).toHaveLength(2);
      expect(card.captions[0]!.line1).toContain("289명");
      expect(card.captions[1]!.line1).toContain("10월 2일");
      /* 🔴 빈 둘째 줄은 `""` 가 아니라 `null` 입니다. */
      expect(card.captions[0]!.line2).toBeNull();
    });
  });

  it("counts every scene's caption against the contract, not just the first", () => {
    renderScreen();
    fillLines();
    const limit = NEWS_REEL_TEXT_BOXES["caption.line1"].limit;

    fireEvent.change(screen.getByTestId("news-reel-caption1-1"), { target: { value: "가".repeat(limit + 2) } });

    expect(screen.getByTestId("news-reel-caption1-1-count").textContent).toContain("2자 넘었습니다");
    expect(screen.getByTestId("news-reel-create-submit")).toBeDisabled();
    expect(screen.getByTestId("news-reel-create-why").textContent).toContain("글자 수");
  });

  /** 🔴 구워지는 것이 이 줄들이라, 대조도 이 줄들 위에서 돕니다. */
  it("will not make one while a line says something the article does not", () => {
    renderScreen();
    fillLines();
    fireEvent.change(screen.getByTestId("news-reel-caption1-0"), { target: { value: "재석 300명 찬성" } });

    expect(screen.getByTestId("news-reel-check-failed").textContent).toContain("300");
    expect(screen.getByTestId("news-reel-create-submit")).toBeDisabled();
  });

  it("asks the model for one caption per picture, not one for the whole reel", async () => {
    const mock = stubRoutes({
      "POST /news/card-text": {
        headline: { line1: "후속 법안 51건", line2: "국회 본회의 통과" },
        captions: [{ line1: "본회의장 표결 직후" }, { line1: "공소청으로 간판 교체" }],
        missing: [], repeated: [], ignored: [], check: { claims: [], missing: [] }, dailyCalls: { used: 3, limit: 30 },
      },
    });
    renderScreen();
    /* 장부를 읽기 전에는 버튼이 닫혀 있습니다 — 열린 뒤에 누릅니다. */
    await waitFor(() => expect(screen.getByTestId("news-reel-draw")).toBeEnabled());

    fireEvent.click(screen.getByTestId("news-reel-draw"));

    await waitFor(() => {
      /* 🔴 숫자가 아니라 **고른 순서의 이름**이 갑니다 — 이게 자막과 그림을 묶는 유일한 끈입니다(D-057). */
      expect(sentBody(mock, "/news/card-text").pictures).toEqual(["국회 본회의장", "법원 앞"]);
      expect(sentBody(mock, "/news/card-text").sceneCount).toBeUndefined();
      expect((screen.getByTestId("news-reel-caption1-0") as HTMLInputElement).value).toBe("본회의장 표결 직후");
      expect((screen.getByTestId("news-reel-caption1-1") as HTMLInputElement).value).toBe("공소청으로 간판 교체");
    });
  });

  /**
   * 🔴 **이름을 못 읽었을 때 지어내지 않습니다.** 「그림」 같은 말을 채워 보내면 모델이 **그 가짜 말에 맞춰**
   * 씁니다 — 그림에 없는 것이 자막에 깔립니다. 빈 이름은 빈 채로 보내고, 서버는 그것을 받습니다(1081 §3).
   * 🟠 목록 길이는 고른 그림 수 그대로라 **자막 칸 수는 어긋나지 않습니다.**
   */
  it("sends the names empty rather than made up when the picture list could not be read", async () => {
    const mock = stubRoutes({
      "POST /news/card-text": {
        headline: { line1: "후속 법안 51건", line2: "국회 본회의 통과" },
        captions: [{ line1: "하나" }, { line1: "둘" }],
        missing: [], repeated: [], ignored: [], check: { claims: [], missing: [] }, dailyCalls: { used: 3, limit: 30 },
      },
    }, { "GET /assets": { status: 500, body: { code: "ASSET_STORAGE_ERROR", message: "raw" } } });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("news-reel-draw")).toBeEnabled());

    fireEvent.click(screen.getByTestId("news-reel-draw"));

    await waitFor(() => {
      expect(sentBody(mock, "/news/card-text").pictures).toEqual(["", ""]);
    });
  });

  /** 🔴 돈이 나간 답입니다 — 못 채운 칸을 **버렸다고 말해야** 사람이 손으로 채웁니다. */
  it("says what the answer did not fill, instead of dropping it quietly", async () => {
    stubRoutes({
      "POST /news/card-text": {
        headline: { line1: "후속 법안 51건" },
        captions: [{ line1: "본회의장" }, {}],
        missing: [{ field: "headline.line2" }, { field: "caption.line1", scene: 1 }],
        repeated: [], ignored: ["물론입니다!"], check: { claims: [], missing: [] }, dailyCalls: { used: 3, limit: 30 },
      },
    });
    renderScreen();
    /* 장부를 읽기 전에는 버튼이 닫혀 있습니다 — 열린 뒤에 누릅니다. */
    await waitFor(() => expect(screen.getByTestId("news-reel-draw")).toBeEnabled());

    fireEvent.click(screen.getByTestId("news-reel-draw"));

    const note = await screen.findByTestId("news-reel-draw-leftovers");
    expect(note.textContent).toContain("안 온 칸 2개");
    expect(note.textContent).toContain("칸에 못 넣은 줄 1개");
  });

  /** 🔴 몇 번 남았는지 모르면 마지막 한 번을 모르고 씁니다. */
  it("says how many draws are left, and closes the button when they are gone", async () => {
    stubRoutes({ "GET /news/setup": { publishers: [], dailyCalls: { used: 30, limit: 30 } } });
    renderScreen();

    await waitFor(() => expect(screen.getByTestId("news-reel-draw")).toBeDisabled());
    expect(screen.getByTestId("news-reel-calls-spent").textContent).toContain("내일");
  });

  /** 🔴 「모르니까 안 부른다」 — 못 읽은 장부를 여유로 읽지 않습니다. */
  it("keeps the button shut while the ledger cannot be read", async () => {
    stubRoutes({}, { "GET /news/setup": { status: 500, body: { code: "INTERNAL_ERROR" } } });
    renderScreen();

    await waitFor(() => expect(screen.getByTestId("news-reel-calls-unknown")).toBeTruthy());
    expect(screen.getByTestId("news-reel-draw")).toBeDisabled();
  });

  it("has nothing to write without an article and pictures", () => {
    renderScreen(null);

    expect(screen.getByTestId("news-reel-create-no-draft").textContent).toContain("그림");
    expect(screen.queryByTestId("news-reel-create-submit")).toBeNull();
  });

  it("refuses to make one when a credit is required but not written", () => {
    renderScreen();
    fillLines();

    fireEvent.click(screen.getByTestId("news-reel-create-credit-required"));

    expect(screen.getByTestId("news-reel-create-submit")).toBeDisabled();
    expect(screen.getByTestId("news-reel-create-credit-missing")).toBeTruthy();
  });

  it("sends the card without a credit field at all when none is required", async () => {
    const mock = stubRoutes();
    renderScreen();
    fillLines();

    fireEvent.click(screen.getByTestId("news-reel-create-submit"));

    await waitFor(() => {
      const card = sentBody(mock).card as Record<string, unknown>;
      expect(card.creditRequired).toBe(false);
      /* 「필요 없다」와 「필요한데 안 썼다」가 같은 값이 되면 안 됩니다(D-054). */
      expect("creditText" in card).toBe(false);
    });
  });

  it("goes to the merge screen with the id the server gave back", async () => {
    stubRoutes();
    const onCreated = renderScreen();
    fillLines();

    fireEvent.click(screen.getByTestId("news-reel-create-submit"));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("뉴스릴-0922"));
  });

  it("says the refusal in words a person can act on, without the server's own message", async () => {
    stubRoutes({}, { "POST /news/reels": { status: 400, body: { code: "NEWS_REEL_ASSET_UNUSABLE", message: "raw internal detail" } } });
    renderScreen();
    fillLines();

    fireEvent.click(screen.getByTestId("news-reel-create-submit"));

    const shown = await screen.findByTestId("news-reel-create-error");
    expect(shown.textContent).toContain("다른 그림");
    expect(shown.textContent).not.toContain("raw internal detail");
  });
});
