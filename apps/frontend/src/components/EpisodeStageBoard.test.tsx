import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LONG_EPISODE_STATUSES, type LongEpisodeStatus } from "@ai-animation-studio/shared";
import { BOARD_STAGES, EpisodeStageBoard, episodeStageCells, episodeStopState } from "./EpisodeStageBoard.js";

const row = (status: LongEpisodeStatus) => BOARD_STAGES.map((stage) => episodeStageCells(status)[stage]).join(" ");

describe("episodeStageCells", () => {
  it.each([
    ["planned", "current upcoming upcoming upcoming upcoming"],
    ["outline_ready", "done current upcoming upcoming upcoming"],
    ["script_review", "done current upcoming upcoming upcoming"],
    ["script_approved", "done done current upcoming upcoming"],
    ["waiting_for_asset_mapping_review", "done done current upcoming upcoming"],
    ["images_review", "done done current upcoming upcoming"],
    ["waiting_for_video_confirmation", "done done done current upcoming"],
    ["videos_review", "done done done current upcoming"],
    ["videos_approved", "done done done done current"],
    ["rendering", "done done done done current"],
    ["completed", "done done done done done"],
  ] as const)("%s reads as %s", (status, expected) => {
    expect(row(status)).toBe(expected);
  });

  /** 🔴 중단·실패는 어느 단계에서 멈췄는지 계약에 없다(CLI 1337) — 완료도, 특정 단계의 실패도 단정하지 않는다. */
  it("does not claim any stage done, or a particular stage failed, for an interrupted or failed episode", () => {
    expect(row("interrupted")).toBe("unknown unknown unknown unknown unknown");
    expect(row("failed")).toBe("unknown unknown unknown unknown unknown");
    expect(episodeStopState("interrupted")).toBe("interrupted");
    expect(episodeStopState("failed")).toBe("failed");
    expect(episodeStopState("rendering")).toBeNull();
  });

  it("answers every on-line status in the contract with exactly one current cell, or none when completed", () => {
    for (const status of LONG_EPISODE_STATUSES) {
      if (episodeStopState(status) !== null) continue;
      const cells = Object.values(episodeStageCells(status));
      expect(cells.filter((state) => state === "current").length, status).toBe(status === "completed" ? 0 : 1);
      expect(cells, status).not.toContain("unknown");
    }
  });
});

describe("EpisodeStageBoard", () => {
  const episodes = [
    { episodeNumber: 1, title: "첫 번째 꿈", status: "completed" as const },
    { episodeNumber: 2, title: "문 너머", status: "interrupted" as const },
    { episodeNumber: 3, title: "돌아오는 길", status: "planned" as const },
    { episodeNumber: 4, title: "끝", status: "failed" as const },
  ];

  it("shows a row per episode and a column per stage, with readable states and no raw status names", () => {
    const { container } = render(<EpisodeStageBoard episodes={episodes} onOpenStage={() => {}} />);
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["회차", "개요", "대본", "이미지", "영상", "병합"]);
    expect(within(screen.getByTestId("episode-board-row-1")).getByRole("rowheader").textContent).toBe("1회 · 첫 번째 꿈");
    expect(within(screen.getByTestId("episode-board-row-2")).getByRole("rowheader").textContent).toBe("2회 · 문 너머중단됨 — 멈춘 단계는 기록돼 있지 않습니다");
    expect(screen.getByTestId("episode-board-2-stop").textContent).toBe("중단됨 — 멈춘 단계는 기록돼 있지 않습니다");
    expect(screen.getByTestId("episode-board-4-stop").textContent).toBe("실패 — 멈춘 단계는 기록돼 있지 않습니다");
    expect(screen.getByTestId("episode-board-row-4").getAttribute("data-stop-state")).toBe("failed");
    for (const stage of BOARD_STAGES) expect(screen.getByTestId(`episode-board-4-${stage}`).textContent).toBe("확인 필요");
    expect(screen.queryByTestId("episode-board-1-stop")).toBeNull();
    expect(screen.getByTestId("episode-board-3-outline").textContent).toBe("지금 할 차례");
    for (const raw of ["interrupted", "planned", "completed", "failed"]) expect(container.textContent).not.toContain(raw);
  });

  /** 칸은 이동만 — 아직 닿지 않은 단계는 버튼이 아니고, 누를 수 있는 칸에는 회차·단계·상태가 담긴 이름이 있다. */
  it("lets the reached cells navigate, keeps unreached ones inert, and names each button for a screen reader", () => {
    const onOpenStage = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<EpisodeStageBoard episodes={episodes} onOpenStage={onOpenStage} />);

    fireEvent.click(screen.getByRole("button", { name: "2회 영상: 확인 필요(중단됨 — 멈춘 단계는 기록돼 있지 않습니다) — 화면 열기" }));
    expect(onOpenStage).toHaveBeenLastCalledWith("video", episodes[1]);
    fireEvent.click(screen.getByTestId("episode-board-1-merge"));
    expect(onOpenStage).toHaveBeenLastCalledWith("merge", episodes[0]);

    const unreached = screen.getByTestId("episode-board-3-script");
    expect(unreached.tagName).toBe("SPAN");
    fireEvent.click(unreached);
    expect(onOpenStage).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("says what to do when there are no episodes yet", () => {
    render(<EpisodeStageBoard episodes={[]} onOpenStage={() => {}} />);
    expect(screen.getByTestId("episode-board-empty").textContent).toContain("회차 나누기(AI)");
  });
});
