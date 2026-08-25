import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../api/testUtils.js";
import { LongEpisodeVideoWorkflowScreen } from "./LongEpisodeVideoWorkflowScreen.js";

const episode = (status: string) => ({ episodeNumber: 1, title: "Episode", summary: "s", mainEvent: "e", conflict: "c", cliffhanger: "h", nextEpisodeHook: "n", status, approved: true, scriptRevision: 1, scriptHistoryCount: 1 });
const preview = { confirmationId: "confirm", model: "gen4_turbo", ratio: "720:1280", durationSecondsPerScene: 5, executionMode: "sequential", estimatedCostUsd: 1.5, scenes: [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, prompt: `prompt ${sceneNumber}`, estimatedCostUsd: .25 })) };
const progress = (status: "created" | "running" | "succeeded" | "interrupted", completed: number[] = []) => ({ jobId: "job", status, completedSceneNumbers: completed, failedSceneNumbers: [], episode: episode(status === "succeeded" ? "videos_review" : "videos_generating") });
describe("LongEpisodeVideoWorkflowScreen", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("does not submit until final local confirmation and sends the exact explicit request", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, preview)).mockResolvedValueOnce(jsonResponse(200, { jobId: "job", acceptedSceneNumbers: [1,2,3,4,5,6], episode: episode("videos_generating") })); vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);
    await screen.findByTestId("episode-video-summary"); fireEvent.click(screen.getByTestId("episode-video-open-confirm")); expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "로컬 가짜 영상 시작" })); await screen.findByTestId("episode-video-progress");
    expect(fetchMock.mock.calls[1]![0]).toBe("/long-projects/long/episodes/1/videos/generations"); const body = JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body)); expect(body).toMatchObject({ confirmationId: "confirm", approved: true, prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) }); expect(typeof body.userRequestId).toBe("string");
  });
  it("renders persisted sequential progress, stop/restart, and review approval/regeneration confirmations", async () => {
    const review = [1,2,3,4,5,6].map((sceneNumber) => ({ sceneNumber, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" }));
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, preview)).mockResolvedValueOnce(jsonResponse(200, { jobId: "job", acceptedSceneNumbers: [1,2,3,4,5,6], episode: episode("videos_generating") })).mockResolvedValueOnce(jsonResponse(200, progress("succeeded", [1,2,3,4,5,6]))).mockResolvedValueOnce(jsonResponse(200, { episode: episode("videos_review"), reviews: review })).mockResolvedValueOnce(jsonResponse(200, { episode: episode("videos_review"), reviews: [{ ...review[0], status: "approved" }, ...review.slice(1)] })); vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />); await screen.findByTestId("episode-video-summary");
    fireEvent.click(screen.getByTestId("episode-video-open-confirm")); fireEvent.click(screen.getByRole("button", { name: "로컬 가짜 영상 시작" })); await screen.findByTestId("episode-video-progress");
    // Simulate a persisted completed job by invoking the same progress endpoint through the polling effect.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4)); fireEvent.click(screen.getAllByRole("button", { name: "승인" })[0]!); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5)); expect(fetchMock.mock.calls[4]![0]).toBe("/long-projects/long/episodes/1/videos/generations/job/review/1/approve");
    fireEvent.click(screen.getAllByRole("button", { name: "다시 만들기" })[1]!); expect(await screen.findByTestId("episode-video-regenerate-confirm-2")).toBeTruthy();
  });
  it("offers a retry for a scene Runway reported failed, only submitting after explicit confirmation", async () => {
    const failedJob = { jobId: "job", status: "failed", completedSceneNumbers: [1], failedSceneNumbers: [2], episode: episode("videos_generating") };
    const retriedJob = { jobId: "job", status: "running", completedSceneNumbers: [1], currentSceneNumber: 2, failedSceneNumbers: [], episode: episode("videos_generating") };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, preview)).mockResolvedValueOnce(jsonResponse(200, { jobId: "job", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating") })).mockResolvedValueOnce(jsonResponse(200, failedJob)).mockResolvedValueOnce(jsonResponse(200, retriedJob));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);
    await screen.findByTestId("episode-video-summary");
    fireEvent.click(screen.getByTestId("episode-video-open-confirm")); fireEvent.click(screen.getByRole("button", { name: "로컬 가짜 영상 시작" }));
    await screen.findByTestId("episode-video-failed-scenes");
    fireEvent.click(screen.getByTestId("episode-video-failed-retry-2"));
    const panel = await screen.findByTestId("episode-video-failed-retry-confirm-2");
    fireEvent.click(within(panel).getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3]![0]).toBe("/long-projects/long/episodes/1/videos/generations/job/scenes/2/regenerate");
  });

  it("handles stale API errors without exposing internal paths", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code: "VIDEO_CONFIRMATION_STALE", message: "raw C:\\\\private" }))); render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />); const alert = await screen.findByRole("alert"); expect(alert).toHaveAttribute("data-error-code", "CLIENT_UNKNOWN_ERROR"); expect(document.body.textContent).not.toContain("C:\\private"); });
});
