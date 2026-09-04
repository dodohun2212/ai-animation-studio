import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeLongProjectSettings } from "../api/testUtils.js";
import { IMAGE_ESTIMATED_COST_USD } from "@ai-animation-studio/shared";
import { LongEpisodeImageGenerationScreen } from "./LongEpisodeImageGenerationScreen.js";

const episode = (status: "planned" | "asset_mapping_approved" | "generating_images" | "images_ready" | "images_review" | "waiting_for_video_confirmation" | "completed") => ({
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
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      // Opening the confirmation asks the server what a press would actually buy — the screen cannot work that
      // out from the review list, which is not fetched at this stage.
      .mockResolvedValueOnce(jsonResponse(200, { preview: { sceneNumbers: [1, 2, 3, 4, 5, 6], generatableSceneNumbers: [1, 2, 3, 4, 5, 6], reusableSceneNumbers: [], estimatedCostUsd: 6 * IMAGE_ESTIMATED_COST_USD } }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageReviewEpisode, generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageReviewEpisode, reviews: reviews(), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    expect(await screen.findByTestId("episode-image-cost-notice")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "이미지 생성 시작" }));
    expect(await screen.findByTestId("episode-image-generate-confirm")).toBeTruthy();
    // Named, not counted: opening a confirmation may fetch a price, and "nothing was generated" is the
    // fact this line means either way.
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/images/generations") && (init as RequestInit | undefined)?.method === "POST")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "이미지 생성" }));
    await screen.findByTestId("episode-image-generation-summary");
    expect(fetchMock.mock.calls[4]?.[0]).toBe("/long-projects/long/episodes/1/images/generations");
    expect(JSON.parse(String((fetchMock.mock.calls[4]?.[1] as RequestInit).body))).toEqual({ approved: true });
    await screen.findByTestId("episode-image-review-1");
  });

  it("loads persisted review, explicitly approves one scene, then confirms only that scene regeneration", async () => {
    const reviewEpisode = episode("images_review");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: true } }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode, reviews: reviews(), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode, reviews: reviews([1]), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode, reviews: reviews(), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [], sceneNumber: 2 }));
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

  it("takes an approval back on the second press, and puts it back on the third", async () => {
    const reviewEpisode = episode("images_review");
    const ok = (approved: number[]) => jsonResponse(200, { episode: reviewEpisode, reviews: reviews(approved), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: true } }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([1]))   // approve
      .mockResolvedValueOnce(ok([]))    // unapprove
      .mockResolvedValueOnce(ok([1]));  // approve again
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const button = () => screen.getByTestId("episode-image-approval-1");
    expect(await screen.findByTestId("episode-image-review-1")).toHaveAttribute("data-status", "pending");

    fireEvent.click(button());
    await waitFor(() => expect(screen.getByTestId("episode-image-review-1")).toHaveAttribute("data-status", "approved"));
    expect(fetchMock.mock.calls[4]?.[0]).toBe("/long-projects/long/episodes/1/images/review/1/approve");
    expect(JSON.parse(String((fetchMock.mock.calls[4]?.[1] as RequestInit).body))).toEqual({ approved: true });

    // The button that reports the state is the button that changes it — same shape as the Asset Mapping toggle.
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByTestId("episode-image-review-1")).toHaveAttribute("data-status", "pending"));
    expect(fetchMock.mock.calls[5]?.[0]).toBe("/long-projects/long/episodes/1/images/review/1/unapprove");
    // `{ approved: false }`, never an omitted key: undo must not be one dropped field away from confirm.
    expect(JSON.parse(String((fetchMock.mock.calls[5]?.[1] as RequestInit).body))).toEqual({ approved: false });

    fireEvent.click(button());
    await waitFor(() => expect(screen.getByTestId("episode-image-review-1")).toHaveAttribute("data-status", "approved"));
    expect(fetchMock.mock.calls[6]?.[0]).toBe("/long-projects/long/episodes/1/images/review/1/approve");
  });

  it("shows the refusal instead of hiding the button when a take-back is not allowed", async () => {
    const reviewEpisode = episode("images_review");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: true } }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode, reviews: reviews([1]), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] }))
      .mockResolvedValueOnce(jsonResponse(409, { code: "LONG_EPISODE_IMAGES_NOT_ALLOWED", message: "internal detail never shown" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect(await screen.findByTestId("episode-image-review-1")).toHaveAttribute("data-status", "approved");
    fireEvent.click(screen.getByTestId("episode-image-approval-1"));

    // A refused take-back must not read as a successful one, and the row must stay approved.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    await waitFor(() => expect(screen.getByTestId("episode-image-approval-1")).toBeTruthy());
    expect(screen.getByTestId("episode-image-review-1")).toHaveAttribute("data-status", "approved");
  });

  it("shows the separate video-confirmation transition and does not expose internal image paths", async () => {
    const done = episode("waiting_for_video_confirmation");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: done }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: false } }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: done, reviews: reviews([1, 2, 3, 4, 5, 6]), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] })));
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
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      // Opening the confirmation asks the server what a press would actually buy — the screen cannot work that
      // out from the review list, which is not fetched at this stage.
      .mockResolvedValueOnce(jsonResponse(200, { preview: { sceneNumbers: [1, 2, 3, 4, 5, 6], generatableSceneNumbers: [1, 2, 3, 4, 5, 6], reusableSceneNumbers: [], estimatedCostUsd: 6 * IMAGE_ESTIMATED_COST_USD } }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          episode: imageReviewEpisode,
          generatedSceneNumbers: [1, 2, 3, 4, 5, 6],
          reusedSceneNumbers: [],
          budget: { monthlyLimitUsd: 10, spentUsd: 0.6, remainingUsd: 9.4, estimatedRequestCostUsd: 0.6, canSpend: true },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageReviewEpisode, reviews: reviews(), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "이미지 생성 시작" }));

    // 6 scenes x $0.10, shown before the request goes out.
    expect(screen.getByTestId("episode-image-cost-estimate").textContent).toContain("$0.60");
    // Named, not counted: opening a confirmation may fetch a price, and "nothing was generated" is the
    // fact this line means either way.
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/images/generations") && (init as RequestInit | undefined)?.method === "POST")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "이미지 생성" }));
    const budget = await screen.findByTestId("episode-image-generation-budget");
    expect(budget.textContent).toContain("$9.40");
  });

  it("omits the budget line when the response reported none (local fake mode charges nothing)", async () => {
    const imageReviewEpisode = episode("images_review");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode("asset_mapping_approved") }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      // Opening the confirmation asks the server what a press would actually buy — the screen cannot work that
      // out from the review list, which is not fetched at this stage.
      .mockResolvedValueOnce(jsonResponse(200, { preview: { sceneNumbers: [1, 2, 3, 4, 5, 6], generatableSceneNumbers: [1, 2, 3, 4, 5, 6], reusableSceneNumbers: [], estimatedCostUsd: 6 * IMAGE_ESTIMATED_COST_USD } }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageReviewEpisode, generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageReviewEpisode, reviews: reviews(), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] }));
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
      // What the server actually answers for Episode 1: `reference: null`, because there is no previous
      // Episode. The old fixture sent previousEpisodeNumber 0, which the response check rejects — so this test
      // was passing through the failure path and only looked right because the fallback rendered the same line.
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValue(jsonResponse(200, { episode: first, reviews: reviews(), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect((await screen.findByTestId("episode-image-continuity-unavailable")).textContent).toContain("첫 에피소드라");
  });

  /**
   * Episode 1 says the same thing whether the lookup answered or fell over.
   *
   * The new "could not check" banner is right for a later Episode: the question is open and a paid batch is
   * about to be pressed. On Episode 1 there is no previous Episode to have failed to ask about, so a failed
   * lookup changes nothing — showing doubt there invents it about a question that already has a definite answer.
   *
   * The 500 is the point of the test. The neighbouring Episode 1 case sends a valid response and so never
   * reaches this path at all, which is how the guard came to have no test the first time.
   */
  it("still explains the first Episode when the continuity lookup itself fails", async () => {
    const first = episode("asset_mapping_approved");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: first }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "LONG_PROJECT_STORAGE_ERROR", message: "unreadable" }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValue(jsonResponse(200, { episode: first, reviews: reviews(), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect((await screen.findByTestId("episode-image-continuity-unavailable")).textContent).toContain("첫 에피소드라");
    expect(screen.queryByTestId("episode-image-continuity-unknown")).toBeNull();
  });

  it("explains what happens instead when a later Episode has no continuity reference", async () => {
    const later = { ...episode("asset_mapping_approved"), episodeNumber: 2 };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: later }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: false } }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValue(jsonResponse(200, { episode: later, reviews: reviews(), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={2} onBack={() => {}} />);

    const notice = await screen.findByTestId("episode-image-continuity-unavailable");
    expect(notice.textContent).toContain("이어받지 않고");
    expect(notice.textContent).not.toContain("첫 에피소드라");
  });

  /**
   * The one this pair could not tell apart. Both tests above hand the screen a real answer — `available: false`
   * — and the screen was reading a failed read as the same thing, because both arrived as `null`.
   *
   * A 500 here is not "the previous Episode has nothing". It is "we did not find out", and the difference is
   * six paid pictures: a person told the material is missing generates without continuity on purpose, while a
   * person told the check failed can retry first. Asserting the negative as well as the positive, because a
   * screen that simply stopped saying anything would also stop saying the wrong thing — and would leave the
   * question invisible instead.
   */
  it("does not report a failed continuity check as the previous Episode having nothing", async () => {
    const later = { ...episode("asset_mapping_approved"), episodeNumber: 4 };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: later }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "LONG_PROJECT_STORAGE_ERROR", message: "raw backend detail" }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValue(jsonResponse(200, { episode: later, reviews: reviews(), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={4} onBack={() => {}} />);

    const notice = await screen.findByTestId("episode-image-continuity-unknown");
    expect(notice.textContent).toContain("확인하지 못했습니다");
    expect(notice.textContent).not.toContain("raw backend detail");
    expect(screen.queryByTestId("episode-image-continuity-unavailable")).toBeNull();
  });

  it("draws the scene list from the server's review list, not a six it made up itself", async () => {
    // Four reviews means four scenes on screen and four in the price — the count is reported, never assumed.
    const fourReviews = [1, 2, 3, 4].map((sceneNumber) => ({ sceneNumber, status: "pending" as const, updatedAt: "2026-08-23T00:00:00.000Z" }));
    const ready = episode("images_review");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: ready }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValue(jsonResponse(200, { episode: ready, reviews: fourReviews, staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] })));
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
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValue(jsonResponse(200, { episode: withScript, reviews: [], staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] })));
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
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValue(jsonResponse(200, { episode: ready, reviews: reviews(), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] })));
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
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "16:9" }), aspectRatioChangeable: true }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode, reviews: reviews(), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] })));

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
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: advanced, reviews: reviews([1, 2, 3, 4, 5, 6]), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] })));

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={2} onBack={() => {}} />);

    expect(await screen.findByTestId("episode-image-review-picture-1")).toBeTruthy();
  });

  /**
   * A regenerated picture used to keep showing the old one until the Episode changed *stage*, because the
   * cache-buster was the Episode's status — the coarsest thing on the screen. The per-scene `updatedAt` moves
   * when that scene's own picture does, which is the only moment the browser needs to fetch again.
   *
   * This could not be done before the listing was readable outside `images_review`: there was no per-scene
   * timestamp to use. The server fix is what let the screen stop using the wrong value.
   */
  it("busts the picture cache per scene, not per Episode stage", async () => {
    // Past review entirely: this is the gallery someone opens to ask "what did scene 3 look like".
    const advanced = episode("completed");
    const perScene = reviews().map((review) => (review.sceneNumber === 3
      ? { ...review, updatedAt: "2026-08-29T11:22:33.000Z" }
      : review));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: advanced }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: advanced, reviews: perScene, staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] })));

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={2} onBack={() => {}} />);

    // The gallery, not the review card: this is the one that was busting on the Episode's status.
    const gallery = await screen.findByTestId("episode-image-gallery");
    const third = within(gallery).getByAltText("3번 장면 이미지");
    expect(third.getAttribute("src")).toContain("2026-08-29T11%3A22%3A33.000Z");
    // The scene that did not change keeps its own timestamp — one regeneration must not refetch all six.
    expect(within(gallery).getByAltText("1번 장면 이미지").getAttribute("src")).toContain("2026-08-23T00%3A00%3A00.000Z");
  });

  it("falls back to the default shape when the settings request fails, rather than losing the picture", async () => {
    // Shape is a nicety; the picture is the point. A settings endpoint that does not answer must not be able to
    // put the reviewer back in front of nothing.
    const reviewEpisode = episode("images_review");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode, reviews: reviews(), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] })));

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
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
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
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValue(jsonResponse(200, { episode: withScript(episode("generating_images")) })));

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    await screen.findByTestId("episode-image-scene-1");
    expect(screen.queryByTestId("episode-image-not-eligible")).toBeNull();
  });

  it("still asks for the mapping approval when it genuinely has not happened", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode("planned") }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValue(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true })));

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
      .mockResolvedValue(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true })));

    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    const gallery = await screen.findByTestId("episode-image-gallery");
    expect(gallery.querySelectorAll("img").length).toBeGreaterThan(0);
  });

  /**
   * The Episode's narration regenerate already took a one-off direction; the image did not. Same screen, same
   * paid button, and the voice could be told what to change while the picture could not.
   *
   * Sent only when something was typed: whitespace is absent to the server, and an empty string would be a
   * third spelling of "no direction" travelling over the wire.
   */
  it("sends a one-off direction with an image regeneration, and omits it when blank", async () => {
    const ready = withScript(episode("images_review"));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: ready }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValue(jsonResponse(200, { episode: ready, reviews: reviews(), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [], sceneNumber: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    await screen.findByTestId("episode-image-review-1");
    fireEvent.click(screen.getAllByRole("button", { name: "다시 만들기" })[0]!);
    fireEvent.change(await screen.findByTestId("episode-image-regenerate-instruction-1"), { target: { value: "  더 어둡게  " } });
    fireEvent.click(screen.getByRole("button", { name: "이 장면 다시 만들기" }));

    await waitFor(() => {
      const post = (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>)
        .find(([url, init]) => String(url).endsWith("/images/review/1/regenerate") && init?.method === "POST");
      expect(post).toBeTruthy();
      // Trimmed, not sent raw — the same value with padding must not read as a different direction.
      expect(JSON.parse(String(post![1]!.body))).toEqual({ approved: true, additionalInstruction: "더 어둡게" });
    });
  });

  /**
   * The panel quoted every scene at full price while the response it gets back reports which ones were reused —
   * the screen said one number and the receipt said another, always overstating. A review row exists only for a
   * scene that has a picture, so the list is the honest count.
   */
  /**
   * The confirmation quoted the scene count while the generation skips anything already drawn and charges
   * nothing for it — always too high, and always in the direction that stops people doing work they can afford.
   *
   * The numbers come from the server's preflight, not from the review list: the list is not fetched at this
   * stage, which is exactly the stage a partly-failed run leaves an Episode in. Counting it here would read
   * "nothing made yet" precisely when four were.
   */
  it("quotes only the scenes it would actually buy, and says the rest are kept", async () => {
    const ready = withScript(episode("asset_mapping_approved"));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: ready }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      // Four of six already drawn: the two missing ones are what a press would cost.
      .mockResolvedValueOnce(jsonResponse(200, { preview: {
        sceneNumbers: [1, 2, 3, 4, 5, 6],
        generatableSceneNumbers: [5, 6],
        reusableSceneNumbers: [1, 2, 3, 4],
        estimatedCostUsd: 2 * IMAGE_ESTIMATED_COST_USD,
      } })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "이미지 생성 시작" }));

    expect((await screen.findByTestId("episode-image-reuse-notice")).textContent).toContain("4장");
    // Two scenes, not six — the number the receipt will agree with.
    expect(screen.getByTestId("episode-image-cost-estimate").textContent).toContain("2장 ×");
    expect(screen.getByTestId("episode-image-cost-estimate").textContent).toContain(`$${(2 * IMAGE_ESTIMATED_COST_USD).toFixed(2)}`);
  });

  /**
   * The two lists mean different things and arrive from different actions — editing the script versus editing
   * the Story Bible or the mapping — so a screen that showed one badge for both would be unable to say which
   * happened. Telling someone their text changed when it did not sends them to re-read a scene that is fine.
   */
  it("separates a picture behind its script from one behind its references", async () => {
    const reviewEpisode = episode("images_review");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValue(jsonResponse(200, {
        episode: reviewEpisode, reviews: reviews(),
        staleness: { imageStale: [1], referenceStale: [2] },
        storyBibleLinkDrift: [],
      })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect((await screen.findByTestId("episode-image-stale-1")).textContent).toContain("내용 바뀜");
    expect(screen.queryByTestId("episode-reference-stale-1")).toBeNull();
    // Scene 2's words did not change, so it must not be told they did.
    const reference = screen.getByTestId("episode-reference-stale-2");
    expect(reference.textContent).toContain("참고 이미지 바뀜");
    expect(reference.textContent).not.toContain("내용 바뀜");
    expect(screen.queryByTestId("episode-image-stale-2")).toBeNull();
  });

  /**
   * The Episode that already bought pictures keeps the mapping they were made from, so nothing about it
   * changes when the Story Bible does — `referenceStale` is silent there by construction. This is the only
   * thing that can say the Episode was drawn with a different person than the story now has.
   *
   * A statement of difference, not of error: the pictures are correct for what they were made from, and
   * whether to spend money redrawing is the person's decision.
   */
  it("says which protagonist the Episode was drawn with, without telling anyone to fix it", async () => {
    const reviewEpisode = episode("images_review");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValue(jsonResponse(200, {
        episode: reviewEpisode, reviews: reviews(),
        staleness: { imageStale: [], referenceStale: [] },
        storyBibleLinkDrift: [{
          link: "protagonist",
          storyBibleAssetId: "FOLDER-MINJAE", storyBibleAssetName: "민재",
          episodeAssetId: "FOLDER-IBAD", episodeAssetName: "이배드",
        }],
      })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const drift = await screen.findByTestId("episode-drift-protagonist");
    expect(drift.textContent).toContain("이배드");
    expect(drift.textContent).toContain("민재");
    // Both names come from the response, so the sentence costs no second request.
    expect(drift.textContent).toContain("주인공");
  });

  it("falls back to the id when an Asset behind a drift is gone", async () => {
    const reviewEpisode = episode("images_review");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValue(jsonResponse(200, {
        episode: reviewEpisode, reviews: reviews(),
        staleness: { imageStale: [], referenceStale: [] },
        storyBibleLinkDrift: [{
          link: "style",
          storyBibleAssetId: "FOLDER-STYLE", storyBibleAssetName: "수채화",
          // Never mapped on this Episode's side — null by contract, and "연결 없음" is what that means to read.
          episodeAssetId: null, episodeAssetName: null,
        }],
      })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const drift = await screen.findByTestId("episode-drift-style");
    expect(drift.textContent).toContain("연결 없음");
    expect(drift.textContent).toContain("전체 그림체");
  });

  it("says nothing about the Story Bible when the Episode agrees with it", async () => {
    const reviewEpisode = episode("images_review");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: reviewEpisode }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValue(jsonResponse(200, {
        episode: reviewEpisode, reviews: reviews(),
        staleness: { imageStale: [], referenceStale: [] },
        storyBibleLinkDrift: [],
      })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    await screen.findByTestId("episode-image-review-1");
    expect(screen.queryByTestId("episode-story-bible-drift")).toBeNull();
  });

  /**
   * The short project has had this panel since its run became pollable; the Episode had only a list of scenes
   * reading 만드는 중. The sentence that matters is the last one — leaving is safe, pressing again is not —
   * and it was missing on the side where a second batch costs more.
   */
  it("says a run is in progress, and that leaving the screen does not stop it", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: withScript(episode("generating_images")) }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValue(jsonResponse(200, { episode: withScript(episode("generating_images")) })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const progress = await screen.findByTestId("episode-generation-progress");
    expect(progress.textContent).toContain("이 화면을 벗어나거나");
    expect(progress.textContent).toContain("다시 누르면");
    // Found, not started here: the screen does not know when it began, so it does not put a number on it.
    expect(screen.getByTestId("episode-generation-progress-resumed")).toBeTruthy();
    expect(progress.textContent).not.toContain("초째 진행 중");
  });

  /**
   * The case the panel was written for and never covered: a run this screen starts.
   *
   * `startLongEpisodeImageGeneration` does not answer until all six images exist — minutes with a real key —
   * and the status the server writes before its loop is only reachable by asking again. Gating the panel on the
   * status the screen already held meant it stayed hidden for exactly the stretch it exists to cover. Every
   * existing test found a run already in progress, so all of them passed while a person watched six rows read
   * 대기 중 through a $0.60 batch.
   */
  it("says a run is in progress from the moment it starts one, before any answer comes back", async () => {
    const ready = withScript(episode("asset_mapping_approved"));
    let finish: (value: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: ready }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValueOnce(jsonResponse(200, { preview: { sceneNumbers: [1, 2, 3, 4, 5, 6], generatableSceneNumbers: [1, 2, 3, 4, 5, 6], reusableSceneNumbers: [], estimatedCostUsd: 6 * IMAGE_ESTIMATED_COST_USD } }))
      // The generation POST, left hanging exactly as the real one hangs.
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "이미지 생성 시작" }));
    fireEvent.click(await screen.findByRole("button", { name: "이미지 생성" }));

    const progress = await screen.findByTestId("episode-generation-progress");
    expect(progress.textContent).toContain("이 화면을 벗어나거나");
    expect(progress.textContent).toContain("다시 누르면");
    // Started here, so the clock is honest — and this is the half that says so.
    expect(progress.textContent).toContain("초째 진행 중");
    expect(screen.queryByTestId("episode-generation-progress-resumed")).toBeNull();
    // No row may read 대기 중 while the batch is being bought.
    expect(screen.getByTestId("episode-image-scene-1")).toHaveAttribute("data-status", "generating");

    finish(jsonResponse(200, { episode: withScript(episode("images_review")), generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [] }));
  });

  /**
   * What the panel could not say until the Episode published progress: how far along it is, and which scene the
   * money is on right now.
   *
   * Six scenes take minutes and every row read 만드는 중 for all of it, so one picture done and five done
   * looked the same. A screen where nothing moves during a $0.60 batch is what makes a person press again — the
   * same reasoning the batch-level panel was written from, carried one level down.
   */
  it("says how many scenes are done and which one is being drawn", async () => {
    const running = withScript(episode("generating_images"));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/images/generations/progress")) {
        return jsonResponse(200, { episode: running, progress: { sceneNumbers: [1, 2, 3, 4, 5, 6], completedSceneNumbers: [1, 2], currentSceneNumber: 3 } });
      }
      if (url.endsWith("/continuity-reference")) return jsonResponse(200, { reference: null });
      if (url.endsWith("/settings")) return jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true });
      return jsonResponse(200, { episode: running });
    }));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    await screen.findByTestId("episode-generation-progress");
    const count = await screen.findByTestId("episode-generation-progress-count", undefined, { timeout: 5000 });
    expect(count.textContent).toContain("6장 중");
    expect(count.textContent).toContain("2장");
    expect(count.textContent).toContain("3번 장면");
    // Three different true things, where there used to be one repeated six times.
    expect(screen.getByTestId("episode-image-scene-1")).toHaveAttribute("data-status", "done");
    expect(screen.getByTestId("episode-image-scene-3")).toHaveAttribute("data-status", "generating");
    expect(screen.getByTestId("episode-image-scene-5")).toHaveAttribute("data-status", "waiting");
  });

  /**
   * A poll that never answered is not a poll that answered "nothing has started".
   *
   * Silence has to leave the rows saying the thing that is still true — the batch is running — rather than
   * demoting five of them to 대기 중 on no evidence, which reads as a stalled run and is the reading that costs
   * a second batch. The count block simply does not appear: a number nobody gave us is not a number.
   */
  it("keeps the batch-level answer when the progress read fails", async () => {
    const running = withScript(episode("generating_images"));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/images/generations/progress")) return jsonResponse(500, { code: "LONG_PROJECT_STORAGE_ERROR", message: "raw backend detail" });
      if (url.endsWith("/continuity-reference")) return jsonResponse(200, { reference: null });
      if (url.endsWith("/settings")) return jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true });
      return jsonResponse(200, { episode: running });
    }));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    await screen.findByTestId("episode-generation-progress");
    expect(screen.getByTestId("episode-image-scene-1")).toHaveAttribute("data-status", "generating");
    expect(screen.getByTestId("episode-image-scene-5")).toHaveAttribute("data-status", "generating");
    expect(screen.queryByTestId("episode-generation-progress-count")).toBeNull();
  });

  it("shows no progress panel when the Episode is not generating", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: withScript(episode("asset_mapping_approved")) }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValue(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    await screen.findByTestId("episode-image-cost-notice");
    expect(screen.queryByTestId("episode-generation-progress")).toBeNull();
  });

  /**
   * The list used to be fetched only while the Episode was in review, because the server refused it otherwise.
   * It does not any more — the pictures were never gone, only the list of them.
   */
  it("still lists the images after the Episode has moved past review", async () => {
    const later = withScript(episode("waiting_for_video_confirmation"));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: later }))
      .mockResolvedValueOnce(jsonResponse(200, { reference: null }))
      .mockResolvedValueOnce(jsonResponse(200, { settings: makeLongProjectSettings({ aspectRatio: "9:16" }), aspectRatioChangeable: true }))
      .mockResolvedValue(jsonResponse(200, { episode: later, reviews: reviews(), staleness: { imageStale: [], referenceStale: [] }, storyBibleLinkDrift: [] })));
    render(<LongEpisodeImageGenerationScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    // The list is what was refused before, and it is what the gallery and the badges are built on.
    expect(await screen.findByTestId("episode-image-review-1")).toBeTruthy();
  });
});
