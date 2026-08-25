import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkflowGuideScreen } from "./WorkflowGuideScreen.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WorkflowGuideScreen", () => {
  it("never calls a provider or any endpoint — it only describes the pipeline", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<WorkflowGuideScreen onBack={() => {}} />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the three stages in pipeline order with their call rules", () => {
    render(<WorkflowGuideScreen onBack={() => {}} />);
    expect(screen.getByRole("heading", { level: 1, name: "작업 워크플로우" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: /대본 AI/ })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: /이미지 AI/ })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: /영상 AI/ })).toBeTruthy();
  });

  it("keeps the story stage at one call while image and video scale with the scene count", () => {
    render(<WorkflowGuideScreen onBack={() => {}} />);
    // Default is 6 scenes.
    expect(screen.getByTestId("workflow-guide-stage-story-calls").textContent).toBe("1회");
    expect(screen.getByTestId("workflow-guide-stage-image-calls").textContent).toBe("6회");
    expect(screen.getByTestId("workflow-guide-stage-video-calls").textContent).toBe("6회");
    expect(screen.getByTestId("workflow-guide-total-calls").textContent).toBe("13회");
  });

  it("recomputes calls and cost when the scene count changes", () => {
    render(<WorkflowGuideScreen onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText(/장면 수/), { target: { value: "3" } });
    expect(screen.getByTestId("workflow-guide-stage-story-calls").textContent).toBe("1회");
    expect(screen.getByTestId("workflow-guide-stage-image-calls").textContent).toBe("3회");
    expect(screen.getByTestId("workflow-guide-stage-video-calls").textContent).toBe("3회");
    expect(screen.getByTestId("workflow-guide-total-calls").textContent).toBe("7회");
    // 0.05 + (3 x 0.10) + (3 x 0.25) = 1.10
    expect(screen.getByTestId("workflow-guide-total-cost").textContent).toBe("$1.10");
    expect(screen.getByTestId("workflow-guide-stage-image-cost").textContent).toBe("$0.30");
    expect(screen.getByTestId("workflow-guide-stage-video-cost").textContent).toBe("$0.75");
  });

  it("reports the finished runtime from scene count and clip duration", () => {
    render(<WorkflowGuideScreen onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText(/장면 수/), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/장면당 길이/), { target: { value: "10" } });
    expect(screen.getByText("40초")).toBeTruthy();
  });

  it("returns to the caller's screen from the back link", () => {
    const onBack = vi.fn();
    render(<WorkflowGuideScreen onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /프로젝트 목록으로/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("leaves narration off by default so the projection matches a narration-free project", () => {
    render(<WorkflowGuideScreen onBack={() => {}} />);
    expect((screen.getByTestId("workflow-guide-narration") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByTestId("workflow-guide-stage-narration-calls")).toBeNull();
    expect(screen.getByTestId("workflow-guide-total-calls").textContent).toBe("13회");
    expect(screen.getByTestId("workflow-guide-total-cost").textContent).toBe("$2.15");
  });

  it("adds one narration call per scene, and its cost, once narration is turned on", () => {
    render(<WorkflowGuideScreen onBack={() => {}} />);
    fireEvent.click(screen.getByTestId("workflow-guide-narration"));

    expect(screen.getByTestId("workflow-guide-stage-narration-calls").textContent).toBe("6회");
    // 13 + 6 scenes of narration.
    expect(screen.getByTestId("workflow-guide-total-calls").textContent).toBe("19회");
    // $2.15 + (6 x $0.01).
    expect(screen.getByTestId("workflow-guide-total-cost").textContent).toBe("$2.21");
    expect(screen.getByTestId("workflow-guide-stage-narration-cost").textContent).toBe("$0.06");
  });

  it("scales narration with the scene count like the image and video stages", () => {
    render(<WorkflowGuideScreen onBack={() => {}} />);
    fireEvent.click(screen.getByTestId("workflow-guide-narration"));
    fireEvent.change(screen.getByLabelText(/장면 수/), { target: { value: "3" } });

    expect(screen.getByTestId("workflow-guide-stage-narration-calls").textContent).toBe("3회");
    expect(screen.getByTestId("workflow-guide-total-calls").textContent).toBe("10회");
    // $1.10 + (3 x $0.01).
    expect(screen.getByTestId("workflow-guide-total-cost").textContent).toBe("$1.13");
  });
});
