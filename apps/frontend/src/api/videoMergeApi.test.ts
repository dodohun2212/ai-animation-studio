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

  /**
   * Two "already" refusals that send the reader to different places, which is why the backend keeps them apart.
   * Already rendered is undone by tidying this project's video; already published is not — re-merging would
   * make the file on disk stop being the file the post was made from, silently. The way past it is a new card.
   */
  it("does not send a published card back to the re-merge advice meant for an unpublished one", () => {
    const published = toVideoMergeDisplayError(new VideoMergeApiError("VIDEO_MERGE_ALREADY_PUBLISHED", "raw"));
    expect(published.code).toBe("VIDEO_MERGE_ALREADY_PUBLISHED");
    expect(published.message).toContain("카드를 새로 만들어");
    expect(published.message).not.toContain("지금 영상을 정리해");
    expect(published.message).not.toContain("raw");
  });

  /**
   * 🔴 759 — 연결 짝. 조립기가 맞는 것과 **이 화면이 그걸 부르는 것**은 다른 사실입니다. 호출을 빼면
   * 이 짝만 빨개지고 에피소드 쪽은 초록입니다(그쪽도 자기 짝이 따로 있습니다).
   */
  it("names the step and the scene the render stopped at, through the shared composer", () => {
    const displayed = toVideoMergeDisplayError(
      new VideoMergeApiError("VIDEO_MERGE_FAILED", "C:\\raw\\ffmpeg\\path", { stage: "scene", sceneNumber: 4 }),
    );

    expect(displayed.code).toBe("VIDEO_MERGE_FAILED");
    expect(displayed.message).toContain("4번 장면 클립");
    expect(displayed.message).toContain("승인된 장면 영상은 그대로 보존됩니다");
    // 서버의 원문 — 여기서는 파일 경로 — 은 여전히 화면에 못 옵니다.
    expect(displayed.message).not.toContain("raw");
  });

  it("names which clips stopped the merge instead of sending someone through every scene", () => {
    const displayed = toVideoMergeDisplayError(
      new VideoMergeApiError("VIDEO_MERGE_CLIPS_INVALID", "raw", { sceneNumbers: [7, 4] }),
    );

    expect(displayed.message).toContain("4·7번 장면 영상을 확인할 수 없습니다");
    expect(displayed.message).not.toContain("raw");
  });

  /**
   * 🔴 CLI Round 778 — ffprobe 는 있는데 ffmpeg 만 없을 수 있습니다. 그건 렌더가 시작도 못 한 것이라
   * **어느 단계도 답이 아닙니다.** 여기에 단계 문장이 붙으면 멀쩡한 클립을 고치러 갑니다.
   */
  it("never names a step for a merge program that is not installed", () => {
    const displayed = toVideoMergeDisplayError(
      new VideoMergeApiError("FFMPEG_UNAVAILABLE", "raw", { stage: "scene", sceneNumber: 4 }),
    );

    expect(displayed.message).toContain("설치 상태를 확인해 주세요");
    expect(displayed.message).not.toContain("단계");
    expect(displayed.message).not.toContain("4번");
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
