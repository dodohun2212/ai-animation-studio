import { describe, expect, it } from "vitest";
import { API_ROUTES, type LongEpisodeImageReview, type LongStoryBible, type LongStoryBibleItem, type StartLongEpisodeImageGenerationRequest } from "./api.js";

describe("long Story Bible shared contract", () => {
  it("keeps five collection names and encodes route IDs", () => {
    const item: LongStoryBibleItem = { id: "CHAR-1", name: "Mina", alive: true, ownedItemIds: ["PROP-1"], assetLink: { assetId: "ASSET-CHAR-1", versionPolicy: "pinned_version", pinnedVersion: 2, episodeScope: { mode: "episode", episode: 1 } } };
    const bible: LongStoryBible = { basic: {}, world: {}, characters: [item], locations: [], props: [], secrets: [], foreshadowing: [], updatedAt: "2026-08-23T00:00:00.000Z" };
    expect(bible.characters[0]?.ownedItemIds).toEqual(["PROP-1"]);
    expect(bible.characters[0]?.assetLink?.episodeScope).toEqual({ mode: "episode", episode: 1 });
    expect(API_ROUTES.longProjectStoryBible("a b")).toBe("/long-projects/a%20b/story-bible");
    expect(API_ROUTES.longProjectStoryBibleItem("project", "characters", "CHAR/1")).toBe("/long-projects/project/story-bible/characters/CHAR%2F1");
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
