import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { LongEpisodeVideoMergeScreen } from "./LongEpisodeVideoMergeScreen.js";

const episode = (status = "completed") => ({ episodeNumber: 1, title: "Episode", summary: "summary", mainEvent: "event", conflict: "conflict", cliffhanger: "cliffhanger", nextEpisodeHook: "hook", status, approved: true, scriptRevision: 1, scriptHistoryCount: 1 });
const response = () => ({ episode: episode(), finalVideoPath: "videos/final/instagram_reel.mp4" as const });

const MERGE_URL = "/long-projects/long/episodes/1/videos/merge";

describe("LongEpisodeVideoMergeScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not request a merge when only opening the explicit confirmation", async () => {
    const mergeFetch = vi.fn();
    vi.stubGlobal("fetch", mergeFetch);
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    fireEvent.click(screen.getByTestId("episode-open-merge-confirm"));

    expect(await screen.findByTestId("episode-merge-confirm-panel")).toBeTruthy();
    expect(mergeFetch).not.toHaveBeenCalled();
  });

  it("states the Episode's fixed six-scene count and that this step costs nothing", async () => {
    // Six is a backend invariant for Episodes (see the constant's comment), so it is stated rather than
    // measured. The cost line matters as much: this is the most final-looking button in the Episode flow and
    // the merge is local FFmpeg only, with no provider call behind it.
    vi.stubGlobal("fetch", vi.fn());
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const notice = screen.getByTestId("episode-merge-scope-notice");
    expect(notice.textContent).toContain("이 단계는 비용이 들지 않습니다");
    expect(notice.textContent).toContain("6개");

    fireEvent.click(screen.getByTestId("episode-open-merge-confirm"));
    expect((await screen.findByTestId("episode-merge-confirm-panel")).textContent).toContain("유료 요청은 전송되지 않습니다");
  });

  it("POSTs the exact Episode merge route without a body after final confirmation", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, response()));
    vi.stubGlobal("fetch", mergeFetch);
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    fireEvent.click(screen.getByTestId("episode-open-merge-confirm"));
    fireEvent.click(await screen.findByTestId("episode-confirm-merge"));

    await screen.findByTestId("episode-merge-success");
    const [url, init] = mergeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(MERGE_URL);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(screen.getByTestId("episode-final-video-path").textContent).toBe("최종 영상: videos/final/instagram_reel.mp4");
  });

  it("keeps a safe retryable error without exposing the backend message or an absolute path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code: "LONG_EPISODE_MERGE_NOT_ALLOWED", message: "raw C:\\private" })));
    render(<LongEpisodeVideoMergeScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    fireEvent.click(screen.getByTestId("episode-open-merge-confirm"));
    fireEvent.click(await screen.findByTestId("episode-confirm-merge"));

    const alert = await screen.findByTestId("episode-merge-error");
    expect(alert).toHaveAttribute("data-error-code", "LONG_EPISODE_MERGE_NOT_ALLOWED");
    expect(alert.textContent).toBe("에피소드 장면 영상 6개가 모두 승인되어야 최종 영상을 만들 수 있습니다.");
    expect(alert.textContent).not.toContain("C:\\private");
    expect(screen.getByTestId("episode-merge-confirm-panel")).toBeTruthy();
  });
});
