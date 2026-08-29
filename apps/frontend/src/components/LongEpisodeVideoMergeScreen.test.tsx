import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeLongProjectSettings, stubFetchByRoute } from "../api/testUtils.js";
import { LongEpisodeVideoMergeScreen } from "./LongEpisodeVideoMergeScreen.js";

const episode = (status = "completed") => ({ episodeNumber: 1, title: "Episode", summary: "summary", mainEvent: "event", conflict: "conflict", cliffhanger: "cliffhanger", nextEpisodeHook: "hook", status, approved: true, scriptRevision: 1, scriptHistoryCount: 1 });
const response = () => ({ episode: episode(), finalVideoPath: "videos/final/instagram_reel.mp4" as const });

/**
 * An Episode carrying a script of `count` scenes — the screen reads its scene count from exactly this.
 *
 * Defaults to 승인 완료, the state a person is actually in when they open this screen. It used to default to
 * `completed`, which is the state *after* a merge — harmless while the screen ignored status, and misleading
 * now that a finished Episode shows its player on sight: every pre-merge test would have rendered the success
 * block before merging anything, and the one test that waits for that block would have passed without it.
 */
const episodeWithScenes = (count: number, status = "videos_approved") => ({
  ...episode(status),
  script: {
    title: "Episode",
    synopsis: "",
    ending: "",
    scenes: Array.from({ length: count }, (_, index) => ({
      number: index + 1,
      description: "", visualAction: "", startMotion: "", mainMotion: "", endMotion: "",
      shotSize: "", cameraAngle: "", composition: "", lensFeel: "", focusSubject: "",
      cameraMotion: "", environmentMotion: "", motionSpeed: "", motionIntensity: "",
      expressionChange: "", continuityHint: "",
    })),
  },
});

const EPISODE_URL = "/long-projects/long/episodes/1";
const SETTINGS_URL = "/long-projects/long/settings";
const mediaSettings = (narrationEnabled: boolean, subtitlesEnabled: boolean) => ({
  settings: makeLongProjectSettings({ narrationEnabled, subtitlesEnabled }),
});
const MERGE_URL = "/long-projects/long/episodes/1/videos/merge";
const CURRENT_JOB_URL = "/long-projects/long/episodes/1/videos/generations/current";
const REVIEW_URL = "/long-projects/long/episodes/1/videos/generations/job/review";

/**
 * The two GETs behind the confirmed count: the review is addressed by job id, so the job has to be found first.
 * `approved` of `total` scenes are 확정됨; the rest stay pending.
 */
const confirmedRoutes = (approved: number, total: number) => ({
  [`GET ${CURRENT_JOB_URL}`]: { jobId: "job" },
  [`GET ${REVIEW_URL}`]: {
    episode: episode("videos_review"),
    reviews: Array.from({ length: total }, (_, index) => ({
      sceneNumber: index + 1,
      status: index < approved ? "approved" : "pending",
      updatedAt: "2026-08-23T00:00:00.000Z",
    })),
  },
});

describe("LongEpisodeVideoMergeScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not request a merge when only opening the explicit confirmation", async () => {
    const mergeFetch = stubFetchByRoute({ [`GET ${EPISODE_URL}`]: { episode: episodeWithScenes(4) }, [`GET ${SETTINGS_URL}`]: mediaSettings(false, false) });
    vi.stubGlobal("fetch", mergeFetch);
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    fireEvent.click(screen.getByTestId("episode-open-merge-confirm"));

    expect(await screen.findByTestId("episode-merge-confirm-panel")).toBeTruthy();
    // Reading the Episode to word the notice is a GET; nothing may POST until the final confirmation.
    expect(mergeFetch.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("states the Episode's own scene count and how many of them are confirmed, both read rather than assumed", async () => {
    // This screen used to hold `const EPISODE_SCENE_COUNT = 6` with a comment arguing six was a backend
    // invariant. That was true when written and false once Episodes became 2-12 scenes, so the number is now
    // measured. Four is deliberately not six: a screen that still hardcoded six would pass a six-scene
    // fixture. The confirmed half is measured for the same reason — the notice used to print the scene count
    // behind the word 승인된, which read as a claim about confirmations it had never looked at. The cost line
    // matters as much: this is the most final-looking button in the Episode flow and the merge is local FFmpeg
    // only, with no provider call behind it.
    vi.stubGlobal("fetch", stubFetchByRoute({ [`GET ${EPISODE_URL}`]: { episode: episodeWithScenes(4) }, [`GET ${SETTINGS_URL}`]: mediaSettings(false, false), ...confirmedRoutes(4, 4) }));
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const count = await screen.findByTestId("episode-merge-approved-count");
    await waitFor(() => expect(count.textContent).toContain("4개 확정됨"));
    expect(count.textContent).toContain("장면 4개 중");
    expect(count.textContent).not.toContain("6개");
    expect((await screen.findByTestId("episode-merge-scope-notice")).textContent).toContain("이 단계는 비용이 들지 않습니다");
    expect(screen.queryByTestId("episode-merge-blocked")).toBeNull();

    fireEvent.click(screen.getByTestId("episode-open-merge-confirm"));
    expect((await screen.findByTestId("episode-merge-confirm-panel")).textContent).toContain("유료 요청은 전송되지 않습니다");
  });

  it("names the scenes still to be confirmed instead of letting the merge be refused by the server", async () => {
    // The count and the block come from the same two reads; the block is what makes the count actionable.
    vi.stubGlobal("fetch", stubFetchByRoute({ [`GET ${EPISODE_URL}`]: { episode: episodeWithScenes(4) }, [`GET ${SETTINGS_URL}`]: mediaSettings(false, false), ...confirmedRoutes(1, 4) }));
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect((await screen.findByTestId("episode-merge-blocked")).textContent).toContain("3개");
    expect((await screen.findByTestId("episode-merge-approved-count")).textContent).toContain("1개 확정됨");

    fireEvent.click(screen.getByTestId("episode-open-merge-confirm"));
    expect(screen.queryByTestId("episode-merge-confirm-panel")).toBeNull();
  });

  it("drops the count rather than guessing one when the Episode cannot be read", async () => {
    // A wrong number here would be read as a promise about what is about to be merged. Saying nothing is safe;
    // printing a default is not. The merge button stays available — the count is wording, not a precondition.
    vi.stubGlobal("fetch", stubFetchByRoute({ [`GET ${SETTINGS_URL}`]: mediaSettings(false, false) }, { [`GET ${EPISODE_URL}`]: { status: 500, body: { code: "LONG_PROJECT_STORAGE_ERROR", message: "x" } } }));
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const notice = await screen.findByTestId("episode-merge-scope-notice");
    expect(notice.textContent).toContain("확정한 장면 영상을 순서대로");
    expect(notice.textContent).not.toMatch(/\d+개/);
    // Nothing to compare the confirmations against, so neither the count nor the block may be drawn.
    await waitFor(() => expect(screen.queryByTestId("episode-merge-approved-count")).toBeNull());
    expect(screen.queryByTestId("episode-merge-blocked")).toBeNull();
    expect(screen.getByTestId("episode-open-merge-confirm")).toBeTruthy();
  });

  it("says what will be laid over the clips, and never ties a subtitle to having audio", async () => {
    // Subtitles-only is a real mode — no TTS spend, captions burned in — so the sentence must not imply that a
    // scene needs audio before it can get a subtitle. The Episode merge is gated exactly like the short
    // project's, and this line is the only place the user learns which of the two will happen.
    vi.stubGlobal("fetch", stubFetchByRoute({
      [`GET ${EPISODE_URL}`]: { episode: episodeWithScenes(4) },
      [`GET ${SETTINGS_URL}`]: mediaSettings(false, true),
    }));
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const notice = await screen.findByTestId("episode-merge-scope-notice");
    await waitFor(() => expect(notice.textContent).toContain("음성은 꺼져 있어 넣지 않습니다"));
    expect(notice.textContent).toContain("자막만 입힙니다");
  });

  it("says nothing about audio or subtitles when the settings could not be read", async () => {
    // A wrong claim here is worse than none: someone would confirm a merge expecting narration on it.
    vi.stubGlobal("fetch", stubFetchByRoute(
      { [`GET ${EPISODE_URL}`]: { episode: episodeWithScenes(4) }, ...confirmedRoutes(4, 4) },
      { [`GET ${SETTINGS_URL}`]: { status: 500, body: { code: "LONG_PROJECT_STORAGE_ERROR", message: "x" } } },
    ));
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const notice = await screen.findByTestId("episode-merge-scope-notice");
    // The confirmed count needs two round trips, so its arrival is proof the one-hop settings read has settled
    // too — without it this would assert on a sentence that had not been given the chance to be wrong yet.
    await waitFor(() => expect(screen.getByTestId("episode-merge-approved-count").textContent).toContain("4개 확정됨"));
    expect(notice.textContent).not.toContain("자막");
    expect(notice.textContent).not.toContain("음성");
  });

  it("POSTs the exact Episode merge route without a body after final confirmation", async () => {
    const mergeFetch = stubFetchByRoute({
      [`GET ${EPISODE_URL}`]: { episode: episodeWithScenes(4) },
      [`GET ${SETTINGS_URL}`]: mediaSettings(false, false),
      [`POST ${MERGE_URL}`]: response(),
    });
    vi.stubGlobal("fetch", mergeFetch);
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    fireEvent.click(screen.getByTestId("episode-open-merge-confirm"));
    fireEvent.click(await screen.findByTestId("episode-confirm-merge"));

    await screen.findByTestId("episode-merge-success");
    const post = mergeFetch.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "POST");
    const [url, init] = post as [string, RequestInit];
    expect(url).toBe(MERGE_URL);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(screen.getByTestId("episode-final-video-path").textContent).toBe("파일: videos/final/instagram_reel.mp4");
  });

  it("keeps a safe retryable error without exposing the backend message or an absolute path", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute(
      { [`GET ${EPISODE_URL}`]: { episode: episodeWithScenes(4) }, [`GET ${SETTINGS_URL}`]: mediaSettings(false, false) },
      { [`POST ${MERGE_URL}`]: { status: 409, body: { code: "LONG_EPISODE_MERGE_NOT_ALLOWED", message: "raw C:\\private" } } },
    ));
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    fireEvent.click(screen.getByTestId("episode-open-merge-confirm"));
    fireEvent.click(await screen.findByTestId("episode-confirm-merge"));

    const alert = await screen.findByTestId("episode-merge-error");
    expect(alert).toHaveAttribute("data-error-code", "LONG_EPISODE_MERGE_NOT_ALLOWED");
    // Was "...영상 6개가 모두 승인되어야..." — a fixed six in a message the user reads, left behind when
    // Episodes became 2-12 scenes. It now says the same thing without claiming a count.
    expect(alert.textContent).toBe("에피소드의 장면 영상이 모두 승인되어야 최종 영상을 만들 수 있습니다.");
    expect(alert.textContent).not.toContain("C:\\private");
    expect(screen.getByTestId("episode-merge-confirm-panel")).toBeTruthy();
  });

  /**
   * Six 32-byte stubs passed 확정 because nobody could watch them. A merge whose only output is a file path
   * printed as text is that same blindness one layer up — and the line lived in React state, so a reload
   * erased even that.
   */
  it("plays the finished Episode, and still does so after a reload that lost the merge response", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({
      [`GET ${EPISODE_URL}`]: { episode: episodeWithScenes(4, "completed") },
      [`GET ${SETTINGS_URL}`]: mediaSettings(false, false),
      ...confirmedRoutes(4, 4),
    }));
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const player = await screen.findByTestId("episode-final-video");
    expect(player.getAttribute("src")).toContain("/long-projects/long/episodes/1/videos/final/content");
    // Nothing was merged in this page load, so there is no path to print — only the Episode's own state said
    // it was finished, and that is what has to survive a refresh.
    expect(screen.queryByTestId("episode-final-video-path")).toBeNull();
  });

  it("does not claim the Episode is finished before it has been merged", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({
      [`GET ${EPISODE_URL}`]: { episode: episodeWithScenes(4) },
      [`GET ${SETTINGS_URL}`]: mediaSettings(false, false),
      ...confirmedRoutes(4, 4),
    }));
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    await screen.findByTestId("episode-merge-approved-count");
    expect(screen.queryByTestId("episode-merge-success")).toBeNull();
    expect(screen.queryByTestId("episode-final-video")).toBeNull();
  });

  it("says the file will not play instead of showing a black box that claims to be the finished Episode", async () => {
    // The route refuses a file at or below placeholder size — a merge cannot be smaller than what it merged —
    // so this is what a merge of empty clips looks like on screen.
    vi.stubGlobal("fetch", stubFetchByRoute({
      [`GET ${EPISODE_URL}`]: { episode: episodeWithScenes(4, "completed") },
      [`GET ${SETTINGS_URL}`]: mediaSettings(false, false),
      ...confirmedRoutes(4, 4),
    }));
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    fireEvent.error(await screen.findByTestId("episode-final-video"));

    const notice = await screen.findByTestId("episode-final-video-missing");
    expect(notice.textContent).toContain("재생할 수 없습니다");
    expect(screen.queryByTestId("episode-final-video")).toBeNull();
  });

});
