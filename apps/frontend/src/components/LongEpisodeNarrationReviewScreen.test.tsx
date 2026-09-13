import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LongEpisodeDetail, LongEpisodeStatus, NarrationAudioState } from "@ai-animation-studio/shared";

import { jsonResponse, makeLongProjectSettings } from "../api/testUtils.js";
import { LongEpisodeNarrationReviewScreen } from "./LongEpisodeNarrationReviewScreen.js";

const episode = (status: LongEpisodeStatus = "script_approved"): LongEpisodeDetail => ({
  episodeNumber: 2, title: "Episode", summary: "", mainEvent: "", conflict: "", cliffhanger: "", nextEpisodeHook: "",
  status, approved: true, scriptRevision: 1, scriptHistoryCount: 0, updatedAt: "2026-09-05T00:00:00.000Z",
});

function narrations(entries: { narration: string; audio?: NarrationAudioState; audioDurationSeconds?: number }[]) {
  return entries.map((entry, index) => ({
    sceneNumber: index + 1,
    narration: entry.narration,
    audio: entry.audio ?? "none",
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
      [REVIEW]: { episode: episode(), staleness: { narrationStale: [] }, narrations: narrations([{ narration: "첫 문장입니다." }, { narration: "둘째 문장입니다." }]) },
      [SETTINGS]: { settings: settings(), aspectRatioChangeable: true },
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

  /**
   * 🔴 견적은 **말해질** 장면만 셉니다. 상자가 「이미 음성이 있는 장면은 다시 만들지 않아 비용도 들지 않습니다」
   * 라고 하면서 그 장면까지 곱하면 두 줄이 서로를 부정합니다 — 그리고 이 수는 `BudgetLine` 에 그대로 들어가서,
   * 많이 부르면 낼 수 있는 돈인데도 예산에 걸려 막힙니다. 짧은 프로젝트 화면과 같은 함수를 씁니다.
   */
  it("counts only the scenes that will actually be synthesized", async () => {
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: {
          episode: episode(),
          staleness: { narrationStale: [] },
          narrations: narrations([
            { narration: "문장", audio: "generated" },   // 이미 있고 뒤처지지도 않음 — 안 말해집니다
            { narration: "문장", audio: "none" },
            { narration: "문장", audio: "placeholder" },  // 진짜 목소리가 아닙니다 — 말해집니다
          ]),
        },
        [SETTINGS]: { settings: settings(), aspectRatioChangeable: true },
      }),
    );

    // 글이 있는 장면은 셋 그대로 — 그건 다른 사실입니다.
    expect((await screen.findByTestId("episode-narration-count")).textContent).toBe("3 / 3");
    expect(screen.getByTestId("episode-narration-estimated-cost").textContent, "말해질 두 장면만").toBe("$0.02");

    fireEvent.click(screen.getByTestId("episode-narration-generate-button"));
    const estimate = await screen.findByTestId("episode-narration-generate-cost-estimate");
    expect(estimate.textContent).toContain("2장면");
    expect(estimate.textContent, "수가 왜 적은지 그 자리에서 말합니다").toContain("이미 음성이 있는 1장면은 빠졌습니다");
    expect(screen.getByTestId("episode-narration-generate-confirm").textContent).toContain("2개 장면 음성을 만들까요");
  });

  /** 글이 바뀌어 뒤처진 음성은 **다시 만들어집니다** — 있다고 빼면 적게 부르는 쪽이라 더 위험합니다. */
  it("charges again for audio that has fallen behind its text", async () => {
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: {
          episode: episode(),
          staleness: { narrationStale: [2] },
          narrations: narrations([{ narration: "문장", audio: "generated" }, { narration: "문장", audio: "generated" }]),
        },
        [SETTINGS]: { settings: settings(), aspectRatioChangeable: true },
      }),
    );

    expect((await screen.findByTestId("episode-narration-estimated-cost")).textContent, "뒤처진 2번만").toBe("$0.01");
    fireEvent.click(screen.getByTestId("episode-narration-generate-button"));
    const estimate = await screen.findByTestId("episode-narration-generate-cost-estimate");
    expect(estimate.textContent).toContain("이미 음성이 있는 1장면은 빠졌습니다");
  });

  /**
   * 살 게 0 장면이면 버튼이 「0개 장면 음성을 만들까요?」 를 엽니다 — 눌러도 백엔드가 전부 재사용으로 끝내니
   * 돈은 안 들지만, 누를 이유가 없는 버튼입니다.
   */
  it("offers no paid button when every sentence in the Episode already has audio", async () => {
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: {
          episode: episode(),
          staleness: { narrationStale: [] },
          narrations: narrations([{ narration: "문장", audio: "generated" }, { narration: "문장", audio: "generated" }]),
        },
        [SETTINGS]: { settings: settings(), aspectRatioChangeable: true },
      }),
    );

    const voiced = await screen.findByTestId("episode-narration-all-voiced");
    expect(voiced.textContent).toContain("모두 음성이 있습니다");
    expect(voiced.textContent, "막다른 골목으로 두지 않습니다").toContain("문장을 고치면");
    expect(screen.queryByTestId("episode-narration-generate-button"), "0개를 만드는 버튼은 없습니다").toBeNull();
    expect(screen.getByTestId("episode-narration-estimated-cost").textContent).toBe("$0.00");
  });

  /** 반대쪽: 하나라도 말해질 게 있으면 버튼이 있고 저 안내는 없습니다. */
  it("keeps the paid button, and says nothing about being all voiced, while one scene still needs audio", async () => {
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: {
          episode: episode(),
          staleness: { narrationStale: [] },
          narrations: narrations([{ narration: "문장", audio: "generated" }, { narration: "문장", audio: "none" }]),
        },
        [SETTINGS]: { settings: settings(), aspectRatioChangeable: true },
      }),
    );

    expect(await screen.findByTestId("episode-narration-generate-button")).toBeTruthy();
    expect(screen.queryByTestId("episode-narration-all-voiced")).toBeNull();
  });

  it("does not send the paid request until the confirmation is explicitly accepted", async () => {
    const fetchMock = stubFetchByRoute({
      [REVIEW]: [
        { episode: episode(), staleness: { narrationStale: [] }, narrations: narrations([{ narration: "첫 문장입니다." }]) },
        { episode: episode(), staleness: { narrationStale: [] }, narrations: narrations([{ narration: "첫 문장입니다.", audio: "generated", audioDurationSeconds: 3.2 }]) },
      ],
      [SETTINGS]: { settings: settings(), aspectRatioChangeable: true },
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
      [REVIEW]: { episode: episode("script_review"), staleness: { narrationStale: [] }, narrations: narrations([{ narration: "첫 문장입니다." }]) },
      [SETTINGS]: { settings: settings(), aspectRatioChangeable: true },
    });
    renderScreen(fetchMock);
    expect(await screen.findByText(/대본 화면의 "읽어줄 문장" 항목에서 고치면 됩니다/)).toBeTruthy();

    vi.unstubAllGlobals();
    cleanup();

    renderScreen(stubFetchByRoute({
      [REVIEW]: { episode: episode("videos_approved"), staleness: { narrationStale: [] }, narrations: narrations([{ narration: "첫 문장입니다." }]) },
      [SETTINGS]: { settings: settings(), aspectRatioChangeable: true },
    }));
    expect(await screen.findByText(/문장을 더 고칠 수 없습니다/)).toBeTruthy();
    expect(screen.queryByText(/대본 화면의 "읽어줄 문장" 항목에서 고치면 됩니다/)).toBeNull();
  });

  /**
   * The third state the pair above does not have: not yet read, and never read.
   *
   * `scriptEditable` is false in both, and false rendered the read-only sentence — so a screen that had not
   * asked told the person, as a fact about workflow stage, that this Episode is past 대본 검토 and the sentences
   * can no longer be fixed. Someone who believes that stops trying to correct a bad line and buys the voice for
   * it instead, which is the per-scene charge this screen exists to let them avoid.
   *
   * Silence is the right answer here, not a third sentence: the error alert below already says what happened.
   */
  it("does not claim the script is past editing when the review could not be read", async () => {
    renderScreen(stubFetchByRoute(
      { [SETTINGS]: { settings: settings(), aspectRatioChangeable: true } },
      { [REVIEW]: { status: 500, body: { code: "LONG_PROJECT_STORAGE_ERROR", message: "raw backend detail" } } },
    ));

    await screen.findByTestId("episode-narration-load-error");
    expect(screen.queryByText(/문장을 더 고칠 수 없습니다/)).toBeNull();
    expect(screen.queryByText(/대본 화면의 "읽어줄 문장" 항목에서 고치면 됩니다/)).toBeNull();
  });

  it("hides every paid control when the project has narration turned off, and says why", async () => {
    // The backend answers LONG_EPISODE_NARRATION_NOT_ENABLED here, so an enabled button would be a button that
    // is guaranteed to fail. Subtitles-only is a real mode, and the sentences are still doing a job in it.
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: { episode: episode(), staleness: { narrationStale: [] }, narrations: narrations([{ narration: "첫 문장입니다.", audio: "generated" }]) },
        [SETTINGS]: { settings: settings({ narrationEnabled: false, subtitlesEnabled: true }), aspectRatioChangeable: true },
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
        { [REVIEW]: { episode: episode(), staleness: { narrationStale: [] }, narrations: narrations([{ narration: "첫 문장입니다." }]) } },
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
          staleness: { narrationStale: [] }, narrations: narrations([
            { narration: "짧은 문장.", audio: "generated", audioDurationSeconds: 7.4 },
            { narration: "아".repeat(60) },
          ]),
        },
        [SETTINGS]: { settings: settings({ clipDurationSeconds: 5 }), aspectRatioChangeable: true },
      }),
    );

    await waitFor(() => expect(screen.getByTestId("episode-narration-runs-long")).toBeTruthy());
    expect(screen.getByTestId("episode-narration-runs-long").textContent).toContain("실제로 5초 장면보다 깁니다");
    expect(screen.getByTestId("episode-narration-too-long").textContent).toContain("길어 보입니다");
  });

  it("sends a blank regeneration instruction as an omitted field, never as an empty string", async () => {
    const fetchMock = stubFetchByRoute({
      [REVIEW]: { episode: episode(), staleness: { narrationStale: [] }, narrations: narrations([{ narration: "첫 문장입니다.", audio: "generated" }]) },
      [SETTINGS]: { settings: settings(), aspectRatioChangeable: true },
      [REGENERATE_1]: { episode: episode(), narrations: narrations([{ narration: "첫 문장입니다.", audio: "generated" }]), sceneNumber: 1 },
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
          [REVIEW]: { episode: episode(), staleness: { narrationStale: [] }, narrations: narrations([{ narration: "첫 문장입니다." }]) },
          [SETTINGS]: { settings: settings(), aspectRatioChangeable: true },
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

  /**
   * The server was already comparing the recorded sentence against the current one — it decides re-synthesis
   * that way — and simply never said so. So a voice reading a line the script no longer contains could be
   * confirmed. Images and videos had said this for weeks; the one you have to listen to did not.
   */
  it("marks a scene whose recorded voice no longer matches its sentence", async () => {
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: {
          episode: episode(),
          staleness: { narrationStale: [2] },
          narrations: narrations([
            { narration: "그대로인 문장.", audio: "generated" },
            { narration: "바뀐 문장.", audio: "generated" },
          ]),
        },
        [SETTINGS]: { settings: settings(), aspectRatioChangeable: true },
      }),
    );

    const changed = await screen.findByTestId("episode-narration-scene-2");
    expect(changed).toHaveAttribute("data-stale", "true");
    expect(changed.textContent).toContain("문장과 다름");
    expect(screen.getByTestId("episode-narration-stale-2").textContent).toContain("다시 만들어");
    // The scene that did not change says nothing — a badge on everything is a badge on nothing.
    expect(screen.getByTestId("episode-narration-scene-1")).toHaveAttribute("data-stale", "false");
  });

  /**
   * A scene with no audio has nothing to be behind. Calling it stale would send someone to re-buy a scene they
   * never bought — the exact reason the server leaves recordless scenes off the list.
   */
  it("never calls a scene with no audio stale, even if the server lists it", async () => {
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: {
          episode: episode(),
          staleness: { narrationStale: [1] },
          narrations: narrations([{ narration: "아직 만들지 않은 문장." }]),
        },
        [SETTINGS]: { settings: settings(), aspectRatioChangeable: true },
      }),
    );

    const scene = await screen.findByTestId("episode-narration-scene-1");
    expect(scene).toHaveAttribute("data-audio", "none");
    expect(scene).toHaveAttribute("data-stale", "false");
    expect(screen.queryByTestId("episode-narration-stale-1")).toBeNull();
  });

  /**
   * The screen used to carry the previous list forward and take the regenerated scene out of it. That inference
   * was correct and was a second place deciding what "stale" means; the server now recomputes every scene and
   * sends the answer. The stub deliberately keeps scene 2 stale AND clears scene 1, so a screen that went back
   * to inferring would still pass — which is why scene 2 is asserted from a list the screen did not compute.
   */
  it("takes the regenerated staleness from the server rather than working it out", async () => {
    const fetchMock = stubFetchByRoute({
      [REVIEW]: {
        episode: episode(),
        staleness: { narrationStale: [1, 2] },
        narrations: narrations([
          { narration: "첫 문장입니다.", audio: "generated" },
          { narration: "둘째 문장입니다.", audio: "generated" },
        ]),
      },
      [SETTINGS]: { settings: settings(), aspectRatioChangeable: true },
      // Recomputed server-side for every scene, so the screen only has to read it.
      [REGENERATE_1]: {
        episode: episode(),
        staleness: { narrationStale: [2] },
        narrations: narrations([
          { narration: "첫 문장입니다.", audio: "generated" },
          { narration: "둘째 문장입니다.", audio: "generated" },
        ]),
        sceneNumber: 1,
      },
    });
    renderScreen(fetchMock);

    expect(await screen.findByTestId("episode-narration-scene-1")).toHaveAttribute("data-stale", "true");
    fireEvent.click(screen.getByTestId("episode-narration-regenerate-1"));
    fireEvent.click(await screen.findByText("예, 다시 만듭니다"));

    await waitFor(() => expect(screen.getByTestId("episode-narration-scene-1")).toHaveAttribute("data-stale", "false"));
    // Straight from the response, not carried over: the server is the only thing deciding this now.
    expect(screen.getByTestId("episode-narration-scene-2")).toHaveAttribute("data-stale", "true");
  });

  /**
   * The direction the old inference could not express. Regenerating one scene can leave another one behind —
   * someone edits two sentences and re-synthesizes one — and a screen that only ever *removed* entries would
   * keep showing scene 2 as current. Only a recomputed list can turn a mark back on.
   */
  it("takes on a mark the server adds during a regeneration", async () => {
    const fetchMock = stubFetchByRoute({
      [REVIEW]: {
        episode: episode(),
        staleness: { narrationStale: [] },
        narrations: narrations([
          { narration: "첫 문장입니다.", audio: "generated" },
          { narration: "둘째 문장입니다.", audio: "generated" },
        ]),
      },
      [SETTINGS]: { settings: settings(), aspectRatioChangeable: true },
      [REGENERATE_1]: {
        episode: episode(),
        staleness: { narrationStale: [2] },
        narrations: narrations([
          { narration: "첫 문장입니다.", audio: "generated" },
          { narration: "둘째 문장입니다.", audio: "generated" },
        ]),
        sceneNumber: 1,
      },
    });
    renderScreen(fetchMock);

    expect(await screen.findByTestId("episode-narration-scene-2")).toHaveAttribute("data-stale", "false");
    fireEvent.click(screen.getByTestId("episode-narration-regenerate-1"));
    fireEvent.click(await screen.findByText("예, 다시 만듭니다"));

    await waitFor(() => expect(screen.getByTestId("episode-narration-scene-2")).toHaveAttribute("data-stale", "true"));
  });

  it("calls a placeholder a placeholder instead of reporting it as a real voice", async () => {
    // With no OpenAI key connected the app writes a 4-byte silent file, and it used to be reported exactly the
    // way synthesized audio was: the chip said 음성 있음 over silence, and the merge shipped that silence as
    // narration. Both halves are asserted — the honest chip AND the absence of the old claim — because a chip
    // that merely stopped saying 음성 있음 while showing nothing would hide the state rather than name it.
    renderScreen(
      stubFetchByRoute({
        [REVIEW]: { episode: episode(), staleness: { narrationStale: [] }, narrations: narrations([{ narration: "첫 문장입니다.", audio: "placeholder" }]) },
        [SETTINGS]: { settings: settings(), aspectRatioChangeable: true },
      }),
    );

    const scene = await screen.findByTestId("episode-narration-scene-1");
    expect(scene).toHaveAttribute("data-audio", "placeholder");
    expect(scene.textContent).toContain("임시 음성");
    expect(scene.textContent).not.toContain("음성 있음");
    // The player stays: pressing play and hearing silence is how the reviewer confirms what the chip says.
    expect(screen.getByTestId("episode-narration-audio-1")).toBeTruthy();
  });
});
