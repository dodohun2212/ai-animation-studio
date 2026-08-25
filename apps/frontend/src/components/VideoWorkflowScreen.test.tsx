import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationProgressResponse, GetVideoReviewResponse, Scene, VideoReview } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { VideoWorkflowScreen } from "./VideoWorkflowScreen.js";

const PROGRESS_URL = "/projects/sample_project/videos/generations/job_1";
const REVIEW_URL = `${PROGRESS_URL}/review`;

function makeProgress(overrides: Partial<GenerationProgressResponse> = {}): GenerationProgressResponse {
  return {
    jobId: "job_1",
    status: "running",
    completedSceneNumbers: [],
    failedSceneNumbers: [],
    sceneNumbers: [1, 2, 3, 4, 5, 6],
    ...overrides,
  };
}

function sixReviews(approved: readonly number[] = []): VideoReview[] {
  return [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({
    sceneNumber: sceneNumber as VideoReview["sceneNumber"],
    status: approved.includes(sceneNumber) ? "approved" : "pending",
    updatedAt: "2026-08-23T00:00:00.000Z",
  }));
}

function reviewsFor(sceneCount: number, approved: readonly number[] = []): VideoReview[] {
  return Array.from({ length: sceneCount }, (_, index) => index + 1).map((sceneNumber) => ({
    sceneNumber: sceneNumber as VideoReview["sceneNumber"],
    status: approved.includes(sceneNumber) ? "approved" : "pending",
    updatedAt: "2026-08-23T00:00:00.000Z",
  }));
}

/** Scenes as the backend returns them alongside a review: each carries its source image and final motion prompt. */
function scenesFor(sceneCount: number): Scene[] {
  return Array.from({ length: sceneCount }, (_, index) => index + 1).map((number) => ({
    number,
    script: `Scene ${number} script`,
    imagePrompt: `Scene ${number} image prompt`,
    motionPrompt: `Scene ${number} motion prompt`,
    generatedImagePath: `images/scene${number}.png`,
    generatedVideoPath: `videos/runway/scene${number}.mp4`,
    imageReview: "approved",
    videoReview: "pending",
  }));
}

function reviewResponse(reviews: VideoReview[]): GetVideoReviewResponse {
  return {
    project: makeProject({ workflowState: WorkflowState.ReviewingVideos, scenes: scenesFor(reviews.length) }),
    reviews,
  };
}

function renderScreen(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return render(<VideoWorkflowScreen projectId="sample_project" jobId="job_1" onBack={() => {}} />);
}

