import type {
  ApproveVideoReviewResponse,
  GenerationProgressResponse,
  GetVideoReviewResponse,
  RegenerateVideoResponse,
} from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  approveVideoReview,
  getVideoProgress,
  getVideoReview,
  regenerateAllVideoScenes,
  regenerateVideoScene,
  restartVideoGeneration,
  stopVideoGeneration,
  toVideoWorkflowDisplayError,
  VideoWorkflowApiError,
} from "./videoWorkflowApi.js";
import { jsonResponse, makeProject, nonJsonResponse } from "./testUtils.js";

function sixReviews(approved: readonly number[] = []): GetVideoReviewResponse["reviews"] {
  return [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({
    sceneNumber: sceneNumber as GetVideoReviewResponse["reviews"][number]["sceneNumber"],
    status: approved.includes(sceneNumber) ? "approved" : "pending",
    updatedAt: "2026-08-23T00:00:00.000Z",
  }));
}

function makeProgress(overrides: Partial<GenerationProgressResponse> = {}): GenerationProgressResponse {
  return {
    jobId: "job_1",
    status: "running",
    completedSceneNumbers: [1, 2],
    failedSceneNumbers: [],
    sceneNumbers: [1, 2, 3, 4, 5, 6],
    ...overrides,
  };
}

describe("videoWorkflowApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches progress via GET /projects/:id/videos/generations/:jobId", async () => {
    const response = makeProgress({ currentSceneNumber: 3 });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getVideoProgress("sample_project", "job_1")).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("/projects/sample_project/videos/generations/job_1");
  });

  it("stops via POST /projects/:id/videos/generations/:jobId/stop with no body", async () => {
    const response = makeProgress({ status: "interrupted", completedSceneNumbers: [1] });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await stopVideoGeneration("sample_project", "job_1")).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/videos/generations/job_1/stop");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("restarts via POST /projects/:id/videos/generations/:jobId/restart with no body", async () => {
    const response = makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await restartVideoGeneration("sample_project", "job_1")).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/videos/generations/job_1/restart");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("regenerates one scene via POST .../scenes/:sceneNumber/regenerate with { approved: true }", async () => {
    const response: RegenerateVideoResponse = {
      ...makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] }),
      regeneratedSceneNumbers: [3],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await regenerateVideoScene("sample_project", "job_1", 3)).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/videos/generations/job_1/scenes/3/regenerate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });
  });

  it("regenerates all scenes via POST .../regenerate-all with { approved: true }", async () => {
    const response: RegenerateVideoResponse = {
      ...makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] }),
      regeneratedSceneNumbers: [1, 2, 3, 4, 5, 6],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await regenerateAllVideoScenes("sample_project", "job_1")).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/videos/generations/job_1/regenerate-all");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });
  });

  it("fetches review status via GET /projects/:id/videos/generations/:jobId/review", async () => {
    const response: GetVideoReviewResponse = { project: makeProject({ workflowState: WorkflowState.ReviewingVideos }), reviews: sixReviews() };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getVideoReview("sample_project", "job_1")).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("/projects/sample_project/videos/generations/job_1/review");
  });

  it("approves a single scene via POST .../review/:sceneNumber/approve with { approved: true }", async () => {
    const response: ApproveVideoReviewResponse = {
      project: makeProject({ workflowState: WorkflowState.ReviewingVideos }),
      reviews: sixReviews([2]),
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await approveVideoReview("sample_project", "job_1", 2)).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/videos/generations/job_1/review/2/approve");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });
  });

  it("accepts a review response with fewer than six reviews for a project with fewer scenes", async () => {
    const response = { project: makeProject(), reviews: sixReviews().slice(0, 4) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, response)));

    expect(await getVideoReview("sample_project", "job_1")).toEqual(response);
  });

  it("rejects a review response with a gap in the scene sequence as malformed", async () => {
    const response = { project: makeProject(), reviews: sixReviews().filter((review) => review.sceneNumber !== 3) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await expect(getVideoReview("sample_project", "job_1")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a progress response missing the job's scene numbers as malformed", async () => {
    const { sceneNumbers: _omit, ...withoutSceneNumbers } = makeProgress();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, withoutSceneNumbers)));

    await expect(getVideoProgress("sample_project", "job_1")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("accepts scene numbers beyond the old fixed six, up to the supported maximum of twelve", async () => {
    const tenScenes = Array.from({ length: 10 }, (_, index) => index + 1);
    const response = makeProgress({ status: "running", completedSceneNumbers: tenScenes.slice(0, 9), currentSceneNumber: 10, sceneNumbers: tenScenes });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, response)));

    expect(await getVideoProgress("sample_project", "job_1")).toEqual(response);
  });

  it("rejects a progress response with an unknown status as malformed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { ...makeProgress(), status: "unknown" })));

    await expect(getVideoProgress("sample_project", "job_1")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("maps a non-JSON error body to the safe malformed-response error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(500)));

    await expect(getVideoProgress("sample_project", "job_1")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("maps a network failure to a safe network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(getVideoProgress("sample_project", "job_1")).rejects.toMatchObject({ code: "CLIENT_NETWORK_ERROR" });
  });

  it.each([
    "INVALID_REQUEST",
    "PROJECT_NOT_FOUND",
    "VIDEO_JOB_NOT_FOUND",
    "VIDEO_WORKFLOW_NOT_ALLOWED",
    "VIDEO_REVIEW_DATA_INVALID",
    "VIDEO_STORAGE_ERROR",
  ])("never surfaces the backend's raw message for %s — only a fixed, safe message", async (code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code, message: "raw backend detail" })));

    let caught: unknown;
    try {
      await getVideoProgress("sample_project", "job_1");
    } catch (error) {
      caught = error;
    }
    const displayError = toVideoWorkflowDisplayError(caught);
    expect(displayError.code).toBe(code);
    expect(displayError.message).not.toContain("raw backend detail");
  });

  it("falls back to a generic unknown error for an unrecognized code", () => {
    const displayError = toVideoWorkflowDisplayError(new VideoWorkflowApiError("SOMETHING_NEW", "raw"));
    expect(displayError.code).toBe("CLIENT_UNKNOWN_ERROR");
  });

  it("never touches Runway, OpenAI, FFmpeg, or client-side storage surfaces", async () => {
    const fsPromises = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const srcRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)));
    const content = await fsPromises.readFile(path.join(srcRoot, "videoWorkflowApi.ts"), "utf8");
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
