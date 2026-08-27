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
  sceneErrorMessage,
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

  it("tells someone out of Runway credits to top up, instead of blaming the request format", async () => {
    // Runway answers "not enough credits" with a 400, so this used to arrive as `invalid_request` and the
    // screen said 요청 형식이 지원되지 않습니다 — sending a person to look for a bug in the app when the fix
    // was in their own account. The backend now splits this out; this is the message it lands on.
    expect(sceneErrorMessage("quota_or_permission")).toContain("크레딧");
    expect(sceneErrorMessage("quota_or_permission")).not.toContain("요청 형식");
    // A genuine format problem still says so, and an unknown code still falls back rather than leaking.
    expect(sceneErrorMessage("invalid_request")).toContain("요청 형식");
    expect(sceneErrorMessage("You do not have enough credits to run this task.")).toBe(
      sceneErrorMessage(undefined),
    );
  });

  it("says an interrupted submission may already have been accepted, rather than reading as a transient glitch", async () => {
    // The backend stops here on purpose: the request went out, its outcome was never confirmed, and retrying
    // for the user could create a second billed task for one scene. The message has to carry that, or someone
    // reads "failed" and presses again — which is exactly the double charge the backend just refused to make.
    const message = sceneErrorMessage("submit_interrupted");
    expect(message).toContain("이미 접수");
    expect(message).toContain("자동으로 다시 보내지 않았");
    expect(message).not.toBe(sceneErrorMessage(undefined));
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

  it("attaches a trimmed one-off direction to either regeneration endpoint, and omits it when blank", async () => {
    const response: RegenerateVideoResponse = {
      ...makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] }),
      regeneratedSceneNumbers: [3],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    await regenerateVideoScene("sample_project", "job_1", 3, "  카메라를 더 천천히  ");
    await regenerateAllVideoScenes("sample_project", "job_1", "배경을 더 밝게");
    // Whitespace-only input must not become an empty string on the wire: the contract treats a missing field
    // and an empty one differently, and a blank box means "no direction at all".
    await regenerateVideoScene("sample_project", "job_1", 3, "   ");
    await regenerateAllVideoScenes("sample_project", "job_1", undefined);

    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(bodies).toEqual([
      { approved: true, additionalInstruction: "카메라를 더 천천히" },
      { approved: true, additionalInstruction: "배경을 더 밝게" },
      { approved: true },
      { approved: true },
    ]);
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
    "PROJECT_LOCKED",
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

  // The whole point of this code. The generic fallback tells the reader to press the button again, and
  // pressing it again is the double submission the lock exists to prevent — the one that charged $3.00 twice
  // (`.claude-bridge` Round 152/181). A message here that says "retry" would be worse than no message.
  it("tells the reader not to press again when another window holds the project", () => {
    const displayed = toVideoWorkflowDisplayError(new VideoWorkflowApiError("PROJECT_LOCKED", "raw"));

    expect(displayed.code).toBe("PROJECT_LOCKED");
    expect(displayed.message).toContain("다시 누르지 마세요");
    expect(displayed.message).not.toContain("다시 시도");
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
