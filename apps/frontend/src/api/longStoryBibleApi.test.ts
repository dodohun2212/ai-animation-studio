import { describe, expect, it, vi, afterEach } from "vitest";

import { jsonResponse } from "./testUtils.js";
import { createLongStoryBibleItem, deleteLongStoryBibleItem, duplicateLongStoryBibleItem, getLongProjectStoryBible, searchLongStoryBibleItems, toLongStoryBibleDisplayError, updateLongStoryBibleContent, updateLongStoryBibleItem, updateLongStoryBibleStyleAssetLink } from "./longStoryBibleApi.js";

const bible = { basic: {}, world: {}, secrets: [{ id: "SECRET-1", name: "출생의 비밀" }], foreshadowing: [], updatedAt: "2026-08-23T00:00:00.000Z" };

describe("long Story Bible API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses only shared Story Bible routes for get, create, update, and delete", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: bible }))
      .mockResolvedValueOnce(jsonResponse(201, { item: bible.secrets[0], storyBible: bible }))
      .mockResolvedValueOnce(jsonResponse(200, { item: bible.secrets[0], storyBible: bible }))
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: bible }));
    vi.stubGlobal("fetch", fetchMock);

    await getLongProjectStoryBible("long id");
    await createLongStoryBibleItem("long id", "secrets", { item: { id: "SECRET-1", name: "출생의 비밀" } });
    await updateLongStoryBibleItem("long id", "secrets", "SECRET/1", { item: { name: "고친 이름" } });
    await deleteLongStoryBibleItem("long id", "secrets", "SECRET/1");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/long-projects/long%20id/story-bible");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/long-projects/long%20id/story-bible/secrets");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/long-projects/long%20id/story-bible/secrets/SECRET%2F1");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/long-projects/long%20id/story-bible/secrets/SECRET%2F1");
  });

  it("rejects malformed responses and never displays a raw backend message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code: "STORY_BIBLE_ITEM_ALREADY_EXISTS", message: "raw internal detail" })));
    await expect(createLongStoryBibleItem("p", "secrets", { item: { name: "출생의 비밀" } })).rejects.toMatchObject({ code: "STORY_BIBLE_ITEM_ALREADY_EXISTS" });
    const displayed = toLongStoryBibleDisplayError({});
    expect(displayed.message).not.toContain("raw internal detail");
    expect(displayed.code).toBe("CLIENT_UNKNOWN_ERROR");
  });

  it("uses guarded shared routes for explicit searches and local duplicates", async () => {
    const duplicated = { ...bible.secrets[0], id: "SECRET-2", name: "복사본" };
    const duplicatedBible = { ...bible, characters: [...bible.secrets, duplicated] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { items: bible.secrets }))
      .mockResolvedValueOnce(jsonResponse(201, { item: duplicated, storyBible: duplicatedBible }));
    vi.stubGlobal("fetch", fetchMock);

    await searchLongStoryBibleItems("long id", "secrets", "Mina & co");
    await duplicateLongStoryBibleItem("long id", "secrets", "SECRET/1");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/long-projects/long%20id/story-bible/secrets/search?query=Mina%20%26%20co");
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/long-projects/long%20id/story-bible/secrets/SECRET%2F1/duplicate");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });

  it("uses guarded content and global style link routes", async () => {
    const styledBible = { ...bible, styleAssetLink: { assetId: "STYLE-1", versionPolicy: "snapshot" as const, pinnedVersion: 3 } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: bible }))
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: styledBible }));
    vi.stubGlobal("fetch", fetchMock);

    await updateLongStoryBibleContent("long id", { basic: { title: "Revised" }, world: { era: "future" } });
    await updateLongStoryBibleStyleAssetLink("long id", { assetLink: styledBible.styleAssetLink });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/long-projects/long%20id/story-bible/content");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ basic: { title: "Revised" }, world: { era: "future" } });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/long-projects/long%20id/story-bible/style-asset-link");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ assetLink: styledBible.styleAssetLink });
  });
});
