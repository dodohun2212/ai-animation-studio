import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { LongEpisodeImageGenerationScreen } from "./LongEpisodeImageGenerationScreen.js";

const episode = (status: "asset_mapping_approved" | "images_review" | "waiting_for_video_confirmation") => ({
  episodeNumber: 1, title: "Episode 1", summary: "Summary", mainEvent: "Event", conflict: "Conflict", cliffhanger: "Hook", nextEpisodeHook: "Next",
  status, approved: true, scriptRevision: 2, scriptHistoryCount: 1,
});
const reviews = (approved: number[] = []) => [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: approved.includes(sceneNumber) ? "approved" as const : "pending" as const, updatedAt: "2026-08-23T00:00:00.000Z" }));

describe("LongEpisodeImageGenerationScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not generate on opening its confirmation, then explicitly starts only the local fake adapter", async () => {
    const imageReviewEpisode = episode("images_review");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode("asset_mapping_approved") }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageReviewEpisode, generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageReviewEpisode, reviews: reviews() }));
    vi.stubGlobal("fetch", fetchMock);

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    expect(await screen.findByTestId("episode-image-cost-notice")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "이미지 생성 시작" }));
    expect(await screen.findByTestId("episode-image-generate-confirm")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "이미지 생성" }));
    await screen.findByTestId("episode-image-generation-summary");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/long-projects/long/episodes/1/images/generations");
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({ approved: true });
    await screen.findByTestId("episode-image-review-1");
  });

  it("loads persisted review, explicitly approves one scene, then confirms only that scene regeneration", async () => {
    const reviewEpisode = episode("images_review");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: true } }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode, reviews: reviews() }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode, reviews: reviews([1]) }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode, reviews: reviews(), sceneNumber: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect(await screen.findByTestId("episode-image-continuity-available")).toHaveTextContent("에피소드 1의 마지막 장면(6번)");
    expect(await screen.findByTestId("episode-image-review-1")).toHaveAttribute("data-status", "pending");
    fireEvent.click(screen.getAllByRole("button", { name: "이 이미지로 확정" })[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/long-projects/long/episodes/1/images/review/1/approve");
    expect(JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body))).toEqual({ approved: true });

    fireEvent.click(screen.getAllByRole("button", { name: "다시 만들기" })[1]!);
    expect(await screen.findByTestId("episode-image-regenerate-confirm-2")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByRole("button", { name: "이 장면 다시 만들기" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls[4]?.[0]).toBe("/long-projects/long/episodes/1/images/review/2/regenerate");
    expect(JSON.parse(String((fetchMock.mock.calls[4]?.[1] as RequestInit).body))).toEqual({ approved: true });
    expect(screen.getByTestId("episode-image-review-1")).toHaveAttribute("data-status", "pending");
  });

  it("shows the separate video-confirmation transition and does not expose internal image paths", async () => {
    const done = episode("waiting_for_video_confirmation");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: done }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: false } }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: done, reviews: reviews([1, 2, 3, 4, 5, 6]) })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    expect(await screen.findByTestId("episode-video-confirmation-transition")).toBeTruthy();
    expect(await screen.findByTestId("episode-image-continuity-unavailable")).toBeTruthy();
    expect(document.body.textContent).not.toContain("C:\\");
  });

  it("shows the estimated cost before generation, and the reported budget after it", async () => {
    const imageReviewEpisode = episode("images_review");
    // Script approval happens before Asset Mapping approval in the workflow, so by "asset_mapping_approved" the
    // Episode's own script already exists — the cost estimate reads its scene count from there (see the
    // "falls back to the Episode's own script" test above), not a guessed six.
    const scenes = [1, 2, 3, 4, 5, 6].map((number) => ({
      number, description: "d", visualAction: "v", startMotion: "s", mainMotion: "m", endMotion: "e",
      shotSize: "s", cameraAngle: "c", composition: "c", lensFeel: "l", focusSubject: "f", cameraMotion: "c",
      environmentMotion: "e", motionSpeed: "n", motionIntensity: "m", expressionChange: "x", continuityHint: "h",
    }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: { ...episode("asset_mapping_approved"), script: { title: "t", synopsis: "s", ending: "e", scenes } } }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          episode: imageReviewEpisode,
          generatedSceneNumbers: [1, 2, 3, 4, 5, 6],
          reusedSceneNumbers: [],
          budget: { monthlyLimitUsd: 10, spentUsd: 0.6, remainingUsd: 9.4, estimatedRequestCostUsd: 0.6, canSpend: true },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageReviewEpisode, reviews: reviews() }));
    vi.stubGlobal("fetch", fetchMock);

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "이미지 생성 시작" }));

    // 6 scenes x $0.10, shown before the request goes out.
    expect(screen.getByTestId("episode-image-cost-estimate").textContent).toContain("$0.60");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "이미지 생성" }));
    const budget = await screen.findByTestId("episode-image-generation-budget");
    expect(budget.textContent).toContain("$9.40");
  });

  it("omits the budget line when the response reported none (local fake mode charges nothing)", async () => {
    const imageReviewEpisode = episode("images_review");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode("asset_mapping_approved") }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageReviewEpisode, generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageReviewEpisode, reviews: reviews() }));
    vi.stubGlobal("fetch", fetchMock);

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "이미지 생성 시작" }));
    fireEvent.click(screen.getByRole("button", { name: "이미지 생성" }));

    await screen.findByTestId("episode-image-generation-summary");
    expect(screen.queryByTestId("episode-image-generation-budget")).toBeNull();
  });

  it("does not report a missing continuity reference as a problem on the first Episode", async () => {
    // Episode 1 has no previous Episode by definition — "없습니다" alone reads as an unmet prerequisite.
    const first = episode("asset_mapping_approved");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: first }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: { previousEpisodeNumber: 0, sourceSceneNumber: 6, available: false } }))
      .mockResolvedValue(jsonResponse(200, { episode: first, reviews: reviews() })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect((await screen.findByTestId("episode-image-continuity-unavailable")).textContent).toContain("첫 에피소드라");
  });

  it("explains what happens instead when a later Episode has no continuity reference", async () => {
    const later = { ...episode("asset_mapping_approved"), episodeNumber: 2 };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: later }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: false } }))
      .mockResolvedValue(jsonResponse(200, { episode: later, reviews: reviews() })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={2} onBack={() => {}} />);

    const notice = await screen.findByTestId("episode-image-continuity-unavailable");
    expect(notice.textContent).toContain("이어받지 않고");
    expect(notice.textContent).not.toContain("첫 에피소드라");
  });

  it("draws the scene list from the server's review list, not a six it made up itself", async () => {
    // Four reviews means four scenes on screen and four in the price — the count is reported, never assumed.
    const fourReviews = [1, 2, 3, 4].map((sceneNumber) => ({ sceneNumber, status: "pending" as const, updatedAt: "2026-08-23T00:00:00.000Z" }));
    const ready = episode("images_review");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: ready }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValue(jsonResponse(200, { episode: ready, reviews: fourReviews })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    await waitFor(() => expect(screen.getByTestId("episode-image-scene-4")).toBeTruthy());
    expect(screen.queryByTestId("episode-image-scene-5")).toBeNull();
    expect(screen.getByTestId("episode-image-review-summary").textContent).toContain("4장면 중");
  });

  it("falls back to the Episode's own script before any review exists", async () => {
    // Right after Asset Mapping approval there are no reviews yet, but the approved script already knows how
    // many scenes there are — so the list is still right instead of blank or a guessed six.
    const scenes = [1, 2, 3].map((number) => ({
      number, description: "d", visualAction: "v", startMotion: "s", mainMotion: "m", endMotion: "e",
      shotSize: "s", cameraAngle: "c", composition: "c", lensFeel: "l", focusSubject: "f", cameraMotion: "c",
      environmentMotion: "e", motionSpeed: "n", motionIntensity: "m", expressionChange: "x", continuityHint: "h",
    }));
    const withScript = { ...episode("asset_mapping_approved"), script: { title: "t", synopsis: "s", ending: "e", scenes } };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: withScript }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValue(jsonResponse(200, { episode: withScript, reviews: [] })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    await waitFor(() => expect(screen.getByTestId("episode-image-scene-3")).toBeTruthy());
    expect(screen.queryByTestId("episode-image-scene-4")).toBeNull();
  });

  it("names the previous Episode's last scene from the response instead of always saying six", async () => {
    // The reference is "the previous Episode's last scene". Writing 6 into the sentence made that a claim the
    // screen invented, and it goes wrong the moment an Episode is not six scenes long.
    const ready = episode("images_review");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: ready }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: { previousEpisodeNumber: 2, sourceSceneNumber: 4, available: true } }))
      .mockResolvedValue(jsonResponse(200, { episode: ready, reviews: reviews() })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={3} onBack={() => {}} />);

    const line = await screen.findByTestId("episode-image-continuity-available");
    expect(line.textContent).toContain("에피소드 2의 마지막 장면(4번)");
    expect(line.textContent).not.toContain("6번 장면");
  });
});
