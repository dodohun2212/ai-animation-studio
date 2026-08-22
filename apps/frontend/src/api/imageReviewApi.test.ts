import type { ApproveImageReviewResponse, GetImageReviewResponse } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { approveImageReview, getImageReview, ImageReviewApiError, toImageReviewDisplayError } from "./imageReviewApi.js";
import { jsonResponse, makeProject, nonJsonResponse } from "./testUtils.js";

describe("imageReviewApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches review status via GET /projects/:id/images/review", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview });
    const response: GetImageReviewResponse = {
      project,
      reviews: [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({
        sceneNumber: sceneNumber as GetImageReviewResponse["reviews"][number]["sceneNumber"],
        status: "pending",
        updatedAt: "2026-08-22T00:00:00.000Z",
      })),
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getImageReview("sample_project")).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("/projects/sample_project/images/review");
  });

  it("approves a single scene via POST /images/review/:sceneNumber/approve with { approved: true }", async () => {
    const project = makeProject({ workflowState: WorkflowState.ImagesReview });
    const response: ApproveImageReviewResponse = {
      project,
      reviews: [
        { sceneNumber: 1, status: "approved", updatedAt: "2026-08-22T00:00:00.000Z" },
        { sceneNumber: 2, status: "pending", updatedAt: "2026-08-22T00:00:00.000Z" },
        { sceneNumber: 3, status: "pending", updatedAt: "2026-08-22T00:00:00.000Z" },
        { sceneNumber: 4, status: "pending", updatedAt: "2026-08-22T00:00:00.000Z" },
        { sceneNumber: 5, status: "pending", updatedAt: "2026-08-22T00:00:00.000Z" },
        { sceneNumber: 6, status: "pending", updatedAt: "2026-08-22T00:00:00.000Z" },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await approveImageReview("sample_project", 1)).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/images/review/1/approve");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });
  });

  it("rejects with a malformed-response error when the body is missing required fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project: makeProject() })));

    await expect(getImageReview("sample_project")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("maps a non-JSON error body to the safe malformed-response error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(500)));

    await expect(getImageReview("sample_project")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("never surfaces the backend's raw error message — only a fixed, safe message per known code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { code: "IMAGE_REVIEW_NOT_ALLOWED", message: "raw backend detail" })),
    );

    let caught: unknown;
    try {
      await getImageReview("sample_project");
    } catch (error) {
      caught = error;
    }
    const displayError = toImageReviewDisplayError(caught);
    expect(displayError.code).toBe("IMAGE_REVIEW_NOT_ALLOWED");
    expect(displayError.message).not.toContain("raw backend detail");
  });

  it("falls back to a generic unknown error for an unrecognized code", () => {
    const displayError = toImageReviewDisplayError(new ImageReviewApiError("SOMETHING_NEW", "raw"));
    expect(displayError.code).toBe("CLIENT_UNKNOWN_ERROR");
  });

  it("maps a network failure to a safe network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(getImageReview("sample_project")).rejects.toMatchObject({ code: "CLIENT_NETWORK_ERROR" });
  });
});
