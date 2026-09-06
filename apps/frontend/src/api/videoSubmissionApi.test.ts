import type { StartVideoGenerationRequest, StartVideoGenerationResponse } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { startVideoSubmission, toVideoSubmissionDisplayError, VideoSubmissionApiError } from "./videoSubmissionApi.js";
import { jsonResponse, nonJsonResponse } from "./testUtils.js";

function makeRequest(overrides: Partial<StartVideoGenerationRequest> = {}): StartVideoGenerationRequest {
  return {
    confirmationId: "confirmation_1",
    userRequestId: "request_1",
    approved: true,
    prompts: [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({
      sceneNumber: sceneNumber as StartVideoGenerationRequest["prompts"][number]["sceneNumber"],
      prompt: `Scene ${sceneNumber} edited prompt`,
    })),
    ...overrides,
  };
}

describe("videoSubmissionApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the exact submission contract via POST /projects/:id/videos/generations", async () => {
    const request = makeRequest();
    const response: StartVideoGenerationResponse = { jobId: "job_1", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await startVideoSubmission("sample_project", request)).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/videos/generations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      confirmationId: "confirmation_1",
      userRequestId: "request_1",
      approved: true,
      prompts: request.prompts,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("only calls fetch when explicitly invoked — never as a side effect of import", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a response with fewer than six accepted scene numbers for a project with fewer scenes", async () => {
    const response = { jobId: "job_1", acceptedSceneNumbers: [1, 2, 3, 4] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await expect(startVideoSubmission("sample_project", makeRequest())).resolves.toEqual(response);
  });

  it("rejects a response with a gap in the accepted scene sequence as malformed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { jobId: "job_1", acceptedSceneNumbers: [1, 2, 4, 5] })));

    await expect(startVideoSubmission("sample_project", makeRequest())).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("accepts scene numbers beyond the old fixed six, up to the supported maximum of twelve", async () => {
    const response = { jobId: "job_1", acceptedSceneNumbers: Array.from({ length: 10 }, (_, index) => index + 1) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await expect(startVideoSubmission("sample_project", makeRequest())).resolves.toEqual(response);
  });

  it("rejects a response with out-of-order accepted scene numbers as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { jobId: "job_1", acceptedSceneNumbers: [2, 1, 3, 4, 5, 6] })),
    );

    await expect(startVideoSubmission("sample_project", makeRequest())).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("maps a non-JSON error body to the safe malformed-response error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(400)));

    await expect(startVideoSubmission("sample_project", makeRequest())).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
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

    await expect(startVideoSubmission("sample_project", makeRequest())).rejects.toMatchObject({ code: "CLIENT_SERVER_UNAVAILABLE" });
  });

  it("maps a network failure to a safe network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(startVideoSubmission("sample_project", makeRequest())).rejects.toMatchObject({ code: "CLIENT_NETWORK_ERROR" });
  });

  it.each([
    ["VIDEO_CONFIRMATION_STALE"],
    ["VIDEO_REQUEST_ID_CONFLICT"],
    ["VIDEO_BUDGET_EXCEEDED"],
    ["VIDEO_CALL_LIMIT_EXCEEDED"],
    ["VIDEO_SUBMISSION_NOT_ALLOWED"],
    ["INVALID_REQUEST"],
    ["PROJECT_NOT_FOUND"],
  ])("never surfaces the backend's raw message for %s — only a fixed, safe message", async (code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code, message: "raw backend detail" })));

    let caught: unknown;
    try {
      await startVideoSubmission("sample_project", makeRequest());
    } catch (error) {
      caught = error;
    }
    const displayError = toVideoSubmissionDisplayError(caught);
    expect(displayError.code).toBe(code);
    expect(displayError.message).not.toContain("raw backend detail");
  });

  it("falls back to a generic unknown error for an unrecognized code", () => {
    const displayError = toVideoSubmissionDisplayError(new VideoSubmissionApiError("SOMETHING_NEW", "raw"));
    expect(displayError.code).toBe("CLIENT_UNKNOWN_ERROR");
  });

  it("never touches Runway, OpenAI, or FFmpeg surfaces", async () => {
    const fsPromises = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const srcRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)));
    const content = await fsPromises.readFile(path.join(srcRoot, "videoSubmissionApi.ts"), "utf8");
    for (const pattern of [/localStorage/, /sessionStorage/, /console\s*\./, /api\.openai\.com/, /runwayml\.com/, /\bffmpeg\b/i, /child_process/]) {
      expect(pattern.test(content)).toBe(false);
    }
  });
});
