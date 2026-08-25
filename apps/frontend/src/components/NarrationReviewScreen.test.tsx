import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@ai-animation-studio/shared";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { NarrationReviewScreen } from "./NarrationReviewScreen.js";

function scenes(narrations: (string | undefined)[]): Scene[] {
  return narrations.map((narration, index) => ({
    number: (index + 1) as Scene["number"],
    script: `Scene ${index + 1}`,
    imagePrompt: `Image ${index + 1}`,
    motionPrompt: `Motion ${index + 1}`,
    imageReview: "pending" as const,
    videoReview: "pending" as const,
    ...(narration === undefined ? {} : { narration }),
  }));
}

function renderScreen(fetchMock: ReturnType<typeof vi.fn>, clipDurationSeconds?: number) {
  vi.stubGlobal("fetch", fetchMock);
  return render(
    <NarrationReviewScreen projectId="sample_project" onBack={() => {}} clipDurationSeconds={clipDurationSeconds} />,
  );
}

describe("NarrationReviewScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows each scene's narration text so it can be read before any audio is paid for", async () => {
    const project = makeProject({ scenes: scenes(["첫 문장입니다.", "둘째 문장입니다."]) });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { project })));

    expect(await screen.findByText("첫 문장입니다.")).toBeTruthy();
    expect(screen.getByText("둘째 문장입니다.")).toBeTruthy();
    expect(screen.getByTestId("narration-count").textContent).toBe("2 / 2");
  });

  it("prices the run from the number of scenes that actually have narration", async () => {
    const project = makeProject({ scenes: scenes(["문장", undefined, "문장"]) });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { project })));

    // 2 of 3 scenes carry text, so only those two would be spoken.
    expect((await screen.findByTestId("narration-count")).textContent).toBe("2 / 3");
    expect(screen.getByTestId("narration-estimated-cost").textContent).toBe("$0.02");
  });

  it("warns about scenes left without narration instead of silently skipping them", async () => {
    const project = makeProject({ scenes: scenes(["문장", undefined]) });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { project })));

    expect((await screen.findByTestId("narration-missing")).textContent).toContain("1개 장면");
    expect(screen.getByTestId("narration-scene-2")).toHaveAttribute("data-has-narration", "false");
  });

  it("flags narration that looks too long to read inside its clip", async () => {
    // 5s clip x 5 chars/sec = 25 characters before the line is flagged.
    const project = makeProject({ scenes: scenes(["짧은 문장", "가".repeat(40)]) });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { project })), 5);

    expect((await screen.findByTestId("narration-too-long")).textContent).toContain("1개 장면");
    expect(screen.getByTestId("narration-scene-1")).toHaveAttribute("data-has-narration", "true");
  });

  it("never warns about length when no clip duration is known", async () => {
    const project = makeProject({ scenes: scenes(["가".repeat(200)]) });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { project })));

    await screen.findByTestId("narration-count");
    expect(screen.queryByTestId("narration-too-long")).toBeNull();
  });

  it("never sends anything — reviewing narration is read-only", async () => {
    const project = makeProject({ scenes: scenes(["문장"]) });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project }));
    renderScreen(fetchMock);

    await screen.findByTestId("narration-count");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.every(([, init]) => ((init as RequestInit | undefined)?.method ?? "GET") === "GET")).toBe(true);
  });
});
