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

const settings = {
  projectName: "이름", topic: "주제", genre: "장르", mood: "분위기", character: "인물",
  lore: "", fullStory: "", durationSeconds: 30, sceneCount: 6, clipDurationSeconds: 5,
  additionalNotes: "", styleNotes: {}, narrationEnabled: true,
};

/**
 * Routes by "METHOD url" so the project and the (optional) settings request can answer independently — the
 * screen deliberately tolerates the settings call failing.
 */
function stubFetch(project: unknown, settingsResponse?: { ok: boolean; body?: unknown }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url = String(input);
    if (url === "/projects/sample_project") return jsonResponse(200, { project });
    if (url === "/projects/sample_project/settings") {
      if (!settingsResponse || settingsResponse.ok) return jsonResponse(200, settingsResponse?.body ?? { settings });
      return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "실패" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

function renderScreen(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return render(<NarrationReviewScreen projectId="sample_project" onBack={() => {}} />);
}

describe("NarrationReviewScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows each scene's narration text so it can be read before any audio is paid for", async () => {
    renderScreen(stubFetch(makeProject({ scenes: scenes(["첫 문장입니다.", "둘째 문장입니다."]) })));

    expect(await screen.findByText("첫 문장입니다.")).toBeTruthy();
    expect(screen.getByText("둘째 문장입니다.")).toBeTruthy();
    expect(screen.getByTestId("narration-count").textContent).toBe("2 / 2");
  });

  it("prices the run from the number of scenes that actually have narration", async () => {
    renderScreen(stubFetch(makeProject({ scenes: scenes(["문장", undefined, "문장"]) })));

    // 2 of 3 scenes carry text, so only those two would be spoken.
    expect((await screen.findByTestId("narration-count")).textContent).toBe("2 / 3");
    expect(screen.getByTestId("narration-estimated-cost").textContent).toBe("$0.02");
  });

  it("warns about scenes left without narration instead of silently skipping them", async () => {
    renderScreen(stubFetch(makeProject({ scenes: scenes(["문장", undefined]) })));

    expect((await screen.findByTestId("narration-missing")).textContent).toContain("1개 장면");
    expect(screen.getByTestId("narration-scene-2")).toHaveAttribute("data-has-narration", "false");
  });

  it("flags narration too long for the clip length it loaded from project settings", async () => {
    // 5s clip x 5 chars/sec = 25 characters before a line is flagged.
    renderScreen(stubFetch(makeProject({ scenes: scenes(["짧은 문장", "가".repeat(40)]) })));

    expect((await screen.findByTestId("narration-too-long")).textContent).toContain("1개 장면");
    expect(screen.getByTestId("narration-scene-1")).toHaveAttribute("data-has-narration", "true");
  });

  it("still shows the narration when the settings request fails, just without length warnings", async () => {
    renderScreen(stubFetch(makeProject({ scenes: scenes(["가".repeat(200)]) }), { ok: false }));

    expect(await screen.findByText("가".repeat(200))).toBeTruthy();
    expect(screen.queryByTestId("narration-too-long")).toBeNull();
  });

  it("never sends anything — reviewing narration is read-only", async () => {
    const fetchMock = stubFetch(makeProject({ scenes: scenes(["문장"]) }));
    renderScreen(fetchMock);

    await screen.findByTestId("narration-count");
    expect(fetchMock.mock.calls.every(([, init]) => ((init as RequestInit | undefined)?.method ?? "GET") === "GET")).toBe(true);
  });
});
