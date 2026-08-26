import { afterEach, describe, expect, it, vi } from "vitest";

import { getPostDraft, putPostDraft, toPostDraftDisplayError } from "./postDraftApi.js";
import { jsonResponse } from "./testUtils.js";

describe("postDraftApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a draft via GET /projects/:id/post-draft", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { body: "본문", hashtags: "애니 단편", aiNotice: true }));
    vi.stubGlobal("fetch", fetchMock);

    const draft = await getPostDraft("p 1");

    expect(fetchMock).toHaveBeenCalledWith("/projects/p%201/post-draft", undefined);
    expect(draft.body).toBe("본문");
  });

  // Every field is optional, so a project that has never been drafted comes back empty rather than as an error.
  it("accepts an empty draft", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})));
    await expect(getPostDraft("p1")).resolves.toEqual({});
  });

  // A number where the caption body belongs would otherwise be rendered into the textarea and saved back as
  // that number's text.
  it("rejects a draft whose fields are the wrong type", async () => {
    for (const bad of [{ body: 5 }, { hashtags: ["a"] }, { aiNotice: "yes" }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, bad)));
      await expect(getPostDraft("p1")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
    }
  });

  // The endpoint replaces rather than merges, so an omitted field is a deleted field — every save sends all three.
  it("saves the whole draft via PUT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { body: "본문", hashtags: "태그", aiNotice: false }));
    vi.stubGlobal("fetch", fetchMock);

    await putPostDraft("p1", { body: "본문", hashtags: "태그", aiNotice: false });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/p1/post-draft");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ body: "본문", hashtags: "태그", aiNotice: false }));
  });

  it("maps a known backend code to a fixed message and never leaks the raw one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "raw backend detail" })));

    const caught = await putPostDraft("p1", { body: "x" }).catch((error: unknown) => error);
    const display = toPostDraftDisplayError(caught);

    expect(display.code).toBe("PROJECT_STORAGE_ERROR");
    expect(display.message).not.toContain("raw backend detail");
  });

  it("reports a network failure as its own code rather than as a server answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const caught = await getPostDraft("p1").catch((error: unknown) => error);
    expect(toPostDraftDisplayError(caught).code).toBe("CLIENT_NETWORK_ERROR");
  });
});
