import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NewsReelScreen } from "./NewsReelScreen.js";

const ARTICLE = [
  "국회는 2026년 9월 17일 검찰청 폐지에 따른 후속 법률 51건을 통과시켰다.",
  "개정법은 10월 2일부터 시행된다. 검찰청은 공소청으로 이름이 바뀐다.",
  "야당은 \"제대로 된 개혁이라 할 수 있느냐\"고 비판했다.",
].join("\n");

function renderScreen(onUseSummary = vi.fn()) {
  render(<NewsReelScreen onBack={() => {}} onUseSummary={onUseSummary} />);
  return onUseSummary;
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

  it("waits for both halves before saying anything about the summary", () => {
    renderScreen();
    expect(screen.getByTestId("news-check-idle")).toBeTruthy();

    fireEvent.change(screen.getByTestId("news-summary"), { target: { value: "요약만 있습니다." } });
    // 기사 본문이 없으면 대조할 대상이 없습니다 — 그때 초록을 띄우면 아무 근거 없이 통과시킨 것입니다.
    expect(screen.getByTestId("news-check-idle")).toBeTruthy();
    expect(screen.queryByTestId("news-check-passed")).toBeNull();
  });
});
