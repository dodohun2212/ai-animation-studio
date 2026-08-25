import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { NarrationReviewScreen } from "./NarrationReviewScreen.js";

const project = makeProject({});

function narrations(entries: { narration: string; hasAudio?: boolean; audioDurationSeconds?: number }[]) {
  return entries.map((entry, index) => ({
    sceneNumber: index + 1,
    narration: entry.narration,
    hasAudio: entry.hasAudio ?? false,
    ...(entry.audioDurationSeconds === undefined ? {} : { audioDurationSeconds: entry.audioDurationSeconds }),
  }));
}

const settings = {
  projectName: "이름", topic: "주제", genre: "장르", mood: "분위기", character: "인물",
  lore: "", fullStory: "", durationSeconds: 30, sceneCount: 6, clipDurationSeconds: 5,
  additionalNotes: "", styleNotes: {}, narrationEnabled: true, subtitlesEnabled: false,
};

/** Routes by "METHOD url"; an array value is consumed in order (last repeats). */
function stubFetchByRoute(
  routes: Record<string, unknown | unknown[]>,
  errorRoutes: Record<string, { status: number; body: unknown }> = {},
): ReturnType<typeof vi.fn> {
  const cursors: Record<string, number> = {};
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).split("?")[0]!;
    const key = `${init?.method ?? "GET"} ${url}`;
    if (key in errorRoutes) return jsonResponse(errorRoutes[key]!.status, errorRoutes[key]!.body);
    if (!(key in routes)) throw new Error(`Unexpected fetch: ${key}`);
    const value = routes[key];
    if (!Array.isArray(value)) return jsonResponse(200, value);
    const index = Math.min(cursors[key] ?? 0, value.length - 1);
    cursors[key] = index + 1;
    return jsonResponse(200, value[index]);
  });
}

function renderScreen(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return render(<NarrationReviewScreen projectId="sample_project" onBack={() => {}} />);
}

const REVIEW = "GET /projects/sample_project/narration/review";
const SETTINGS = "GET /projects/sample_project/settings";
const GENERATE = "POST /projects/sample_project/narration/generations";
const REGENERATE_2 = "POST /projects/sample_project/narration/review/2/regenerate";

