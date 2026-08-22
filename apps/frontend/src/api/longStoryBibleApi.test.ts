import { describe, expect, it, vi, afterEach } from "vitest";

import { jsonResponse } from "./testUtils.js";
import { createLongStoryBibleItem, deleteLongStoryBibleItem, getLongProjectStoryBible, toLongStoryBibleDisplayError, updateLongStoryBibleItem } from "./longStoryBibleApi.js";

const bible = { basic: {}, world: {}, characters: [{ id: "CHAR-1", name: "Mina" }], locations: [], props: [], secrets: [], foreshadowing: [], updatedAt: "2026-08-23T00:00:00.000Z" };

describe("long Story Bible API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses only shared Story Bible routes for get, create, update, and delete", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: bible }))
      .mockResolvedValueOnce(jsonResponse(201, { item: bible.characters[0], storyBible: bible }))
      .mockResolvedValueOnce(jsonResponse(200, { item: bible.characters[0], storyBible: bible }))
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: bible }));
    vi.stubGlobal("fetch", fetchMock);

    await getLongProjectStoryBible("long id");
    await createLongStoryBibleItem("long id", "characters", { item: { id: "CHAR-1", name: "Mina" } });
    await updateLongStoryBibleItem("long id", "characters", "CHAR/1", { item: { name: "Mina revised" } });
    await deleteLongStoryBibleItem("long id", "characters", "CHAR/1");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/long-projects/long%20id/story-bible");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/long-projects/long%20id/story-bible/characters");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/long-projects/long%20id/story-bible/characters/CHAR%2F1");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/long-projects/long%20id/story-bible/characters/CHAR%2F1");
  });

  it("rejects malformed responses and never displays a raw backend message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code: "STORY_BIBLE_ITEM_ALREADY_EXISTS", message: "raw internal detail" })));
    await expect(createLongStoryBibleItem("p", "characters", { item: { name: "Mina" } })).rejects.toMatchObject({ code: "STORY_BIBLE_ITEM_ALREADY_EXISTS" });
    const displayed = toLongStoryBibleDisplayError({});
    expect(displayed.message).not.toContain("raw internal detail");
    expect(displayed.code).toBe("CLIENT_UNKNOWN_ERROR");
  });
});
