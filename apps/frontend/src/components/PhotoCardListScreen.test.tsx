import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { answerOutOfBand, jsonResponse, makeProject, withStatus } from "../api/testUtils.js";
import { PhotoCardListScreen } from "./PhotoCardListScreen.js";

function stub(projects: unknown) {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", answerOutOfBand({ "GET /projects": projects }, fetchMock));
  return fetchMock;
}

function renderScreen(onOpenCard = vi.fn(), onCreateNew = vi.fn()) {
  render(<PhotoCardListScreen onBack={() => {}} onCreateNew={onCreateNew} onOpenCard={onOpenCard} />);
  return { onOpenCard, onCreateNew };
}

describe("PhotoCardListScreen", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /**
   * 🔴 이 화면이 **이미 만든 카드로 가는 유일한 문**입니다.
   *
   * 카드는 단기 프로젝트 목록에서 빠졌습니다 — 거기서는 사람이 고르지 않은 제목 아래에, 제 파이프라인에
   * 없는 단계를 세는 막대까지 달고 있었기 때문입니다. 그래서 여기가 안 되면 **끝난 일이 아예 안 보입니다.**
   */
  it("만든 카드만 싣고, 누른 카드를 연다", async () => {
    stub({ projects: [
      makeProject({ id: "명언_불광불급", photoCard: true }),
      makeProject({ id: "sample_project" }),
    ] });
    const { onOpenCard } = renderScreen();

    // 🟠 카드만. 보통 단기 프로젝트는 제 목록이 따로 있고, 여기 실으면 같은 것을 두 번 세는 것입니다.
    expect(await screen.findByTestId("photo-card-open-명언_불광불급")).toBeTruthy();
    expect(screen.queryByTestId("photo-card-open-sample_project")).toBeNull();

    fireEvent.click(screen.getByTestId("photo-card-open-명언_불광불급"));
    expect(onOpenCard).toHaveBeenCalled();
  });

  it("하나도 없으면 그렇게 말하고, 어디서 시작하는지도 말한다", async () => {
    stub({ projects: [] });
    renderScreen();

    /*
     * 🟠 빈 화면에 아무 말도 없으면 「못 불러온 것」과 구분이 안 됩니다. 그리고 「없습니다」만 적으면
     * 다음에 뭘 해야 하는지는 여전히 안 말합니다 — 그 문장이 서 있는 자리가 곧 다음 걸음입니다.
     */
    const empty = await screen.findByTestId("photo-card-none");
    expect(empty.textContent).toContain("새 카드");
    expect(screen.getByTestId("photo-card-new")).toBeTruthy();
  });

  /**
   * 🔴 이 실패를 삼키면 화면이 **「카드가 없다」와 똑같이 보입니다.** 그러면 사람은 이미 만든 카드를 다시
   * 만들고, 이름이 겹쳐서 또 막힙니다.
   */
  it("목록을 못 읽으면 그렇게 말하고, 서버 원문은 내보내지 않는다", async () => {
    stub(withStatus(500, { code: "PROJECT_STORAGE_ERROR", message: "raw C:\\private" }));
    renderScreen();

    const alert = await screen.findByTestId("photo-card-existing-error");
    expect(alert.textContent).toContain("불러오지 못했습니다");
    expect(alert.textContent).not.toContain("raw C:\\private");
    expect(alert).toHaveAttribute("data-error-code", "PROJECT_STORAGE_ERROR");
    // 🟠 못 읽은 것과 없는 것은 다른 말입니다. 둘이 같이 뜨면 화면이 두 가지를 동시에 주장합니다.
    expect(screen.queryByTestId("photo-card-none")).toBeNull();
    // 만들기는 막지 않습니다 — 목록을 못 읽은 것과 만들 수 있느냐는 상관이 없습니다.
    expect(screen.getByTestId("photo-card-new")).toBeTruthy();
  });

  it("「새 카드」는 만들기 화면으로 넘긴다", async () => {
    stub({ projects: [] });
    const { onCreateNew } = renderScreen();
    await screen.findByTestId("photo-card-none");

    fireEvent.click(screen.getByTestId("photo-card-new"));
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  it("머리글의 숫자가 실린 카드 수와 같다", async () => {
    stub({ projects: [
      makeProject({ id: "c1", photoCard: true }),
      makeProject({ id: "c2", photoCard: true }),
      makeProject({ id: "ordinary" }),
    ] });
    renderScreen();

    await screen.findByTestId("photo-card-open-c1");
    /*
     * 🔴 「2」가 아니라 **실린 것과 같은지**를 봅니다. 숫자를 따로 세면 거르는 조건이 갈리는 날
     * 머리글만 조용히 틀립니다 — 그리고 머리글은 사람이 제일 먼저 믿는 숫자입니다.
     */
    expect(screen.getByTestId("photo-card-count").textContent).toBe(String(screen.getAllByTestId(/^photo-card-open-/).length));
  });
});
