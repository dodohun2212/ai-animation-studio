import { WorkflowState } from "@ai-animation-studio/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkflowProgressBar, isPipelineOver, progressPercent } from "./WorkflowProgressBar.js";

describe("WorkflowProgressBar", () => {
  it("reports 0% at the very first state", () => {
    render(<WorkflowProgressBar state={WorkflowState.Init} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("advances monotonically through the fixed pipeline order", () => {
    const { rerender } = render(<WorkflowProgressBar state={WorkflowState.Ready} />);
    const readyValue = Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));

    rerender(<WorkflowProgressBar state={WorkflowState.ImagesReview} />);
    const imagesValue = Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));

    rerender(<WorkflowProgressBar state={WorkflowState.VideosApproved} />);
    const videosValue = Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));

    expect(readyValue).toBeLessThan(imagesValue);
    expect(imagesValue).toBeLessThan(videosValue);
  });

  /**
   * 🔴 이 짝과 다음 짝이 한 쌍입니다 — **계산은 100 이고, 그림은 없다.**
   *
   * 전에는 이 자리에 「완료는 100% 를 보고한다」라는 짝이 있었고, 그건 참이었지만 **꽉 찬 막대가 목록을
   * 덮는 이유**이기도 했습니다. 지워 버리면 다음 사람이 「완료도 그려야 하지 않나」에서 막대를 되살리고,
   * 계산까지 같이 건드릴 수 있습니다. 그래서 둘로 나눠 못 박습니다: 숫자는 그대로 100, 화면은 없음.
   */
  it("still counts a finished project as 100% — the number did not change", () => {
    expect(progressPercent(WorkflowState.Completed)).toBe(100);
    expect(progressPercent(WorkflowState.Failed)).toBe(100);
    expect(progressPercent(WorkflowState.Cancelled)).toBe(100);
    expect(isPipelineOver(WorkflowState.Completed)).toBe(true);
  });

  it("draws nothing at all once the pipeline is over — no full bar for 완료·실패·취소", () => {
    const { container, rerender } = render(<WorkflowProgressBar state={WorkflowState.Completed} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(container.innerHTML).toBe("");

    rerender(<WorkflowProgressBar state={WorkflowState.Failed} />);
    expect(screen.queryByRole("progressbar")).toBeNull();

    rerender(<WorkflowProgressBar state={WorkflowState.Cancelled} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  /**
   * 🟠 아직 끝나지 않은 것에는 **여전히 그립니다.** 위 짝만 있으면 「막대를 아예 없앴다」로도 통과하는데,
   * 그건 다른 이야기입니다 — 없애자는 게 아니라 끝난 것에 안 붙이자는 것입니다.
   */
  it("keeps drawing the bar for a project that is still going", () => {
    render(<WorkflowProgressBar state={WorkflowState.GeneratingVideos} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toBeTruthy();
    expect(bar.firstElementChild).toHaveClass("bar-live");
  });
});
