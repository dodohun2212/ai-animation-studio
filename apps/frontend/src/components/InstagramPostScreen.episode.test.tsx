import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubFetchByRoute } from "../api/testUtils.js";
import { InstagramPostScreen } from "./InstagramPostScreen.js";

const libraryEpisode = (overrides: Record<string, unknown> = {}) => ({
  projectId: "12",
  episodeNumber: 1,
  title: "첫 번째 밤",
  projectTitle: "이배드 연대기",
  updatedAt: "2026-08-28T09:00:00.000Z",
  sceneCount: 6,
  videosReadyCount: 6,
  finalVideoAvailable: true,
  totalActualCostUsd: 1.5,
  aspectRatio: "9:16",
  ...overrides,
});

const episodeDetail = (overrides: Record<string, unknown> = {}) => ({
  episodeNumber: 1,
  title: "첫 번째 밤",
  summary: "s", mainEvent: "e", conflict: "c", cliffhanger: "h", nextEpisodeHook: "n",
  status: "completed", approved: true, scriptRevision: 1, scriptHistoryCount: 1,
  updatedAt: "2026-08-28T09:00:00.000Z",
  ...overrides,
});

const EPISODE_VALUE = "episode:12|1";
const routes = (extra: Record<string, unknown> = {}) => ({
  "GET /videos/library": { projects: [], episodes: [libraryEpisode()] },
  "GET /settings/instagram/targets": { targets: [{ igUserId: "1", username: "ibad", pageName: "page" }], selectedIgUserId: "1" },
  "GET /long-projects/12/episodes/1": { episode: episodeDetail() },
  // The whole response shape, not just `settings`: the client's guard demands `projectDefaults` and
  // `changeable` too, so a fixture without them is rejected and the screen reads "length unknown" —
  // which is what a partial fixture was quietly testing.
  "GET /long-projects/12/episodes/1/settings": {
    settings: { sceneCount: 6, clipDurationSeconds: 5, episodeDurationSeconds: 30 },
    projectDefaults: { sceneCount: 6, clipDurationSeconds: 5, episodeDurationSeconds: 30 },
    changeable: false,
  },
  "GET /long-projects/12/settings": { settings: { aspectRatio: "9:16" } },
  ...extra,
});

async function pickEpisode() {
  fireEvent.change(await screen.findByTestId("post-project"), { target: { value: EPISODE_VALUE } });
}

describe("InstagramPostScreen — Episodes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers an Episode with a merged video and posts it through the Episode's own route", async () => {
    const fetchMock = stubFetchByRoute(routes({
      "POST /long-projects/12/episodes/1/instagram/publish": {
        mediaId: "media_9",
        publishedAt: "2026-08-29T01:00:00.000Z",
        episode: episodeDetail({ instagramPost: { mediaId: "media_9", igUserId: "1", publishedAt: "2026-08-29T01:00:00.000Z", caption: "c" } }),
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<InstagramPostScreen onBack={() => {}} />);

    await pickEpisode();
    fireEvent.change(await screen.findByTestId("post-body"), { target: { value: "1화 나왔습니다" } });
    fireEvent.click(screen.getByTestId("post-publish-button"));
    fireEvent.click(await screen.findByTestId("post-publish-confirm-button"));

    await waitFor(() => expect(screen.getByTestId("post-published")).toBeTruthy());
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/episodes/1/instagram/publish"))!;
    // The short project's route must never be the one an Episode goes out on.
    expect(fetchMock.mock.calls.some(([url]) => /^\/projects\/[^/]+\/instagram\/publish$/.test(String(url)))).toBe(false);
    const body = JSON.parse(String((call[1] as RequestInit).body));
    // The account the confirmation named travels with the request, and approval is explicit.
    expect(body).toMatchObject({ approved: true, igUserId: "1" });
    expect(body.caption).toContain("1화 나왔습니다");
  });

  it("stays locked for an Episode the server already has a post recorded for", async () => {
    // The record comes back on the Episode, not just in a publish response, so a reload cannot forget it and
    // invite a second public copy of something already out there.
    vi.stubGlobal("fetch", stubFetchByRoute(routes({
      "GET /long-projects/12/episodes/1": {
        episode: episodeDetail({ instagramPost: { mediaId: "media_9", igUserId: "1", publishedAt: "2026-08-29T01:00:00.000Z", caption: "c" } }),
      },
    })));
    render(<InstagramPostScreen onBack={() => {}} />);

    await pickEpisode();
    await screen.findByTestId("post-published");
    // The button is not merely disabled — it is gone. There is no state here where pressing it again helps.
    expect(screen.queryByTestId("post-publish-button")).toBeNull();
  });

  it("does not offer an Episode that has not been merged yet", async () => {
    // The publish route refuses those (INSTAGRAM_VIDEO_UNAVAILABLE), so offering one would be a choice that
    // cannot be carried out — the exact shape the two separate arrays exist to prevent.
    vi.stubGlobal("fetch", stubFetchByRoute({
      ...routes(),
      "GET /videos/library": { projects: [], episodes: [libraryEpisode({ finalVideoAvailable: false })] },
    }));
    render(<InstagramPostScreen onBack={() => {}} />);

    await screen.findByTestId("post-empty");
    expect(screen.queryByTestId("post-project")).toBeNull();
  });

  it("warns that an Episode caption is not saved for later", async () => {
    // Short projects autosave the draft; an Episode has nowhere to. Saying so beats letting a caption vanish.
    vi.stubGlobal("fetch", stubFetchByRoute(routes()));
    render(<InstagramPostScreen onBack={() => {}} />);

    await pickEpisode();
    expect((await screen.findByTestId("post-episode-draft-notice")).textContent).toContain("자동 저장되지 않습니다");
  });

  it("plays the Episode's own final video and reads its length from the Episode's settings", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute(routes()));
    render(<InstagramPostScreen onBack={() => {}} />);

    await pickEpisode();
    const player = await screen.findByTestId("post-video-player");
    expect(player.getAttribute("src")).toContain("/long-projects/12/episodes/1/videos/final/content");
    // 0:30 comes from episodeDurationSeconds — the screen renders m:ss, and 6 x 5s is the Episode's own
    // derived total rather than anything computed here.
    expect(screen.getByTestId("post-check-length").textContent).toContain("0:30");
  });
});
