import type { MergeVideosResponse } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mergeVideos, toVideoMergeDisplayError, VideoMergeApiError } from "./videoMergeApi.js";
import { jsonResponse, makeProject, nonJsonResponse } from "./testUtils.js";

function makeResponse(overrides: Partial<MergeVideosResponse> = {}): MergeVideosResponse {
  return {
    project: makeProject(),
    finalVideoPath: "videos/final/instagram_reel.mp4",
    ...overrides,
  };
}

describe("videoMergeApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the exact merge request via POST /projects/:id/videos/merge with no body", async () => {
    const response = makeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await mergeVideos("sample_project")).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/videos/merge");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("only calls fetch when explicitly invoked — never as a side effect of import", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a response with a final path other than the fixed relative marker as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, makeResponse({ finalVideoPath: "C:/Users/someone/videos/final/instagram_reel.mp4" as MergeVideosResponse["finalVideoPath"] }))),
    );

    await expect(mergeVideos("sample_project")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a response missing the project as malformed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { finalVideoPath: "videos/final/instagram_reel.mp4" })));

    await expect(mergeVideos("sample_project")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("maps a non-JSON error body to the safe malformed-response error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(400)));

    await expect(mergeVideos("sample_project")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  /**
   * The status is what separates the two. A 4xx whose body cannot be read is something answering badly; a 5xx
   * that carries no error shape at all is nothing answering — the backend is down, restarting, or something in
   * front of it replied.
   * 🔴 On 2026-09-05 the backend died for thirteen minutes and this path said "서버 응답을 확인할 수 없습니다",
   * which blames the response for a server that was not running and sends the person looking in the wrong place.
   */
  it("reports a 5xx with no error shape as the server not answering, not as a bad answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(500)));

    await expect(mergeVideos("sample_project")).rejects.toMatchObject({ code: "CLIENT_SERVER_UNAVAILABLE" });
  });

  it("maps a network failure to a safe network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(mergeVideos("sample_project")).rejects.toMatchObject({ code: "CLIENT_NETWORK_ERROR" });
  });

  it.each([
    ["VIDEO_MERGE_NOT_ALLOWED"],
    ["VIDEO_MERGE_CLIPS_INVALID"],
    ["FFMPEG_UNAVAILABLE"],
    ["VIDEO_MERGE_FAILED"],
    ["VIDEO_STORAGE_ERROR"],
    ["INVALID_REQUEST"],
    ["PROJECT_NOT_FOUND"],
  ])("never surfaces the backend's raw message for %s — only a fixed, safe message with no filesystem path", async (code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { code, message: "raw backend detail C:/Users/someone/project" })),
    );

    let caught: unknown;
    try {
      await mergeVideos("sample_project");
    } catch (error) {
      caught = error;
    }
    const displayError = toVideoMergeDisplayError(caught);
    expect(displayError.code).toBe(code);
    expect(displayError.message).not.toContain("raw backend detail");
    expect(displayError.message).not.toContain("C:/Users");
  });

  it("falls back to a generic unknown error for an unrecognized code", () => {
    const displayError = toVideoMergeDisplayError(new VideoMergeApiError("SOMETHING_NEW", "raw"));
    expect(displayError.code).toBe("CLIENT_UNKNOWN_ERROR");
  });

  it("never touches Runway, OpenAI, FFmpeg, or client-side storage surfaces", async () => {
    const fsPromises = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const srcRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)));
    const content = await fsPromises.readFile(path.join(srcRoot, "videoMergeApi.ts"), "utf8");
    for (const pattern of [
      /localStorage/,
      /sessionStorage/,
      /indexedDB/i,
      /console\s*\./,
      /api\.openai\.com/,
      /runwayml\.com/,
      /\bffmpeg\b/i,
      /child_process/,
      /\bspawn\s*\(/,
    ]) {
      expect(pattern.test(content)).toBe(false);
    }
  });
});
