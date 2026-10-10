import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LongProjectStartChooser } from "./LongProjectStartChooser.js";

describe("LongProjectStartChooser", () => {
  it("offers the two ways to start the same kind of work and says they meet in one workspace", () => {
    const onStartDirect = vi.fn();
    const onStartFromStory = vi.fn();
    const onBack = vi.fn();
    render(<LongProjectStartChooser onStartDirect={onStartDirect} onStartFromStory={onStartFromStory} onBack={onBack} />);

    expect(screen.getByRole("heading", { level: 1, name: "새 작품 만들기" })).toBeTruthy();
    expect(screen.getByTestId("long-start-methods").textContent).toContain("직접 설정으로 시작");
    expect(screen.getByTestId("long-start-methods").textContent).toContain("소설에서 시작 (이야기 만들기)");
    expect(screen.getByTestId("long-start-merge").textContent).toContain("모두 같은 장기 프로젝트");
    expect(screen.getByTestId("long-start-merge").textContent).toContain("수정 화면");

    fireEvent.click(screen.getByTestId("long-start-direct"));
    expect(onStartDirect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("long-start-story"));
    expect(onStartFromStory).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /장기 프로젝트 목록으로/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("starts nothing by itself — the two buttons are the only way forward", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<LongProjectStartChooser onStartDirect={() => {}} onStartFromStory={() => {}} onBack={() => {}} />);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
