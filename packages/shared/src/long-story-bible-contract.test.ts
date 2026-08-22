import { describe, expect, it } from "vitest";
import { API_ROUTES, type LongStoryBible, type LongStoryBibleItem } from "./api.js";

describe("long Story Bible shared contract", () => {
  it("keeps five collection names and encodes route IDs", () => {
    const item: LongStoryBibleItem = { id: "CHAR-1", name: "Mina", alive: true, ownedItemIds: ["PROP-1"] };
    const bible: LongStoryBible = { basic: {}, world: {}, characters: [item], locations: [], props: [], secrets: [], foreshadowing: [], updatedAt: "2026-08-23T00:00:00.000Z" };
    expect(bible.characters[0]?.ownedItemIds).toEqual(["PROP-1"]);
    expect(API_ROUTES.longProjectStoryBible("a b")).toBe("/long-projects/a%20b/story-bible");
    expect(API_ROUTES.longProjectStoryBibleItem("project", "characters", "CHAR/1")).toBe("/long-projects/project/story-bible/characters/CHAR%2F1");
  });
});
