import { WorkflowState } from "@ai-animation-studio/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkflowProgressBar } from "./WorkflowProgressBar.js";

describe("WorkflowProgressBar", () => {
  it("reports 0% at the very first state and 100% once completed", () => {
    const { rerender } = render(<WorkflowProgressBar state={WorkflowState.Init} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");

    rerender(<WorkflowProgressBar state={WorkflowState.Completed} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
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

  it("reports 100% for a failed or cancelled project, and colors the bar red instead of violet", () => {
    render(<WorkflowProgressBar state={WorkflowState.Failed} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar.firstElementChild).toHaveClass("bg-rose-500");
  });
});
