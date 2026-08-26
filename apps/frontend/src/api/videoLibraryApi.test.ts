import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "./testUtils.js";
import {
  getVideoLibrary,
  getVideoVersions,
  restoreVideoVersion,
  toVideoLibraryDisplayError,
  videoVersionContentUrl,
} from "./videoLibraryApi.js";

function libraryProject(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "1",
    topic: "이배드의 탄생",
    updatedAt: "2026-08-26T17:29:37.982Z",
    sceneCount: 6,
    videosReadyCount: 6,
    finalVideoAvailable: true,
    totalActualCostUsd: 1.5,
    aspectRatio: "9:16",
    ...overrides,
  };
}

function version(overrides: Record<string, unknown> = {}) {
  return { versionId: "v001", createdAt: "2026-08-26T17:18:30.000Z", bytes: 2103543, isCurrent: false, ...overrides };
}

describe("videoLibraryApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists projects via GET /videos/library", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { projects: [libraryProject()] }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await getVideoLibrary();

    expect(fetchMock).toHaveBeenCalledWith("/videos/library", undefined);
    expect(response.projects[0]?.projectId).toBe("1");
  });

  // A cost is rendered as money. A card reading "$NaN" beside a real figure would make every other number on the
  // page unbelievable, so a malformed cost fails the whole response rather than reaching the screen.
  it("rejects a project row whose cost is not a usable number", async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, "1.50", null]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects: [libraryProject({ totalActualCostUsd: bad })] })));
      await expect(getVideoLibrary()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
    }
  });

  it("rejects an unknown aspect ratio rather than guessing a shape for the thumbnail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects: [libraryProject({ aspectRatio: "4:3" })] })));
    await expect(getVideoLibrary()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("lists versions for a scene and for the merged result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { versions: [version({ isCurrent: true })] }));
    vi.stubGlobal("fetch", fetchMock);

    await getVideoVersions("1", 2);
    expect(fetchMock).toHaveBeenCalledWith("/projects/1/videos/2/versions", undefined);

    await getVideoVersions("1", "final");
    expect(fetchMock).toHaveBeenCalledWith("/projects/1/videos/final/versions", undefined);
  });

  it("restores via POST with an explicit approval, and returns the updated project", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project: { id: "1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await restoreVideoVersion("1", 3, "v002");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/1/videos/3/versions/v002/restore");
    expect(init.method).toBe("POST");
    // The server refuses an unapproved body; sending it explicitly keeps this a deliberate action, not a side
    // effect of opening a screen.
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });
  });

  it("maps a known backend code to a fixed message and never leaks the raw one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { code: "VIDEO_RESTORE_NOT_ALLOWED", message: "raw backend detail" })),
    );

    const caught = await restoreVideoVersion("1", 1, "v001").catch((error: unknown) => error);
    const display = toVideoLibraryDisplayError(caught);

    expect(display.code).toBe("VIDEO_RESTORE_NOT_ALLOWED");
    expect(display.message).not.toContain("raw backend detail");
  });

  it("reports a network failure as its own code rather than as a server answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const caught = await getVideoLibrary().catch((error: unknown) => error);
    expect(toVideoLibraryDisplayError(caught).code).toBe("CLIENT_NETWORK_ERROR");
  });

  it("builds a playback URL without fetching anything", () => {
    expect(videoVersionContentUrl("1", "final", "v003")).toBe("/projects/1/videos/final/versions/v003/content");
  });
});
