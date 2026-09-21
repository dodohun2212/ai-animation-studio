import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NewsReelCard, ProjectSummary } from "@ai-animation-studio/shared";
import { makeProject, stubFetchByRoute } from "../api/testUtils.js";

/** 목록이 받는 것은 `ProjectSummary` 입니다 — `makeProject` 가 그 위에 얹혀 있어 그대로 씁니다. */
function summary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return makeProject(overrides as Parameters<typeof makeProject>[0]);
}
import { NewsReelListScreen } from "./NewsReelListScreen.js";

const CARD: NewsReelCard = {
  publisher: "연합뉴스",
  headline: { line1: "국회 본회의 통과", line2: "검찰청 62년 만에 폐지" },
  caption: { line1: "재석 289명 중 180명 찬성", line2: null },
  creditRequired: false,
};

const REEL = summary({ id: "뉴스릴-0921", newsReelCard: CARD });
const CARD_PROJECT = summary({ id: "명언-0920", photoCard: true });
const ORDINARY = summary({ id: "보통-0919" });

function stubProjects(projects: unknown[]): void {
  vi.stubGlobal("fetch", stubFetchByRoute({ "GET /projects": { projects } }));
}

function renderScreen(): ReturnType<typeof vi.fn> {
  const onOpenReel = vi.fn();
  render(<NewsReelListScreen onBack={() => {}} onCreateNew={() => {}} onOpenReel={onOpenReel} />);
  return onOpenReel;
}

describe("NewsReelListScreen", () => {
  beforeEach(() => { stubProjects([REEL, CARD_PROJECT, ORDINARY]); });
  afterEach(() => { vi.unstubAllGlobals(); });

  /**
   * 🔴 캡틴D: *「이건 뉴스 릴로 만들었는데 왜 명언 카드에 있는거야」* — 릴과 카드는 **다른 목록**입니다.
   */
  it("lists reels only — not quote cards, not ordinary projects", async () => {
    renderScreen();

    await screen.findByTestId(`news-reel-open-${REEL.id}`);
    expect(screen.queryByTestId(`news-reel-open-${CARD_PROJECT.id}`)).toBeNull();
    expect(screen.queryByTestId(`news-reel-open-${ORDINARY.id}`)).toBeNull();
    expect(screen.getByTestId("news-reel-count").textContent).toBe("1");
  });

  /** 🟠 릴 이름은 사람이 붙인 것이라 **무슨 기사였는지**를 말하지 않습니다. */
  it("shows the headline under the name, because the name does not say what it was about", async () => {
    renderScreen();

    const headline = await screen.findByTestId(`news-reel-headline-${REEL.id}`);
    expect(headline.textContent).toBe("국회 본회의 통과");
  });

  it("says there are none rather than showing an empty grid", async () => {
    stubProjects([CARD_PROJECT, ORDINARY]);
    renderScreen();

    await screen.findByTestId("news-reel-none");
    expect(screen.queryByTestId("news-reel-existing")).toBeNull();
  });

  /**
   * 🔴 「못 읽었다」와 「없다」가 같아 보이면 사람이 **이미 만든 릴을 다시 만듭니다** — 릴은 이 화면 말고
   * 어디에도 안 실립니다.
   */
  it("does not swallow a failed read — that would look exactly like having none", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({}, { "GET /projects": { status: 500, body: { code: "INTERNAL_ERROR" } } }));
    renderScreen();

    await waitFor(() => expect(screen.getByTestId("news-reel-list-error")).toBeTruthy());
    expect(screen.queryByTestId("news-reel-none")).toBeNull();
  });
});
