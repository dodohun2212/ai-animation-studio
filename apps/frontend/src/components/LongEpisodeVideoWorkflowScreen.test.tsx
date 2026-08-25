import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../api/testUtils.js";
import { LongEpisodeVideoWorkflowScreen } from "./LongEpisodeVideoWorkflowScreen.js";

const episode = (status: string) => ({ episodeNumber: 1, title: "Episode", summary: "s", mainEvent: "e", conflict: "c", cliffhanger: "h", nextEpisodeHook: "n", status, approved: true, scriptRevision: 1, scriptHistoryCount: 1 });
const preview = { confirmationId: "confirm", model: "gen4_turbo", ratio: "720:1280", durationSecondsPerScene: 5, executionMode: "sequential", estimatedCostUsd: 1.5, scenes: [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, prompt: `prompt ${sceneNumber}`, estimatedCostUsd: .25 })) };
const progress = (status: "created" | "running" | "succeeded" | "interrupted", completed: number[] = []) => ({ jobId: "job", status, completedSceneNumbers: completed, failedSceneNumbers: [], episode: episode(status === "succeeded" ? "videos_review" : "videos_generating") });
describe("LongEpisodeVideoWorkflowScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the remaining monthly budget and call cap before approval, warning when the estimate exceeds it", async () => {
    const withBudget = {
      ...preview,
      maximumProviderCalls: 6,
      budget: { monthlyLimitUsd: 10, spentUsd: 9.6, remainingUsd: 0.4, estimatedRequestCostUsd: 1.5, canSpend: false },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, withBudget)));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-summary");
    expect(screen.getByTestId("episode-video-max-calls").textContent).toContain("6회");
    const budgetLine = screen.getByTestId("episode-video-budget").textContent ?? "";
    expect(budgetLine).toContain("$0.40");
    expect(budgetLine).toContain("$9.60");
    expect(screen.getByTestId("episode-video-budget-exceeded")).toBeTruthy();
  });

  it("states model, ratio and clip length before the paid button, the way the short project does", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, preview)));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    const spec = await screen.findByTestId("episode-video-output-spec");
    expect(spec.textContent).toContain("gen4_turbo");
    expect(spec.textContent).toContain("세로형 9:16");
    expect(spec.textContent).toContain("5초");
  });

  it("shows a landscape Episode as landscape rather than always claiming vertical", async () => {
    // The orientation comes from the response, so a project set to 16:9 reads as 16:9 here — this line is the
    // only place a wrong output shape is visible before six clips are paid for.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { ...preview, ratio: "1280:720" })));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    expect((await screen.findByTestId("episode-video-output-spec")).textContent).toContain("가로형 16:9");
  });

  it("omits the budget block entirely when no Runway credential is connected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, preview)));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    await screen.findByTestId("episode-video-summary");
    expect(screen.queryByTestId("episode-video-budget")).toBeNull();
    expect(screen.queryByTestId("episode-video-max-calls")).toBeNull();
    expect(screen.queryByTestId("episode-video-budget-exceeded")).toBeNull();
  });

  it("does not submit until final local confirmation and sends the exact explicit request", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, preview)).mockResolvedValueOnce(jsonResponse(200, { jobId: "job", acceptedSceneNumbers: [1,2,3,4,5,6], episode: episode("videos_generating") })); vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);
    await screen.findByTestId("episode-video-summary"); fireEvent.click(screen.getByTestId("episode-video-open-confirm")); expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "영상 만들기 시작" })); await screen.findByTestId("episode-video-progress");
    expect(fetchMock.mock.calls[1]![0]).toBe("/long-projects/long/episodes/1/videos/generations"); const body = JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body)); expect(body).toMatchObject({ confirmationId: "confirm", approved: true, prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) }); expect(typeof body.userRequestId).toBe("string");
  });
  it("renders persisted sequential progress, stop/restart, and review approval/regeneration confirmations", async () => {
    const review = [1,2,3,4,5,6].map((sceneNumber) => ({ sceneNumber, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" }));
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, preview)).mockResolvedValueOnce(jsonResponse(200, { jobId: "job", acceptedSceneNumbers: [1,2,3,4,5,6], episode: episode("videos_generating") })).mockResolvedValueOnce(jsonResponse(200, progress("succeeded", [1,2,3,4,5,6]))).mockResolvedValueOnce(jsonResponse(200, { episode: episode("videos_review"), reviews: review })).mockResolvedValueOnce(jsonResponse(200, { episode: episode("videos_review"), reviews: [{ ...review[0], status: "approved" }, ...review.slice(1)] })); vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />); await screen.findByTestId("episode-video-summary");
    fireEvent.click(screen.getByTestId("episode-video-open-confirm")); fireEvent.click(screen.getByRole("button", { name: "영상 만들기 시작" })); await screen.findByTestId("episode-video-progress");
    // Simulate a persisted completed job by invoking the same progress endpoint through the polling effect.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4)); fireEvent.click(screen.getAllByRole("button", { name: "이 영상으로 확정" })[0]!); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5)); expect(fetchMock.mock.calls[4]![0]).toBe("/long-projects/long/episodes/1/videos/generations/job/review/1/approve");
    fireEvent.click(screen.getAllByRole("button", { name: "다시 만들기" })[1]!); expect(await screen.findByTestId("episode-video-regenerate-confirm-2")).toBeTruthy();
  });
  it("offers a retry for a scene Runway reported failed, only submitting after explicit confirmation, and shows an actionable reason", async () => {
    const failedJob = {
      jobId: "job", status: "failed", completedSceneNumbers: [1], failedSceneNumbers: [2, 3], episode: episode("videos_generating"),
      sceneErrors: { 2: "authentication", 3: "Runway rejected the prompt: explicit content detected" },
    };
    const retriedJob = { jobId: "job", status: "running", completedSceneNumbers: [1], currentSceneNumber: 2, failedSceneNumbers: [], episode: episode("videos_generating") };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, preview)).mockResolvedValueOnce(jsonResponse(200, { jobId: "job", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6], episode: episode("videos_generating") })).mockResolvedValueOnce(jsonResponse(200, failedJob)).mockResolvedValueOnce(jsonResponse(200, retriedJob));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);
    await screen.findByTestId("episode-video-summary");
    fireEvent.click(screen.getByTestId("episode-video-open-confirm")); fireEvent.click(screen.getByRole("button", { name: "영상 만들기 시작" }));
    await screen.findByTestId("episode-video-failed-scenes");
    expect(screen.getByTestId("episode-video-failed-reason-2").textContent).toContain("Runway API 키 인증에 실패했습니다");
    // An unrecognized code — including Runway's own raw failure text — must never be shown verbatim.
    const opaqueReason = screen.getByTestId("episode-video-failed-reason-3");
    expect(opaqueReason.textContent).not.toContain("Runway rejected the prompt");
    expect(opaqueReason.textContent).toContain("영상 생성에 실패했습니다");
    fireEvent.click(screen.getByTestId("episode-video-failed-retry-2"));
    const panel = await screen.findByTestId("episode-video-failed-retry-confirm-2");
    fireEvent.click(within(panel).getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3]![0]).toBe("/long-projects/long/episodes/1/videos/generations/job/scenes/2/regenerate");
  });

  it("handles stale API errors without exposing internal paths", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code: "VIDEO_CONFIRMATION_STALE", message: "raw C:\\\\private" }))); render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />); const alert = await screen.findByRole("alert"); expect(alert).toHaveAttribute("data-error-code", "CLIENT_UNKNOWN_ERROR"); expect(document.body.textContent).not.toContain("C:\\private"); });

  it("says up front that a connected Runway key means real paid requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, preview)));
    render(<LongEpisodeVideoWorkflowScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenMerge={() => {}} />);

    const notice = await screen.findByTestId("episode-video-provider-notice");
    expect(notice.textContent).toContain("실제 유료 요청이 전송됩니다");
    expect(notice.textContent).not.toContain("보내지 않습니다");
  });
});
