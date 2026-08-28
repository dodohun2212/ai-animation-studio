import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeLongProjectSettings } from "../api/testUtils.js";
import { LongEpisodeNarrationReviewScreen } from "./LongEpisodeNarrationReviewScreen.js";

const episode = (status = "script_approved") => ({
  episodeNumber: 2, title: "Episode", summary: "", mainEvent: "", conflict: "", cliffhanger: "", nextEpisodeHook: "",
  status, approved: true, scriptRevision: 1, scriptHistoryCount: 0,
});

function narrations(entries: { narration: string; hasAudio?: boolean; audioDurationSeconds?: number }[]) {
  return entries.map((entry, index) => ({
    sceneNumber: index + 1,
    narration: entry.narration,
    // Mechanical: the contract now names what the audio is rather than whether it exists. Naming the state
    // directly at each call site is the better fixture and belongs with the screen work that has to tell
    // a placeholder apart from a real voice.
    audio: entry.hasAudio ? "generated" : "none",
    ...(entry.audioDurationSeconds === undefined ? {} : { audioDurationSeconds: entry.audioDurationSeconds }),
  }));
}

const settings = (overrides: { narrationEnabled?: boolean; subtitlesEnabled?: boolean; clipDurationSeconds?: number } = {}) =>
  makeLongProjectSettings({ narrationEnabled: true, subtitlesEnabled: false, clipDurationSeconds: 5, ...overrides });

/** Routes by "METHOD url"; an array value is consumed in order (last repeats). Query strings are stripped so
 * the audio cache-buster does not create a new key. */
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
  return render(<LongEpisodeNarrationReviewScreen projectId="long_sample" episodeNumber={2} onBack={() => {}} />);
}

const REVIEW = "GET /long-projects/long_sample/episodes/2/narration/review";
const SETTINGS = "GET /long-projects/long_sample/settings";
const GENERATE = "POST /long-projects/long_sample/episodes/2/narration/generations";
const REGENERATE_1 = "POST /long-projects/long_sample/episodes/2/narration/review/1/regenerate";

describe("LongEpisodeNarrationReviewScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the Episode's sentences and its own cost, and sends nothing while only reading", async () => {
    // Reading must never cost anything: the whole reason this screen exists is to let someone check the
    // sentences before paying per scene.
    const fetchMock = stubFetchByRoute({
      [REVIEW]: { episode: episode(), narrations: narrations([{ narration: "첫 문장입니다." }, { narration: "둘째 문장입니다." }]) },
      [SETTINGS]: { settings: settings() },
    });
    renderScreen(fetchMock);

    expect(await screen.findByText("첫 문장입니다.")).toBeTruthy();
    expect(screen.getByText("둘째 문장입니다.")).toBeTruthy();
    expect(screen.getByTestId("episode-narration-count").textContent).toBe("2 / 2");
    expect(screen.getByTestId("episode-narration-estimated-cost").textContent).toBe("$0.02");
    // Scoped to this Episode, not the whole project — the same button exists on every Episode.
    expect(screen.getByTestId("episode-narration-summary").textContent).toContain("이 에피소드 한 편 기준");
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("does not send the paid request until the confirmation is explicitly accepted", async () => {
    const fetchMock = stubFetchByRoute({
      [REVIEW]: [
        { episode: episode(), narrations: narrations([{ narration: "첫 문장입니다." }]) },
        { episode: episode(), narrations: narrations([{ narration: "첫 문장입니다.", hasAudio: true, audioDurationSeconds: 3.2 }]) },
      ],
      [SETTINGS]: { settings: settings() },
      [GENERATE]: { episode: episode(), generatedSceneNumbers: [1], reusedSceneNumbers: [], skippedSceneNumbers: [] },
    });
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("episode-narration-generate-button"));
    const panel = await screen.findByTestId("episode-narration-generate-confirm");
    expect(panel.textContent).toContain("에피소드 2의 1개 장면 음성을 만들까요?");
    expect(panel.textContent).toContain("다른 에피소드에는 영향을 주지 않습니다");
    // Opening the panel is not consent.
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === "/long-projects/long_sample/episodes/2/narration/generations")).toBe(false);

    fireEvent.click(screen.getByText("예, 음성을 만듭니다"));

    await screen.findByTestId("episode-narration-generation-summary");
    expect(screen.getByTestId("episode-narration-generation-summary").textContent).toContain("새로 만듦 1개");
    expect(await screen.findByTestId("episode-narration-audio-1")).toBeTruthy();
  });

  it("only points at the script screen while the script is still editable there", async () => {
    // The Episode script is editable in script_review and read-only afterwards. Telling someone past that
    // point to "go fix the sentence in the script screen" would send them to a disabled field.
    const fetchMock = stubFetchByRoute({
      [REVIEW]: { episode: episode("script_review"), narrations: narrations([{ narration: "첫 문장입니다." }]) },
      [SETTINGS]: { settings: settings() },
    });
    renderScreen(fetchMock);
    expect(await screen.findByText(/대본 화면의 "읽어줄 문장" 항목에서 고치면 됩니다/)).toBeTruthy();

    vi.unstubAllGlobals();
    cleanup();

    renderScreen(stubFetchByRoute({
      [REVIEW]: { episode: episode("videos_approved"), narrations: narrations([{ narration: "첫 문장입니다." }]) },
      [SETTINGS]: { settings: settings() },
    }));
    expect(await screen.findByText(/문장을 더 고칠 수 없습니다/)).toBeTruthy();
    expect(screen.queryByText(/대본 화면의 "읽어줄 문장" 항목에서 고치면 됩니다/)).toBeNull();
  });

  it("hides every paid control when the project has narration turned off, and says why", async () => {
    // The backend answers LONG_EPISODE_NARRATION_NOT_ENABLED here, so an enabled button would be a button that
    // is guaranteed to fail. Subtitles-only is a real mode, and the sentences are still doing a job in it.
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: { episode: episode(), narrations: narrations([{ narration: "첫 문장입니다.", hasAudio: true }]) },
        [SETTINGS]: { settings: settings({ narrationEnabled: false, subtitlesEnabled: true }) },
      }),
    );

    await waitFor(() => expect(screen.getByTestId("episode-narration-voice-off")).toBeTruthy());
    expect(screen.getByTestId("episode-narration-voice-off").textContent).toContain("자막으로 들어갑니다");
    expect(screen.getByTestId("episode-narration-estimated-cost").textContent).toBe("$0.00");
    expect(screen.queryByTestId("episode-narration-generate-button")).toBeNull();
    // Regenerating one scene is paid too, so it goes with the rest.
    expect(screen.queryByTestId("episode-narration-regenerate-1")).toBeNull();
  });

  it("keeps working when the project settings cannot be read, rather than hiding the paid button on a guess", async () => {
    // voiceMode stays null. Hiding the button here would strand someone whose narration is actually on.
    renderScreen(
      stubFetchByRoute(
        { [REVIEW]: { episode: episode(), narrations: narrations([{ narration: "첫 문장입니다." }]) } },
        { [SETTINGS]: { status: 500, body: { code: "LONG_PROJECT_STORAGE_ERROR", message: "x" } } },
      ),
    );

    expect(await screen.findByTestId("episode-narration-generate-button")).toBeTruthy();
    expect(screen.queryByTestId("episode-narration-voice-off")).toBeNull();
    // No clip length known, so neither length warning may fire on a guess.
    expect(screen.queryByTestId("episode-narration-too-long")).toBeNull();
    expect(screen.queryByTestId("episode-narration-runs-long")).toBeNull();
  });

  it("separates a measured over-length from a guessed one", async () => {
    // A measured length is a fact; a character count is a guess. Saying "this is too long" about a file that
    // was actually measured, and "might be" about one that was not, is the difference between the two.
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: {
          episode: episode(),
          narrations: narrations([
            { narration: "짧은 문장.", hasAudio: true, audioDurationSeconds: 7.4 },
            { narration: "아".repeat(60) },
          ]),
        },
        [SETTINGS]: { settings: settings({ clipDurationSeconds: 5 }) },
      }),
    );

    await waitFor(() => expect(screen.getByTestId("episode-narration-runs-long")).toBeTruthy());
    expect(screen.getByTestId("episode-narration-runs-long").textContent).toContain("실제로 5초 장면보다 깁니다");
    expect(screen.getByTestId("episode-narration-too-long").textContent).toContain("길어 보입니다");
  });

  it("sends a blank regeneration instruction as an omitted field, never as an empty string", async () => {
    const fetchMock = stubFetchByRoute({
      [REVIEW]: { episode: episode(), narrations: narrations([{ narration: "첫 문장입니다.", hasAudio: true }]) },
      [SETTINGS]: { settings: settings() },
      [REGENERATE_1]: { episode: episode(), narrations: narrations([{ narration: "첫 문장입니다.", hasAudio: true }]), sceneNumber: 1 },
    });
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("episode-narration-regenerate-1"));
    fireEvent.click(await screen.findByText("예, 다시 만듭니다"));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((entry) => String(entry[0]).endsWith("/narration/review/1/regenerate"));
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ approved: true });
    });
  });

  it("shows a safe message for a narration provider failure without leaking the backend's own text", async () => {
    renderScreen(
      stubFetchByRoute(
        {
          [REVIEW]: { episode: episode(), narrations: narrations([{ narration: "첫 문장입니다." }]) },
          [SETTINGS]: { settings: settings() },
        },
        {
          [GENERATE]: {
            status: 502,
            body: { code: "LONG_EPISODE_NARRATION_PROVIDER_ERROR", message: "raw sk-abc123 leaked", details: { category: "authentication" } },
          },
        },
      ),
    );

    fireEvent.click(await screen.findByTestId("episode-narration-generate-button"));
    fireEvent.click(await screen.findByText("예, 음성을 만듭니다"));

    const alert = await screen.findByTestId("episode-narration-action-error");
    expect(alert).toHaveAttribute("data-error-code", "LONG_EPISODE_NARRATION_PROVIDER_ERROR");
    expect(alert.textContent).toBe("OpenAI 인증에 실패했습니다. API 설정에서 키를 다시 확인해 주세요.");
    expect(alert.textContent).not.toContain("sk-abc123");
  });
});
