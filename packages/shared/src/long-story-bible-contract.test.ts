import { describe, expect, it } from "vitest";
import { API_ROUTES, type LongEpisodeImageReview, type LongStoryBible, type LongStoryBibleItem, type StartLongEpisodeImageGenerationRequest } from "./api.js";

describe("long Story Bible shared contract", () => {
  it("keeps the two collections that reach the prompt, and encodes route IDs", () => {
    // Characters, locations and props are gone with the screen that edited them: their text never reached
    // buildEpisodeContext and nothing else read it. A secret is the opposite — its words are the item, and
    // revealAvailableEpisode is what keeps Episode 8's twist out of Episode 3.
    const item: LongStoryBibleItem = { id: "SECRET-1", name: "출생의 비밀", description: "이배드는 시장의 아들", revealAvailableEpisode: 4 };
    const bible: LongStoryBible = { basic: {}, world: {}, secrets: [item], foreshadowing: [], updatedAt: "2026-08-23T00:00:00.000Z" };
    expect(bible.secrets[0]?.revealAvailableEpisode).toBe(4);
    expect(API_ROUTES.longProjectStoryBible("a b")).toBe("/long-projects/a%20b/story-bible");
    expect(API_ROUTES.longProjectStoryBibleItem("project", "secrets", "SECRET/1")).toBe("/long-projects/project/story-bible/secrets/SECRET%2F1");
  });

  it("keeps long Episode image generation and review explicitly approved and scoped", () => {
    const request: StartLongEpisodeImageGenerationRequest = { approved: true };
    const review: LongEpisodeImageReview = { sceneNumber: 6, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" };
    expect(request.approved).toBe(true);
    expect(review.sceneNumber).toBe(6);
    expect(API_ROUTES.longEpisodeImageGeneration("a b", 2)).toBe("/long-projects/a%20b/episodes/2/images/generations");
    expect(API_ROUTES.longEpisodeImageReviewApproval("project", 2, 6)).toBe("/long-projects/project/episodes/2/images/review/6/approve");
  });
});