describe("NarrationReviewScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows each scene's narration so it can be read before any audio is paid for", async () => {
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: { project, narrations: narrations([{ narration: "첫 문장입니다." }, { narration: "둘째 문장입니다." }]) },
        [SETTINGS]: { settings },
      }),
    );

    expect(await screen.findByText("첫 문장입니다.")).toBeTruthy();
    expect(screen.getByText("둘째 문장입니다.")).toBeTruthy();
    expect(screen.getByTestId("narration-count").textContent).toBe("2 / 2");
  });

  it("prices the run from the scenes that actually have narration text", async () => {
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: { project, narrations: narrations([{ narration: "문장" }, { narration: "" }, { narration: "문장" }]) },
        [SETTINGS]: { settings },
      }),
    );

    expect((await screen.findByTestId("narration-count")).textContent).toBe("2 / 3");
    expect(screen.getByTestId("narration-estimated-cost").textContent).toBe("$0.02");
    expect(screen.getByTestId("narration-missing").textContent).toContain("1개 장면");
  });

  it("flags narration too long for the clip length loaded from project settings", async () => {
    // 5s clip x 5 chars/sec = 25 characters before a line is flagged.
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: { project, narrations: narrations([{ narration: "짧은 문장" }, { narration: "가".repeat(40) }]) },
        [SETTINGS]: { settings },
      }),
    );

    expect((await screen.findByTestId("narration-too-long")).textContent).toContain("1개 장면");
  });

  it("still shows the narration when the settings request fails, just without length warnings", async () => {
    renderScreen(
      stubFetchByRoute(
        { [REVIEW]: { project, narrations: narrations([{ narration: "가".repeat(200) }]) } },
        { [SETTINGS]: { status: 500, body: { code: "PROJECT_STORAGE_ERROR", message: "실패" } } },
      ),
    );

    expect(await screen.findByText("가".repeat(200))).toBeTruthy();
    expect(screen.queryByTestId("narration-too-long")).toBeNull();
  });

  it("does not synthesize anything just from opening the confirmation", async () => {
    const fetchMock = stubFetchByRoute({
      [REVIEW]: { project, narrations: narrations([{ narration: "문장" }]) },
      [SETTINGS]: { settings },
    });
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("narration-generate-button"));

    const panel = await screen.findByTestId("narration-generate-confirm");
    expect(panel.textContent).toContain("실제 유료 요청이 전송됩니다");
    // The estimate shows even with no budget in the response (local fake mode), while the ledger line does not.
    expect(screen.getByTestId("narration-generate-cost-estimate").textContent).toContain("$0.01");
    expect(screen.queryByTestId("narration-generate-budget")).toBeNull();
    expect(fetchMock.mock.calls.every(([, init]) => ((init as RequestInit | undefined)?.method ?? "GET") === "GET")).toBe(true);
  });

  it("synthesizes only after explicit confirmation and reports what was generated, reused and skipped", async () => {
    const fetchMock = stubFetchByRoute({
      [REVIEW]: [
        { project, narrations: narrations([{ narration: "문장" }, { narration: "" }]) },
        { project, narrations: narrations([{ narration: "문장", hasAudio: true }, { narration: "" }]) },
      ],
      [SETTINGS]: { settings },
      [GENERATE]: {
        project,
        generatedSceneNumbers: [1],
        reusedSceneNumbers: [],
        skippedSceneNumbers: [2],
        budget: { monthlyLimitUsd: 10, spentUsd: 0.01, remainingUsd: 9.99, estimatedRequestCostUsd: 0.01, canSpend: true },
      },
    });
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("narration-generate-button"));
    fireEvent.click(screen.getByRole("button", { name: "예, 음성을 만듭니다" }));

    const summary = await screen.findByTestId("narration-generation-summary");
    expect(summary.textContent).toContain("새로 만듦 1개");
    expect(summary.textContent).toContain("건너뜀 1개");
    expect(screen.getByTestId("narration-budget").textContent).toContain("$9.99");
    await waitFor(() => expect(screen.getByTestId("narration-scene-1")).toHaveAttribute("data-has-audio", "true"));
    expect(screen.getByTestId("narration-audio-1")).toBeTruthy();
  });

  it("offers playback and regeneration only for scenes that already have audio", async () => {
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: { project, narrations: narrations([{ narration: "문장", hasAudio: true }, { narration: "문장" }]) },
        [SETTINGS]: { settings },
      }),
    );

    await screen.findByTestId("narration-audio-1");
    expect(screen.queryByTestId("narration-audio-2")).toBeNull();
    expect(screen.getByTestId("narration-regenerate-1")).toBeTruthy();
    expect(screen.queryByTestId("narration-regenerate-2")).toBeNull();
  });

  it("regenerates one scene only after its own confirmation, showing the retry cost first", async () => {
    const fetchMock = stubFetchByRoute({
      [REVIEW]: { project, narrations: narrations([{ narration: "문장" }, { narration: "문장", hasAudio: true }]) },
      [SETTINGS]: { settings },
      [REGENERATE_2]: {
        project,
        sceneNumber: 2,
        narrations: narrations([{ narration: "문장" }, { narration: "문장", hasAudio: true }]),
        retryEstimate: {
          perSceneCostUsd: 0.01,
          budget: { monthlyLimitUsd: 10, spentUsd: 0.02, remainingUsd: 9.98, estimatedRequestCostUsd: 0.01, canSpend: true },
        },
      },
    });
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("narration-regenerate-2"));
    const panel = await screen.findByTestId("narration-regenerate-confirm-2");
    expect(panel.textContent).toContain("실제로 청구됩니다");
    // Opening the panel must not have sent the regeneration.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/regenerate"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "예, 다시 만듭니다" }));
    await waitFor(() => expect(screen.getByTestId("narration-budget").textContent).toContain("$9.98"));
  });

  it("shows a safe message instead of the backend's own text when generation is refused", async () => {
    renderScreen(
      stubFetchByRoute(
        {
          [REVIEW]: { project, narrations: narrations([{ narration: "문장" }]) },
          [SETTINGS]: { settings },
        },
        { [GENERATE]: { status: 409, body: { code: "NARRATION_NOT_ENABLED", message: "narrationEnabled must be on" } } },
      ),
    );

    fireEvent.click(await screen.findByTestId("narration-generate-button"));
    fireEvent.click(screen.getByRole("button", { name: "예, 음성을 만듭니다" }));

    const error = await screen.findByTestId("narration-action-error");
    expect(error).toHaveAttribute("data-error-code", "NARRATION_NOT_ENABLED");
    expect(error.textContent).toContain("내레이션 넣기");
    expect(error.textContent).not.toContain("narrationEnabled must be on");
  });

  it("marks a scene whose audio is behind the current narration text", async () => {
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: {
          project,
          narrations: narrations([{ narration: "문장", hasAudio: true }, { narration: "문장", hasAudio: true }]),
          staleness: { imageStale: [], videoStale: [], narrationStale: [2] },
        },
        [SETTINGS]: { settings },
      }),
    );

    await screen.findByTestId("narration-stale-2");
    // Scene 1's audio still matches its text, so it carries no badge.
    expect(screen.queryByTestId("narration-stale-1")).toBeNull();
  });

  it("states measured audio length as fact once the audio exists, instead of guessing from characters", async () => {
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: {
          project,
          narrations: narrations([
            { narration: "짧은 문장", hasAudio: true, audioDurationSeconds: 3.2 },
            { narration: "긴 문장", hasAudio: true, audioDurationSeconds: 7.4 },
          ]),
        },
        [SETTINGS]: { settings },
      }),
    );

    // 7.4s of audio in a 5s clip is a fact, not an estimate — and it is reported as one.
    const runsLong = await screen.findByTestId("narration-runs-long");
    expect(runsLong.textContent).toContain("1개 장면");
    expect(runsLong.textContent).toContain("실제로");
    expect(screen.getByTestId("narration-scene-2").textContent).toContain("7.4초");
    // The character-count guess must not also fire for scenes that already have measured audio.
    expect(screen.queryByTestId("narration-too-long")).toBeNull();
  });

  it("falls back to the character-count guess only while a scene has no audio yet", async () => {
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: { project, narrations: narrations([{ narration: "가".repeat(40) }]) },
        [SETTINGS]: { settings },
      }),
    );

    const guess = await screen.findByTestId("narration-too-long");
    expect(guess.textContent).toContain("어림한");
    expect(screen.queryByTestId("narration-runs-long")).toBeNull();
    expect(screen.getByTestId("narration-scene-1").textContent).toContain("40자");
  });
});
