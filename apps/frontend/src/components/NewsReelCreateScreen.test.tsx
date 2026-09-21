import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeAsset, makeProject, stubFetchByRoute } from "../api/testUtils.js";
import { NewsReelCreateScreen, type NewsReelCardText } from "./NewsReelCreateScreen.js";

const TEXT: NewsReelCardText = {
  publisher: "연합뉴스",
  headline: { line1: "국회 본회의 통과", line2: "검찰청 62년 만에 폐지" },
  caption: { line1: "재석 289명 중 180명 찬성", line2: null },
};

const ONE = makeAsset({ assetId: "ASSET-GENERAL-000000000001", displayName: "국회 본회의장" });
const TWO = makeAsset({ assetId: "ASSET-GENERAL-000000000002", displayName: "법원 앞" });

function stubRoutes(extra: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  const mock = stubFetchByRoute({
    "GET /assets": { assets: [ONE, TWO] },
    "GET /projects": { projects: [] },
    "POST /news/reels": { project: makeProject({ id: "뉴스릴-0921", newsReelCard: { ...TEXT, creditRequired: false } }) },
    ...extra,
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function renderScreen(text: NewsReelCardText | null = TEXT): ReturnType<typeof vi.fn> {
  const onCreated = vi.fn();
  render(<NewsReelCreateScreen text={text} onBack={() => {}} onCreated={onCreated} />);
  return onCreated;
}

/** 보낸 요청의 본문 — 「무엇을 보냈나」를 문자열이 아니라 값으로 봅니다. */
function sentBody(mock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = mock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
  return JSON.parse(String((call?.[1] as RequestInit).body)) as Record<string, unknown>;
}

describe("NewsReelCreateScreen", () => {
  beforeEach(() => { stubRoutes(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("has nothing to make without the four lines, and says where they come from", async () => {
    renderScreen(null);

    /* 🔴 빈 글로 구우면 **띠만 있고 글이 없는 영상**이 나오는데, 그건 실패처럼 보이지 않습니다. */
    expect(screen.getByTestId("news-reel-create-no-card").textContent).toContain("뉴스 릴 화면");
    expect(screen.queryByTestId("news-reel-create-submit")).toBeNull();
  });

  it("will not make one until a picture is picked, and says so", async () => {
    renderScreen();
    await screen.findByTestId(`news-reel-create-asset-${ONE.assetId}`);

    expect(screen.getByTestId("news-reel-create-submit")).toBeDisabled();
    expect(screen.getByTestId("news-reel-create-why").textContent).toContain("그림");
  });

  it("sends the pictures in the order they were pressed — that is the scene order", async () => {
    const mock = stubRoutes();
    renderScreen();
    await screen.findByTestId(`news-reel-create-asset-${TWO.assetId}`);

    fireEvent.click(screen.getByTestId(`news-reel-create-asset-${TWO.assetId}`));
    fireEvent.click(screen.getByTestId(`news-reel-create-asset-${ONE.assetId}`));
    fireEvent.change(screen.getByTestId("news-reel-create-name"), { target: { value: "뉴스릴-0921" } });
    fireEvent.click(screen.getByTestId("news-reel-create-submit"));

    await waitFor(() => expect(sentBody(mock).assetIds).toEqual([TWO.assetId, ONE.assetId]));
  });

  it("sends the card without a credit when none is required — not an empty string", async () => {
    const mock = stubRoutes();
    renderScreen();
    await screen.findByTestId(`news-reel-create-asset-${ONE.assetId}`);

    fireEvent.click(screen.getByTestId(`news-reel-create-asset-${ONE.assetId}`));
    fireEvent.change(screen.getByTestId("news-reel-create-name"), { target: { value: "뉴스릴-0921" } });
    fireEvent.click(screen.getByTestId("news-reel-create-submit"));

    await waitFor(() => {
      const card = sentBody(mock).card as Record<string, unknown>;
      expect(card.creditRequired).toBe(false);
      /* 🔴 「필요 없다」와 「필요한데 아직 안 썼다」가 같은 값이 되면 안 됩니다(D-054). */
      expect("creditText" in card).toBe(false);
    });
  });

  it("refuses to make one when a credit is required but not written", async () => {
    renderScreen();
    await screen.findByTestId(`news-reel-create-asset-${ONE.assetId}`);

    fireEvent.click(screen.getByTestId(`news-reel-create-asset-${ONE.assetId}`));
    fireEvent.change(screen.getByTestId("news-reel-create-name"), { target: { value: "뉴스릴-0921" } });
    fireEvent.click(screen.getByTestId("news-reel-create-credit-required"));

    expect(screen.getByTestId("news-reel-create-submit")).toBeDisabled();
    expect(screen.getByTestId("news-reel-create-credit-missing")).toBeTruthy();
  });

  it("carries the credit wording through exactly as it was written", async () => {
    const mock = stubRoutes();
    renderScreen();
    await screen.findByTestId(`news-reel-create-asset-${ONE.assetId}`);

    fireEvent.click(screen.getByTestId(`news-reel-create-asset-${ONE.assetId}`));
    fireEvent.change(screen.getByTestId("news-reel-create-name"), { target: { value: "뉴스릴-0921" } });
    fireEvent.click(screen.getByTestId("news-reel-create-credit-required"));
    fireEvent.change(screen.getByTestId("news-reel-create-credit-text"), { target: { value: "  국회사무처, 공공누리 제1유형  " } });
    fireEvent.click(screen.getByTestId("news-reel-create-submit"));

    await waitFor(() => {
      const card = sentBody(mock).card as Record<string, unknown>;
      expect(card.creditRequired).toBe(true);
      expect(card.creditText).toBe("국회사무처, 공공누리 제1유형");
    });
  });

  it("makes a vertical reel — the burning geometry is laid out for 1080×1920", async () => {
    const mock = stubRoutes();
    renderScreen();
    await screen.findByTestId(`news-reel-create-asset-${ONE.assetId}`);

    fireEvent.click(screen.getByTestId(`news-reel-create-asset-${ONE.assetId}`));
    fireEvent.change(screen.getByTestId("news-reel-create-name"), { target: { value: "뉴스릴-0921" } });
    fireEvent.click(screen.getByTestId("news-reel-create-submit"));

    await waitFor(() => expect(sentBody(mock).aspectRatio).toBe("9:16"));
    expect(screen.queryByText("16:9")).toBeNull();
  });

  it("goes to the merge screen with the id the server gave back", async () => {
    stubRoutes();
    const onCreated = renderScreen();
    await screen.findByTestId(`news-reel-create-asset-${ONE.assetId}`);

    fireEvent.click(screen.getByTestId(`news-reel-create-asset-${ONE.assetId}`));
    fireEvent.change(screen.getByTestId("news-reel-create-name"), { target: { value: "뉴스릴-0921" } });
    fireEvent.click(screen.getByTestId("news-reel-create-submit"));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("뉴스릴-0921"));
  });

  it("says the refusal in words a person can act on, without the server's own message", async () => {
    /* 🟠 거절은 `stubFetchByRoute` 의 둘째 인자로 세웁니다. */
    const mock = stubFetchByRoute(
      { "GET /assets": { assets: [ONE, TWO] }, "GET /projects": { projects: [] } },
      { "POST /news/reels": { status: 400, body: { code: "NEWS_REEL_ASSET_UNUSABLE", message: "raw internal detail" } } },
    );
    vi.stubGlobal("fetch", mock);
    renderScreen();
    await screen.findByTestId(`news-reel-create-asset-${ONE.assetId}`);

    fireEvent.click(screen.getByTestId(`news-reel-create-asset-${ONE.assetId}`));
    fireEvent.change(screen.getByTestId("news-reel-create-name"), { target: { value: "뉴스릴-0921" } });
    fireEvent.click(screen.getByTestId("news-reel-create-submit"));

    const shown = await screen.findByTestId("news-reel-create-error");
    /* 🔴 다시 누르라고 하지 않습니다 — 같은 그림은 다음에도 같게 읽힙니다. */
    expect(shown.textContent).toContain("다른 그림");
    expect(shown.textContent).not.toContain("raw internal detail");
  });
});