describe("VideoWorkflowScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows a loading state, then loads sequential progress via GET .../videos/generations/:jobId", async () => {
    const progress = makeProgress({ status: "running", completedSceneNumbers: [1, 2], currentSceneNumber: 3 });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, progress));
    renderScreen(fetchMock);

    expect(screen.getByText("진행 상황을 불러오는 중...")).toBeTruthy();
    await screen.findByTestId("scene-progress-list");

    expect(fetchMock).toHaveBeenCalledWith(PROGRESS_URL);
    expect(screen.getByTestId("workflow-status").textContent).toBe("상태: 진행 중 · 현재 3번 장면");
    expect(screen.getByTestId("scene-progress-1")).toHaveAttribute("data-status", "completed");
    expect(screen.getByTestId("scene-progress-2")).toHaveAttribute("data-status", "completed");
    expect(screen.getByTestId("scene-progress-3")).toHaveAttribute("data-status", "running");
    expect(screen.getByTestId("scene-progress-4")).toHaveAttribute("data-status", "pending");
    expect(screen.getByTestId("no-provider-notice").textContent).toContain("실제 유료 Runway API와 영상 병합 프로그램을 호출하지 않습니다");
  });

  it("polls persisted progress while running and stops polling once the job reaches a terminal status", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, makeProgress({ status: "running", completedSceneNumbers: [1], currentSceneNumber: 2 })))
      .mockResolvedValueOnce(jsonResponse(200, makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] })))
      .mockResolvedValue(jsonResponse(200, reviewResponse(sixReviews())));
    vi.stubGlobal("fetch", fetchMock);
    render(<VideoWorkflowScreen projectId="sample_project" jobId="job_1" onBack={() => {}} />);

    await vi.waitFor(() => expect(screen.getByTestId("workflow-status").textContent).toContain("진행 중"));
    await vi.advanceTimersByTimeAsync(1000);

    await vi.waitFor(() => expect(screen.getByTestId("workflow-status").textContent).toBe("상태: 완료"));
    const progressCalls = fetchMock.mock.calls.filter(([url]) => url === PROGRESS_URL);
    expect(progressCalls).toHaveLength(2);

    // No further polling once terminal — advancing time again must not add another progress GET.
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock.mock.calls.filter(([url]) => url === PROGRESS_URL)).toHaveLength(2);
  });

  it("shows the interrupted notice, hides the stop button, and offers restart — completed scenes stay marked completed", async () => {
    const progress = makeProgress({ status: "interrupted", completedSceneNumbers: [1] });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, progress)));

    await screen.findByTestId("interrupted-notice");
    expect(screen.getByTestId("scene-progress-1")).toHaveAttribute("data-status", "completed");
    expect(screen.queryByTestId("stop-button")).toBeNull();
    expect(screen.getByTestId("restart-button")).toBeTruthy();
  });

  it("stops the job via POST .../stop — future scenes are blocked and completed scenes are preserved", async () => {
    const running = makeProgress({ status: "running", completedSceneNumbers: [1], currentSceneNumber: 2 });
    const interrupted = makeProgress({ status: "interrupted", completedSceneNumbers: [1] });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, running)).mockResolvedValueOnce(jsonResponse(200, interrupted));
    renderScreen(fetchMock);

    await screen.findByTestId("stop-button");
    fireEvent.click(screen.getByTestId("stop-button"));

    await screen.findByTestId("interrupted-notice");
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${PROGRESS_URL}/stop`);
    expect(init.method).toBe("POST");
    expect(screen.getByTestId("scene-progress-1")).toHaveAttribute("data-status", "completed");
    expect(screen.getByTestId("scene-progress-2")).toHaveAttribute("data-status", "pending");
    expect(screen.queryByTestId("stop-button")).toBeNull();
  });

  it("resumes a stopped job via POST .../restart, preserving already completed scenes", async () => {
    const interrupted = makeProgress({ status: "interrupted", completedSceneNumbers: [1] });
    const succeeded = makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, interrupted))
      .mockResolvedValueOnce(jsonResponse(200, succeeded))
      .mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews())));
    renderScreen(fetchMock);

    await screen.findByTestId("restart-button");
    fireEvent.click(screen.getByTestId("restart-button"));

    await waitFor(() => expect(screen.getByTestId("scene-progress-1")).toHaveAttribute("data-status", "completed"));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${PROGRESS_URL}/restart`);
    expect(init.method).toBe("POST");
  });

  it("loads and shows video review once the job succeeds, hiding the review section until then", async () => {
    const running = makeProgress({ status: "running", completedSceneNumbers: [1] });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, running)));
    await screen.findByTestId("scene-progress-list");
    expect(screen.queryByTestId("video-review-section")).toBeNull();
  });

  it("fetches reviews via GET .../review and lists all six scenes pending after success", async () => {
    const succeeded = makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, succeeded)).mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews())));
    renderScreen(fetchMock);

    await screen.findByTestId("video-review-1");
    expect(fetchMock).toHaveBeenCalledWith(REVIEW_URL);
    for (const number of [1, 2, 3, 4, 5, 6]) {
      expect(screen.getByTestId(`video-review-${number}`)).toHaveAttribute("data-status", "pending");
    }
  });

  it("shows each scene's actual generated clip, cache-busted by its review updatedAt", async () => {
    const succeeded = makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, succeeded)).mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews([1]))));
    renderScreen(fetchMock);

    const clip = await screen.findByTestId("video-review-clip-1");
    expect(clip).toHaveAttribute("src", "/projects/sample_project/videos/1/content?v=2026-08-23T00%3A00%3A00.000Z");
    expect(screen.getByTestId("video-review-clip-6")).toHaveAttribute("src", "/projects/sample_project/videos/6/content?v=2026-08-23T00%3A00%3A00.000Z");
  });

  it("shows each scene's source image and the final prompt it was generated from, beside the clip", async () => {
    const succeeded = makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, succeeded)).mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews())));
    renderScreen(fetchMock);

    await screen.findByTestId("video-review-1");
    expect(screen.getByTestId("video-review-source-image-1")).toHaveAttribute("src", "/projects/sample_project/images/1/content");
    expect(screen.getByTestId("video-review-source-image-6")).toHaveAttribute("src", "/projects/sample_project/images/6/content");
    expect(screen.getByTestId("video-review-prompt-3").textContent).toContain("Scene 3 motion prompt");
  });

  it("omits the source image for a scene that has none rather than rendering a broken one", async () => {
    const succeeded = makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    const withoutImage = reviewResponse(sixReviews());
    withoutImage.project.scenes = withoutImage.project.scenes.map((scene) =>
      scene.number === 2 ? { ...scene, generatedImagePath: undefined } : scene,
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, succeeded)).mockResolvedValueOnce(jsonResponse(200, withoutImage));
    renderScreen(fetchMock);

    await screen.findByTestId("video-review-1");
    expect(screen.getByTestId("video-review-source-image-1")).toBeTruthy();
    expect(screen.queryByTestId("video-review-source-image-2")).toBeNull();
    // The clip itself is still reviewable even without its source still.
    expect(screen.getByTestId("video-review-clip-2")).toBeTruthy();
  });

  it("approves a single scene via POST .../review/:sceneNumber/approve and preserves the others as pending", async () => {
    const succeeded = makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, succeeded))
      .mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews())))
      .mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews([2]))));
    renderScreen(fetchMock);

    const row = await screen.findByTestId("video-review-2");
    fireEvent.click(within(row).getByRole("button", { name: "이 영상으로 확정" }));

    await waitFor(() => expect(screen.getByTestId("video-review-2")).toHaveAttribute("data-status", "approved"));
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe(`${REVIEW_URL}/2/approve`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });
    for (const number of [1, 3, 4, 5, 6]) {
      expect(screen.getByTestId(`video-review-${number}`)).toHaveAttribute("data-status", "pending");
    }
  });

  it("shows the all-scenes-approved banner once every scene review is approved", async () => {
    const succeeded = makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, succeeded)).mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews([1, 2, 3, 4, 5, 6]))));
    renderScreen(fetchMock);

    const banner = await screen.findByTestId("all-scenes-approved");
    expect(banner.textContent).toContain("모두 승인되었습니다");
  });

  it("offers the final-merge entry point only once all six scenes are approved, and routes back to the caller with the project ID", async () => {
    const succeeded = makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, succeeded))
      .mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews([1, 2, 3, 4, 5]))));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<VideoWorkflowScreen projectId="sample_project" jobId="job_1" onBack={() => {}} />);

    await screen.findByTestId("video-review-list");
    expect(screen.queryByTestId("open-video-merge-button")).toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews([1, 2, 3, 4, 5, 6]))));
    const row = screen.getByTestId("video-review-6");
    fireEvent.click(within(row).getByRole("button", { name: "이 영상으로 확정" }));
    await screen.findByTestId("all-scenes-approved");

    const onOpenMerge = vi.fn();
    rerender(<VideoWorkflowScreen projectId="sample_project" jobId="job_1" onBack={() => {}} onOpenMerge={onOpenMerge} />);
    fireEvent.click(screen.getByTestId("open-video-merge-button"));

    expect(onOpenMerge).toHaveBeenCalledWith("sample_project");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/videos/merge"))).toBe(false);
  });

  it("does not call the regenerate endpoint on the first click — only an explicit per-scene confirmation does", async () => {
    const succeeded = makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, succeeded)).mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews())));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("video-review-regenerate-2"));
    const panel = await screen.findByTestId("video-regenerate-confirm-panel-2");
    expect(panel.textContent).toContain("실제 유료 요청은 전송되지 않습니다");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("regenerates a single scene via POST .../scenes/:sceneNumber/regenerate only after explicit confirmation, then refreshes reviews", async () => {
    const succeeded = makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    const regenerated = { ...succeeded, regeneratedSceneNumbers: [2] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, succeeded))
      .mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews([1, 2, 3, 4, 5, 6]))))
      .mockResolvedValueOnce(jsonResponse(200, regenerated))
      .mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews([1, 3, 4, 5, 6]))));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("video-review-regenerate-2"));
    const panel = await screen.findByTestId("video-regenerate-confirm-panel-2");
    fireEvent.click(within(panel).getByRole("button", { name: "예, 로컬로 재생성합니다" }));

    await waitFor(() => expect(screen.getByTestId("video-review-2")).toHaveAttribute("data-status", "pending"));
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe(`${PROGRESS_URL}/scenes/2/regenerate`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });
    for (const number of [1, 3, 4, 5, 6]) {
      expect(screen.getByTestId(`video-review-${number}`)).toHaveAttribute("data-status", "approved");
    }
  });

  it("shows a retry action for a scene Runway reported failed, and retries only after explicit confirmation", async () => {
    const failed = makeProgress({ status: "failed", completedSceneNumbers: [1], failedSceneNumbers: [2] });
    const retried = makeProgress({ status: "running", completedSceneNumbers: [1], currentSceneNumber: 2 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, failed))
      .mockResolvedValueOnce(jsonResponse(200, retried));
    renderScreen(fetchMock);

    await screen.findByTestId("failed-scenes-section");
    expect(screen.getByTestId("scene-progress-2")).toHaveAttribute("data-status", "failed");
    fireEvent.click(screen.getByTestId("failed-scene-retry-2"));
    const panel = await screen.findByTestId("failed-scene-retry-confirm-2");
    fireEvent.click(within(panel).getByRole("button", { name: "예, 다시 시도합니다" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${PROGRESS_URL}/scenes/2/regenerate`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });
  });

  it("shows an actionable Korean reason for a known scene failure category, and a safe generic fallback for an opaque one", async () => {
    const failed = makeProgress({
      status: "failed",
      completedSceneNumbers: [1],
      failedSceneNumbers: [2, 3],
      sceneErrors: { 2: "authentication", 3: "Runway rejected the prompt: explicit content detected" },
    });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, failed)));

    await screen.findByTestId("failed-scenes-section");
    expect(screen.getByTestId("failed-scene-reason-2").textContent).toContain("Runway API 키 인증에 실패했습니다");
    // An unrecognized code — including Runway's own raw failure text — must never be shown verbatim.
    const opaqueReason = screen.getByTestId("failed-scene-reason-3");
    expect(opaqueReason.textContent).not.toContain("Runway rejected the prompt");
    expect(opaqueReason.textContent).not.toContain("explicit content");
    expect(opaqueReason.textContent).toContain("영상 생성에 실패했습니다");
  });

  it("does not call the regenerate-all endpoint on the first click — only an explicit confirmation does", async () => {
    const succeeded = makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, succeeded)).mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews())));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("regenerate-all-button"));
    const panel = await screen.findByTestId("regenerate-all-confirm-panel");
    expect(panel.textContent).toContain("실제 유료 요청은 전송되지 않습니다");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("regenerates all six scenes via POST .../regenerate-all only after explicit confirmation", async () => {
    const succeeded = makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    const regenerated = { ...succeeded, regeneratedSceneNumbers: [1, 2, 3, 4, 5, 6] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, succeeded))
      .mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews([1, 2, 3, 4, 5, 6]))))
      .mockResolvedValueOnce(jsonResponse(200, regenerated))
      .mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews())));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("regenerate-all-button"));
    const panel = await screen.findByTestId("regenerate-all-confirm-panel");
    fireEvent.click(within(panel).getByRole("button", { name: "예, 로컬로 전체 재생성합니다" }));

    await waitFor(() => expect(screen.getByTestId("video-review-1")).toHaveAttribute("data-status", "pending"));
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe(`${PROGRESS_URL}/regenerate-all`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });
  });

  it("shows a safe error with a retry that reloads persisted progress instead of the raw backend message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, { code: "VIDEO_JOB_NOT_FOUND", message: "raw backend detail" }))
      .mockResolvedValueOnce(jsonResponse(200, makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] })))
      .mockResolvedValueOnce(jsonResponse(200, reviewResponse(sixReviews())));
    renderScreen(fetchMock);

    const alert = await screen.findByTestId("progress-error");
    expect(alert.textContent).not.toContain("raw backend detail");
    expect(alert).toHaveAttribute("data-error-code", "VIDEO_JOB_NOT_FOUND");

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByTestId("scene-progress-list");
    expect(fetchMock.mock.calls.filter(([url]) => url === PROGRESS_URL)).toHaveLength(2);
  });

  it("renders the job's actual scene count (not a fixed six) end to end for a four-scene project", async () => {
    const succeeded = makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4], sceneNumbers: [1, 2, 3, 4] });
    const regenerated = { ...succeeded, regeneratedSceneNumbers: [1, 2, 3, 4] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, succeeded))
      .mockResolvedValueOnce(jsonResponse(200, reviewResponse(reviewsFor(4))))
      .mockResolvedValueOnce(jsonResponse(200, regenerated))
      .mockResolvedValueOnce(jsonResponse(200, reviewResponse(reviewsFor(4))));
    renderScreen(fetchMock);

    await screen.findByTestId("scene-progress-4");
    expect(screen.queryByTestId("scene-progress-5")).toBeNull();
    expect(screen.queryByTestId("scene-progress-6")).toBeNull();

    await screen.findByTestId("video-review-4");
    expect(screen.queryByTestId("video-review-5")).toBeNull();

    fireEvent.click(screen.getByTestId("regenerate-all-button"));
    const panel = await screen.findByTestId("regenerate-all-confirm-panel");
    expect(panel.textContent).toContain("4개 장면 영상을 모두 다시 생성할까요?");
    fireEvent.click(within(panel).getByRole("button", { name: "예, 로컬로 전체 재생성합니다" }));

    await waitFor(() => expect(screen.getByTestId("video-review-1")).toHaveAttribute("data-status", "pending"));
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe(`${PROGRESS_URL}/regenerate-all`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });
  });

  it("shows the all-scenes-approved banner with the actual scene count for a four-scene project", async () => {
    const succeeded = makeProgress({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4], sceneNumbers: [1, 2, 3, 4] });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, succeeded)).mockResolvedValueOnce(jsonResponse(200, reviewResponse(reviewsFor(4, [1, 2, 3, 4]))));
    renderScreen(fetchMock);

    const banner = await screen.findByTestId("all-scenes-approved");
    expect(banner.textContent).toBe("4개 장면 영상이 모두 승인되었습니다.");
  });

  it("reloads the true persisted progress on remount instead of resetting to a blank state", async () => {
    const progress = makeProgress({ status: "interrupted", completedSceneNumbers: [1, 2, 3] });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, progress));
    const { unmount } = renderScreen(fetchMock);
    await screen.findByTestId("interrupted-notice");
    unmount();

    render(<VideoWorkflowScreen projectId="sample_project" jobId="job_1" onBack={() => {}} />);
    await screen.findByTestId("interrupted-notice");
    expect(screen.getByTestId("scene-progress-3")).toHaveAttribute("data-status", "completed");
    expect(screen.getByTestId("scene-progress-4")).toHaveAttribute("data-status", "pending");
  });
});

describe("VideoWorkflowScreen source", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("never touches Runway, OpenAI, FFmpeg, or client-side storage surfaces", async () => {
    const fsPromises = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const srcRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)));
    const content = await fsPromises.readFile(path.join(srcRoot, "VideoWorkflowScreen.tsx"), "utf8");
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
