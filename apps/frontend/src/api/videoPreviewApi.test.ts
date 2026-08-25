import type { GetVideoPromptPreviewResponse, VideoPromptPreview } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getVideoPromptPreview, toVideoPreviewDisplayError, VideoPreviewApiError } from "./videoPreviewApi.js";
import { jsonResponse, nonJsonResponse } from "./testUtils.js";

function makePreviews(count = 6): VideoPromptPreview[] {
  return Array.from({ length: count }, (_, index) => index + 1).map((sceneNumber) => ({
    sceneNumber: sceneNumber as VideoPromptPreview["sceneNumber"],
    prompt: `Scene ${sceneNumber} prompt`,
    model: "gen4_turbo",
    ratio: "720:1280",
    durationSeconds: 5,
    estimatedCostUsd: 0.25,
  }));
}

describe("videoPreviewApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the preview via explicit POST /projects/:id/videos/preview", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getVideoPromptPreview("sample_project")).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/videos/preview");
    expect(init.method).toBe("POST");
    // No provider or generation route was ever touched by the preview fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("only calls fetch when explicitly invoked — never as a side effect of import", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns exactly six previews covering scenes 1 through 6 with the total cost derivable from each entry", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, response)));

    const result = await getVideoPromptPreview("sample_project");
    expect(result.previews).toHaveLength(6);
    expect(result.previews.map((preview) => preview.sceneNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    const totalCostUsd = result.previews.reduce((sum, preview) => sum + preview.estimatedCostUsd, 0);
    expect(totalCostUsd).toBeCloseTo(1.5, 5);
  });

  it("accepts a response with fewer than six previews for a project with fewer scenes", async () => {
    const response = { previews: makePreviews(4) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await expect(getVideoPromptPreview("sample_project")).resolves.toEqual(response);
  });

  it("rejects a response with a gap in the scene sequence as malformed", async () => {
    const gapped = makePreviews().filter((preview) => preview.sceneNumber !== 3);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { previews: gapped })));

    await expect(getVideoPromptPreview("sample_project")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("accepts scene numbers beyond the old fixed six, up to the supported maximum of twelve", async () => {
    const response = { previews: makePreviews(10) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await expect(getVideoPromptPreview("sample_project")).resolves.toEqual(response);
  });

  it("rejects a response whose scenes are out of order as malformed", async () => {
    const previews = makePreviews();
    const reordered = [previews[1]!, previews[0]!, ...previews.slice(2)];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { previews: reordered })));

    await expect(getVideoPromptPreview("sample_project")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a preview entry with an invalid model as malformed", async () => {
    const previews = makePreviews();
    previews[0] = { ...previews[0]!, model: "gen4_turbo" as never };
    (previews[0] as unknown as { model: string }).model = "other_model";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { previews })));

    await expect(getVideoPromptPreview("sample_project")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("maps a non-JSON error body to the safe malformed-response error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(500)));

    await expect(getVideoPromptPreview("sample_project")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("maps a network failure to a safe network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(getVideoPromptPreview("sample_project")).rejects.toMatchObject({ code: "CLIENT_NETWORK_ERROR" });
  });

  it("never surfaces the backend's raw error message — only a fixed, safe message per known code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { code: "VIDEO_PREVIEW_NOT_ALLOWED", message: "raw backend detail" })),
    );

    let caught: unknown;
    try {
      await getVideoPromptPreview("sample_project");
    } catch (error) {
      caught = error;
    }
    const displayError = toVideoPreviewDisplayError(caught);
    expect(displayError.code).toBe("VIDEO_PREVIEW_NOT_ALLOWED");
    expect(displayError.message).not.toContain("raw backend detail");
  });

  it("maps VIDEO_PREVIEW_IMAGES_INVALID and VIDEO_PREVIEW_DATA_INVALID to safe, fixed messages", async () => {
    for (const code of ["VIDEO_PREVIEW_IMAGES_INVALID", "VIDEO_PREVIEW_DATA_INVALID"]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code, message: "raw backend detail" })));
      let caught: unknown;
      try {
        await getVideoPromptPreview("sample_project");
      } catch (error) {
        caught = error;
      }
      const displayError = toVideoPreviewDisplayError(caught);
      expect(displayError.code).toBe(code);
      expect(displayError.message).not.toContain("raw backend detail");
      vi.unstubAllGlobals();
    }
  });

  it("falls back to a generic unknown error for an unrecognized code", () => {
    const displayError = toVideoPreviewDisplayError(new VideoPreviewApiError("SOMETHING_NEW", "raw"));
    expect(displayError.code).toBe("CLIENT_UNKNOWN_ERROR");
  });
});
