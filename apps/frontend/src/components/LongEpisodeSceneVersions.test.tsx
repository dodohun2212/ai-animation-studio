import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { LongEpisodeSceneVersions } from "./LongEpisodeSceneVersions.js";

const episode = (status: string) => ({ episodeNumber: 1, title: "Episode", summary: "s", mainEvent: "e", conflict: "c", cliffhanger: "h", nextEpisodeHook: "n", status, approved: true, scriptRevision: 1, scriptHistoryCount: 1 });
const version = (versionId: string, isCurrent: boolean, createdAt = "2026-08-28T04:00:00.000Z") => ({ versionId, createdAt, bytes: 2_100_000, isCurrent });

function renderCard(fetchMock: ReturnType<typeof vi.fn>, onRestored = () => {}) {
  vi.stubGlobal("fetch", fetchMock);
  return render(<LongEpisodeSceneVersions projectId="long" episodeNumber={1} sceneNumber={3} onRestored={onRestored} />);
}

describe("LongEpisodeSceneVersions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("draws nothing for a scene that was never regenerated", async () => {
    // The route answers `["current"]`, not an empty list, so "no history" has to be read as a length of one.
    // A disclosure that opens onto a single row is noise on a screen already asked to say less.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { versions: [version("current", true)] }));
    renderCard(fetchMock);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("episode-video-versions-3")).toBeNull();
  });

  it("lists the past clips with a player each, and leaves out the one in use", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      versions: [version("current", true), version("v002", false), version("v001", false)],
    }));
    renderCard(fetchMock);

    expect((await screen.findByTestId("episode-video-versions-3")).textContent).toContain("이전 판 2개");
    expect(screen.queryByTestId("episode-video-version-3-current")).toBeNull();
    const player = screen.getByTestId("episode-video-version-player-3-v002");
    expect(player.getAttribute("src")).toContain("/long-projects/long/episodes/1/videos/3/versions/v002/content");
  });

  it("reads which clip is in use from isCurrent, not from the top of the list", async () => {
    // After a restore the clip in use is an older one, so the row order stops meaning "newest is current".
    // Reading position instead of the flag would offer to restore the clip already in use and hide a real one.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      versions: [version("v001", true, "2026-08-20T00:00:00.000Z"), version("current", false, "2026-08-28T00:00:00.000Z")],
    }));
    renderCard(fetchMock);

    await screen.findByTestId("episode-video-versions-3");
    expect(screen.getByTestId("episode-video-version-3-current")).toBeTruthy();
    expect(screen.queryByTestId("episode-video-version-3-v001")).toBeNull();
  });

  it("says the merged final video will be void before restoring, and only sends after that is confirmed", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { versions: [version("current", true), version("v001", false)] }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode("videos_approved") }))
      .mockResolvedValue(jsonResponse(200, { versions: [version("current", true), version("v002", false)] }));
    const restored = vi.fn();
    renderCard(fetchMock, restored);

    fireEvent.click(await screen.findByTestId("episode-video-version-restore-3-v001"));
    const confirmPanel = screen.getByTestId("episode-video-version-confirm-3-v001");
    expect(confirmPanel.textContent).toContain("최종 영상은 무효가 되어 다시 합쳐야 합니다");
    // Opening the panel must not restore anything — the POST belongs to the second press.
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "POST")).toBe(false);

    fireEvent.click(screen.getByTestId("episode-video-version-confirm-yes-3-v001"));

    await waitFor(() => expect(restored).toHaveBeenCalledTimes(1));
    const post = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "POST")!;
    expect(String(post[0])).toBe("/long-projects/long/episodes/1/videos/3/versions/v001/restore");
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ approved: true });
    // The Episode comes back in the state the restore left it in, not the one the screen asked from.
    expect(restored.mock.calls[0]![0]).toMatchObject({ status: "videos_approved" });
  });
});
