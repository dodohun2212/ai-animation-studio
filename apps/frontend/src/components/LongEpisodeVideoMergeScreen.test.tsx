import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { LongEpisodeVideoMergeScreen } from "./LongEpisodeVideoMergeScreen.js";

const episode = (status = "completed") => ({ episodeNumber: 1, title: "Episode", summary: "summary", mainEvent: "event", conflict: "conflict", cliffhanger: "cliffhanger", nextEpisodeHook: "hook", status, approved: true, scriptRevision: 1, scriptHistoryCount: 1 });
const response = () => ({ episode: episode(), finalVideoPath: "videos/final/instagram_reel.mp4" as const });

describe("LongEpisodeVideoMergeScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not request a merge when only opening the explicit confirmation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    fireEvent.click(screen.getByTestId("episode-open-merge-confirm"));

    expect(await screen.findByTestId("episode-merge-confirm-panel")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the exact Episode merge route without a body after final confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response()));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    fireEvent.click(screen.getByTestId("episode-open-merge-confirm"));
    fireEvent.click(await screen.findByTestId("episode-confirm-merge"));

    await screen.findByTestId("episode-merge-success");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/long-projects/long/episodes/1/videos/merge");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(screen.getByTestId("episode-final-video-path").textContent).toBe("Final video: videos/final/instagram_reel.mp4");
  });

  it("keeps a safe retryable error without exposing the backend message or an absolute path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code: "LONG_EPISODE_MERGE_NOT_ALLOWED", message: "raw C:\\private" })));
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    fireEvent.click(screen.getByTestId("episode-open-merge-confirm"));
    fireEvent.click(await screen.findByTestId("episode-confirm-merge"));

    const alert = await screen.findByTestId("episode-merge-error");
    expect(alert).toHaveAttribute("data-error-code", "LONG_EPISODE_MERGE_NOT_ALLOWED");
    expect(alert.textContent).toBe("Final Episode rendering requires six approved video scenes.");
    expect(alert.textContent).not.toContain("C:\\private");
    expect(screen.getByTestId("episode-merge-confirm-panel")).toBeTruthy();
  });
});
