import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "./testUtils.js";
import {
  getVideoLibrary,
  getVideoVersions,
  restoreVideoVersion,
  toVideoLibraryDisplayError,
  VideoLibraryApiError,
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
      // 🔴 This stub said `VIDEO_RESTORE_NOT_ALLOWED`, a code this backend has never thrown, so the test proved
      // the mapping worked for a name nothing sends — and went on passing while the real refusal fell through
      // to the catch-all. A stub is an assertion about the server too, and this one was wrong.
      vi.fn().mockResolvedValue(jsonResponse(409, { code: "VIDEO_LIBRARY_RESTORE_NOT_ALLOWED", message: "raw backend detail" })),
    );

    const caught = await restoreVideoVersion("1", 1, "v001").catch((error: unknown) => error);
    const display = toVideoLibraryDisplayError(caught);

    expect(display.code).toBe("VIDEO_LIBRARY_RESTORE_NOT_ALLOWED");
    expect(display.message).not.toContain("raw backend detail");
  });

  it("reports a network failure as its own code rather than as a server answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const caught = await getVideoLibrary().catch((error: unknown) => error);
    expect(toVideoLibraryDisplayError(caught).code).toBe("CLIENT_NETWORK_ERROR");
  });

  /**
   * 🔴 These two rows were keyed `VIDEO_VERSION_NOT_FOUND` and `VIDEO_RESTORE_NOT_ALLOWED`, which this backend
   * has never thrown — its library codes all carry the `VIDEO_LIBRARY_` prefix, and it cannot drop it without
   * colliding with `LONG_EPISODE_VIDEO_*`. So both refusals fell through to the catch-all's "잠시 후 다시 시도",
   * which is wrong twice: a version that does not exist will not appear on a retry, and a state that forbids
   * restoring does not change by waiting. The sentences were already right; nothing could reach them.
   */
  it("names the library's own codes, prefix and all, so its refusals reach their sentences", () => {
    const missing = toVideoLibraryDisplayError(new VideoLibraryApiError("VIDEO_LIBRARY_VERSION_NOT_FOUND", "raw"));
    expect(missing.message).toContain("이 버전을 찾을 수 없습니다");
    const forbidden = toVideoLibraryDisplayError(new VideoLibraryApiError("VIDEO_LIBRARY_RESTORE_NOT_ALLOWED", "raw"));
    expect(forbidden.message).toContain("되돌릴 수 없습니다");
    // A row exists and its file does not: reloading cannot bring a deleted file back, so it must not say retry.
    const gone = toVideoLibraryDisplayError(new VideoLibraryApiError("VIDEO_LIBRARY_CONTENT_UNAVAILABLE", "raw"));
    expect(gone.message).toContain("파일이 없습니다");
    expect(gone.message).not.toContain("다시 시도");
    // The unprefixed names are nobody's: leaving them behind would keep a dead row looking alive.
    expect(toVideoLibraryDisplayError(new VideoLibraryApiError("VIDEO_VERSION_NOT_FOUND", "raw")).code).toBe("CLIENT_UNKNOWN_ERROR");
  });

  it("builds a playback URL without fetching anything", () => {
    expect(videoVersionContentUrl("1", "final", "v003")).toBe("/projects/1/videos/final/versions/v003/content");
  });
});
