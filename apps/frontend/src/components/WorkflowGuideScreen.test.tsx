import { DEFAULT_VIDEO_MODEL, RUNWAY_CLIP_DURATIONS, VIDEO_MODEL_OPTIONS, videoModelOption, videoSceneEstimatedCostUsd } from "@ai-animation-studio/shared";
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

  it("adds no calls and no cost when only subtitles are turned on", () => {
    render(<WorkflowGuideScreen onBack={() => {}} />);
    fireEvent.click(screen.getByTestId("workflow-guide-subtitles"));

    // Subtitles are burned in locally — they must not change the AI call count or the cost.
    expect(screen.getByTestId("workflow-guide-total-calls").textContent).toBe("13회");
    expect(screen.getByTestId("workflow-guide-total-cost").textContent).toBe("$2.15");
    expect(screen.queryByTestId("workflow-guide-stage-narration-calls")).toBeNull();
  });

  it("keeps the voice stage priced on its own when both switches are on", () => {
    render(<WorkflowGuideScreen onBack={() => {}} />);
    fireEvent.click(screen.getByTestId("workflow-guide-subtitles"));
    fireEvent.click(screen.getByTestId("workflow-guide-narration"));

    expect(screen.getByTestId("workflow-guide-stage-narration-calls").textContent).toBe("6회");
    expect(screen.getByTestId("workflow-guide-total-calls").textContent).toBe("19회");
    expect(screen.getByTestId("workflow-guide-total-cost").textContent).toBe("$2.21");
  });

  // The model picker (캡틴D 승인, Cowork Round 756): the rate names its model, moves with the clip length and the
  // picked model, says it is for the calculation only, and warns on a clip the model cannot make.
  const defaultOption = videoModelOption(DEFAULT_VIDEO_MODEL);
  const longest = RUNWAY_CLIP_DURATIONS[RUNWAY_CLIP_DURATIONS.length - 1]!;
  const setLength = (seconds: number) => fireEvent.change(screen.getByLabelText("장면당 길이"), { target: { value: String(seconds) } });
  const videoTotal = () => screen.getByTestId("workflow-guide-stage-video-cost").textContent;

  it("says which model the video rate belongs to, instead of quoting a number from nowhere", () => {
    render(<WorkflowGuideScreen onBack={() => {}} />);

    // 🔴 A rate with no model attached is the failure this guards — not the label's wording, but that the screen
    // names its source at all, and names the model it actually priced with.
    expect(screen.getByTestId("workflow-guide-stage-video-unit-note").textContent).toContain(defaultOption.label);
  });

  it("prices the video stage from this projection's own clip length, not a flat per-scene number", () => {
    render(<WorkflowGuideScreen onBack={() => {}} />);

    setLength(RUNWAY_CLIP_DURATIONS[0]!);
    const atShortest = videoTotal();
    setLength(longest);
    // The two lengths this app offers must not quote the same total — the defect the clip-length argument was
    // added to fix, with nothing holding it there afterwards.
    expect(videoTotal()).not.toBe(atShortest);
    expect(videoTotal()).toContain((6 * videoSceneEstimatedCostUsd(longest, defaultOption)).toFixed(2));
  });

  /*
   * 🔴 The reason the picker exists. Two models at different rates must not produce the same projection — that
   * is the whole failure this screen would otherwise hide, and it is invisible until a second model exists.
   *
   * Written so it says something true today and more later: with one model in the contract it asserts the picker
   * offers exactly what the contract offers and the total matches that model; with two or more it also asserts
   * the total actually moves between them.
   */
  it("offers every model the contract has, and prices the projection from the one picked", () => {
    render(<WorkflowGuideScreen onBack={() => {}} />);
    const picker = screen.getByTestId("workflow-guide-video-model");

    expect(picker.querySelectorAll("option")).toHaveLength(VIDEO_MODEL_OPTIONS.length);

    const totals = VIDEO_MODEL_OPTIONS.map((option) => {
      fireEvent.change(picker, { target: { value: option.id } });
      expect(screen.getByTestId("workflow-guide-stage-video-unit-note").textContent).toContain(option.label);
      expect(videoTotal()).toContain((6 * videoSceneEstimatedCostUsd(5, option)).toFixed(2));
      return videoTotal();
    });
    // Models priced differently must not read the same on screen. Equal prices may legitimately coincide, so this
    // compares the distinct quotes (the contract's, per-scene charges included) rather than demanding every row differ.
    const distinctQuotes = new Set(VIDEO_MODEL_OPTIONS.map((option) => videoSceneEstimatedCostUsd(5, option)));
    expect(new Set(totals).size).toBe(distinctQuotes.size);
  });

  it("says the picked model is for the calculation only, and points at where the real choice lives", () => {
    render(<WorkflowGuideScreen onBack={() => {}} />);

    // A picker that looks like a setting but is not one would send someone away believing they had chosen.
    const note = screen.getByTestId("workflow-guide-video-model-note").textContent ?? "";
    expect(note).toContain("계산에만");
    expect(note).toContain("설정");
  });

  /*
   * 🔴 A combination the person can now build here, priced as if it works.
   *
   * Unreachable while every model outlasts the longest clip this app offers — so this asserts the rule rather
   * than a fixture: whether the warning is shown must follow whether the chosen length exceeds the chosen
   * model's own maximum, in both directions. Veo 3.1 (4·6·8s only) was ruled out as a candidate for exactly
   * this, and the next candidate that cannot do 10 seconds makes it real without anyone touching this screen.
   */
  it("warns, instead of pricing, when the clip is longer than the chosen model can make", () => {
    render(<WorkflowGuideScreen onBack={() => {}} />);
    const picker = screen.getByTestId("workflow-guide-video-model");

    for (const option of VIDEO_MODEL_OPTIONS) {
      fireEvent.change(picker, { target: { value: option.id } });
      for (const seconds of RUNWAY_CLIP_DURATIONS) {
        setLength(seconds);
        const warned = screen.queryByTestId("workflow-guide-clip-too-long") !== null;
        expect(warned, `${option.label} at ${seconds}s`).toBe(seconds > option.maxDurationSeconds);
      }
    }
  });
});
