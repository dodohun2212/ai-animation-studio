import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeLongProjectSettings } from "../api/testUtils.js";
import { LongEpisodeImageGenerationScreen } from "./LongEpisodeImageGenerationScreen.js";

const episode = (status: "planned" | "asset_mapping_approved" | "generating_images" | "images_ready" | "images_review" | "waiting_for_video_confirmation") => ({
  episodeNumber: 1, title: "Episode 1", summary: "Summary", mainEvent: "Event", conflict: "Conflict", cliffhanger: "Hook", nextEpisodeHook: "Next",
  status, approved: true, scriptRevision: 2, scriptHistoryCount: 1,
});
/**
 * A script the response guard accepts. `longProjectsApi` checks every scene for all sixteen motion fields, so a
 * scene written as `{ number }` makes the whole Episode response invalid and the screen renders nothing — the
 * list and the gallery a test is asserting about never exist. The screen also refuses to guess scene numbers,
 * so a state that has no reviews yet needs this to have any scenes at all.
 */
const scriptScenes = (count = 6) => Array.from({ length: count }, (_, index) => ({
  number: index + 1, description: "d", visualAction: "v", startMotion: "s", mainMotion: "m", endMotion: "e",
  shotSize: "s", cameraAngle: "c", composition: "c", lensFeel: "l", focusSubject: "f", cameraMotion: "c",
  environmentMotion: "e", motionSpeed: "n", motionIntensity: "m", expressionChange: "x", continuityHint: "h",
}));
const withScript = (value: ReturnType<typeof episode>, count = 6) => ({ ...value, script: { title: "t", synopsis: "s", ending: "e", scenes: scriptScenes(count) } });

const reviews = (approved: number[] = []) => [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: approved.includes(sceneNumber) ? "approved" as const : "pending" as const, updatedAt: "2026-08-23T00:00:00.000Z" }));

describe("LongEpisodeImageGenerationScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not generate on opening its confirmation, then explicitly starts only the local fake adapter", async () => {
    const imageReviewEpisode = episode("images_review");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode("asset_mapping_approved") }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageReviewEpisode, generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageReviewEpisode, reviews: reviews(), staleness: { imageStale: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    expect(await screen.findByTestId("episode-image-cost-notice")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "이미지 생성 시작" }));
    expect(await screen.findByTestId("episode-image-generate-confirm")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: "이미지 생성" }));
    await screen.findByTestId("episode-image-generation-summary");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/long-projects/long/episodes/1/images/generations");
    expect(JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body))).toEqual({ approved: true });
    await screen.findByTestId("episode-image-review-1");
  });

  it("loads persisted review, explicitly approves one scene, then confirms only that scene regeneration", async () => {
    const reviewEpisode = episode("images_review");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: true } }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode, reviews: reviews(), staleness: { imageStale: [] } }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode, reviews: reviews([1]), staleness: { imageStale: [] } }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode, reviews: reviews(), staleness: { imageStale: [] }, sceneNumber: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect(await screen.findByTestId("episode-image-continuity-available")).toHaveTextContent("에피소드 1의 마지막 장면(6번)");
    expect(await screen.findByTestId("episode-image-review-1")).toHaveAttribute("data-status", "pending");
    fireEvent.click(screen.getAllByRole("button", { name: "이 이미지로 확정" })[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls[4]?.[0]).toBe("/long-projects/long/episodes/1/images/review/1/approve");
    expect(JSON.parse(String((fetchMock.mock.calls[4]?.[1] as RequestInit).body))).toEqual({ approved: true });

    fireEvent.click(screen.getAllByRole("button", { name: "다시 만들기" })[1]!);
    expect(await screen.findByTestId("episode-image-regenerate-confirm-2")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    fireEvent.click(screen.getByRole("button", { name: "이 장면 다시 만들기" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    expect(fetchMock.mock.calls[5]?.[0]).toBe("/long-projects/long/episodes/1/images/review/2/regenerate");
    expect(JSON.parse(String((fetchMock.mock.calls[5]?.[1] as RequestInit).body))).toEqual({ approved: true });
    expect(screen.getByTestId("episode-image-review-1")).toHaveAttribute("data-status", "pending");
  });

  it("shows the separate video-confirmation transition and does not expose internal image paths", async () => {
    const done = episode("waiting_for_video_confirmation");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: done }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: false } }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: done, reviews: reviews([1, 2, 3, 4, 5, 6]), staleness: { imageStale: [] } })));
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
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          episode: imageReviewEpisode,
          generatedSceneNumbers: [1, 2, 3, 4, 5, 6],
          reusedSceneNumbers: [],
          budget: { monthlyLimitUsd: 10, spentUsd: 0.6, remainingUsd: 9.4, estimatedRequestCostUsd: 0.6, canSpend: true },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageReviewEpisode, reviews: reviews(), staleness: { imageStale: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "이미지 생성 시작" }));

    // 6 scenes x $0.10, shown before the request goes out.
    expect(screen.getByTestId("episode-image-cost-estimate").textContent).toContain("$0.60");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: "이미지 생성" }));
    const budget = await screen.findByTestId("episode-image-generation-budget");
    expect(budget.textContent).toContain("$9.40");
  });

  it("omits the budget line when the response reported none (local fake mode charges nothing)", async () => {
    const imageReviewEpisode = episode("images_review");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode("asset_mapping_approved") }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageReviewEpisode, generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageReviewEpisode, reviews: reviews(), staleness: { imageStale: [] } }));
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
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) }))
      .mockResolvedValue(jsonResponse(200, { episode: first, reviews: reviews(), staleness: { imageStale: [] } })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect((await screen.findByTestId("episode-image-continuity-unavailable")).textContent).toContain("첫 에피소드라");
  });

  it("explains what happens instead when a later Episode has no continuity reference", async () => {
    const later = { ...episode("asset_mapping_approved"), episodeNumber: 2 };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: later }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: false } }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) }))
      .mockResolvedValue(jsonResponse(200, { episode: later, reviews: reviews(), staleness: { imageStale: [] } })));
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
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) }))
      .mockResolvedValue(jsonResponse(200, { episode: ready, reviews: fourReviews, staleness: { imageStale: [] } })));
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
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) }))
      .mockResolvedValue(jsonResponse(200, { episode: withScript, reviews: [], staleness: { imageStale: [] } })));
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
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) }))
      .mockResolvedValue(jsonResponse(200, { episode: ready, reviews: reviews(), staleness: { imageStale: [] } })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={3} onBack={() => {}} />);

    const line = await screen.findByTestId("episode-image-continuity-available");
    expect(line.textContent).toContain("에피소드 2의 마지막 장면(4번)");
    expect(line.textContent).not.toContain("6번 장면");
  });

  it("shows the picture it is asking the reviewer to approve, and refetches it after a regeneration", async () => {
    // Until now this screen had no <img> at all and no route served one, so 확정/다시 만들기 — one of which
    // spends money — were pressed against a picture nobody had seen. The cache buster is the second half: the
    // browser would otherwise keep showing the rejected image while the reviewer decides about the new one.
    const reviewEpisode = episode("images_review");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "16:9" }) }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode, reviews: reviews(), staleness: { imageStale: [] } })));

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={2} onBack={() => {}} />);

    const picture = await screen.findByTestId("episode-image-review-picture-1");
    expect(picture.getAttribute("src")).toContain("/long-projects/long/episodes/2/images/1/content");
    expect(picture.getAttribute("src")).toContain("?v=");
    // A 16:9 Episode really does produce landscape images; a portrait box would show a tall slice of one.
    expect(picture).toHaveAttribute("data-aspect", "16:9");
  });

  it("still shows the picture after the Episode has moved past image review", async () => {
    // The backend deliberately put no status gate on /content. If the screen adds one anyway, the review screen
    // stops showing the thing under review the moment the Episode advances — the exact failure being fixed.
    const advanced = episode("waiting_for_video_confirmation");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: advanced }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: advanced, reviews: reviews([1, 2, 3, 4, 5, 6]), staleness: { imageStale: [] } })));

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={2} onBack={() => {}} />);

    expect(await screen.findByTestId("episode-image-review-picture-1")).toBeTruthy();
  });

  it("falls back to the default shape when the settings request fails, rather than losing the picture", async () => {
    // Shape is a nicety; the picture is the point. A settings endpoint that does not answer must not be able to
    // put the reviewer back in front of nothing.
    const reviewEpisode = episode("images_review");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode, reviews: reviews(), staleness: { imageStale: [] } })));

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={2} onBack={() => {}} />);

    const picture = await screen.findByTestId("episode-image-review-picture-1");
    expect(picture).toHaveAttribute("data-aspect", "9:16");
  });

  // While the images were being made this screen said "대기 중" for every scene and offered no button — the
  // same picture as "nothing has started". Five of six were already bought at that point. A person who cannot
  // tell those apart presses generate again, and that is another $0.60.
  it("says the scenes are being made while they are being made", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: withScript(episode("generating_images")) }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) }))
      .mockResolvedValue(jsonResponse(200, { episode: withScript(episode("generating_images")) })));

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    const scene = await screen.findByTestId("episode-image-scene-1");
    expect(scene).toHaveAttribute("data-status", "generating");
    expect(scene.textContent).toContain("만드는 중");
  });

  // The notice told people to approve a thing they had approved seconds earlier, while their money was being
  // spent — it was written as "status is exactly asset_mapping_approved", so starting generation brought it
  // back. A notice about a step has to know which side of it we are on.
  it("stops telling you to approve the mapping once generation has started", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: withScript(episode("generating_images")) }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) }))
      .mockResolvedValue(jsonResponse(200, { episode: withScript(episode("generating_images")) })));

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    await screen.findByTestId("episode-image-scene-1");
    expect(screen.queryByTestId("episode-image-not-eligible")).toBeNull();
  });

  it("still asks for the mapping approval when it genuinely has not happened", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode("planned") }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValue(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) })));

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    expect(await screen.findByTestId("episode-image-not-eligible")).toBeTruthy();
  });

  // The review block is the only place the pictures appeared, and it renders only at the review step — so
  // approving the last scene made all six vanish. The video step is exactly when "what did scene 3 look like"
  // gets asked, and the files are still on disk.
  it("keeps the pictures reachable after the review step is over", async () => {
    vi.stubGlobal("fetch", vi.fn()
      // sceneNumbers falls back to the script when no review is loaded, which is the case at this stage.
      .mockResolvedValueOnce(jsonResponse(200, { episode: { ...withScript(episode("images_review"), 3), status: "videos_review" } }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValue(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) })));

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    const gallery = await screen.findByTestId("episode-image-gallery");
    expect(gallery.querySelectorAll("img").length).toBeGreaterThan(0);
  });

  /**
   * An image that was paid for and no longer matches the scene it was made from. The Episode said nothing until
   * now, so the only way to find out was to look at six pictures and remember what the script used to say.
   *
   * The list never claims the rest are current: an image generated before the prompt was recorded has no record
   * and is simply absent, which is why the badge only ever appears on a scene the server named.
   */
  it("marks an image that is behind its scene, and leaves the others unmarked", async () => {
    const ready = withScript(episode("images_review"));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: ready }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }) }))
      .mockResolvedValue(jsonResponse(200, { episode: ready, reviews: reviews(), staleness: { imageStale: [3] } })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect(await screen.findByTestId("episode-image-stale-3")).toBeTruthy();
    expect(screen.queryByTestId("episode-image-stale-1")).toBeNull();
  });
});
