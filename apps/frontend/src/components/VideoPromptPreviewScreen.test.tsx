import type { GetVideoPromptPreviewResponse, VideoPromptPreview } from "@ai-animation-studio/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { VideoPromptPreviewScreen } from "./VideoPromptPreviewScreen.js";

function makePreviews(): VideoPromptPreview[] {
  return [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({
    sceneNumber: sceneNumber as VideoPromptPreview["sceneNumber"],
    prompt: `Scene ${sceneNumber} prompt`,
    model: "gen4_turbo",
    ratio: "720:1280",
    durationSeconds: 5,
    estimatedCostUsd: 0.25,
  }));
}

function renderScreen(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return render(<VideoPromptPreviewScreen projectId="sample_project" onBack={() => {}} />);
}

describe("VideoPromptPreviewScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state, then loads via an explicit POST /projects/:id/videos/preview", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    renderScreen(fetchMock);

    expect(screen.getByText("미리보기를 불러오는 중...")).toBeTruthy();
    await screen.findByTestId("preview-list");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/videos/preview");
    expect(init.method).toBe("POST");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("displays all six scene prompts, model/ratio/duration, and per-scene plus total estimated cost", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await screen.findByTestId("preview-list");
    for (const sceneNumber of [1, 2, 3, 4, 5, 6]) {
      expect(screen.getByTestId(`preview-${sceneNumber}`)).toBeTruthy();
      expect(screen.getByDisplayValue(`Scene ${sceneNumber} prompt`)).toBeTruthy();
      expect(screen.getByTestId(`cost-${sceneNumber}`).textContent).toBe("예상 비용: $0.25");
    }
    expect(screen.getByTestId("preview-summary").textContent).toBe("모델: gen4_turbo · 비율: 720:1280 · 장면당 길이: 5초");
    expect(screen.getByTestId("total-cost").textContent).toBe("총 예상 비용: $1.50");
  });

  it("allows local-only per-scene editing without sending any additional request", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    renderScreen(fetchMock);

    await screen.findByTestId("preview-list");
    const textarea = screen.getByLabelText("Runway 프롬프트", { selector: "#prompt-1" }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "수정된 1번 장면 프롬프트" } });

    expect(textarea.value).toBe("수정된 1번 장면 프롬프트");
    // Only the initial preview fetch happened — editing never calls the network.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Editing one scene leaves the others untouched.
    expect(screen.getByDisplayValue("Scene 2 prompt")).toBeTruthy();
  });

  it("counts UTF-16 code units so a single emoji adds two to the counter", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await screen.findByTestId("preview-list");
    const textarea = screen.getByLabelText("Runway 프롬프트", { selector: "#prompt-1" }) as HTMLTextAreaElement;
    const baseline = "Scene 1 prompt".length;
    expect(screen.getByTestId("prompt-length-1").textContent).toBe(`${baseline} / 1000`);

    fireEvent.change(textarea, { target: { value: "Scene 1 prompt😀" } });

    // "😀" is a surrogate pair — two UTF-16 code units for one visible emoji.
    expect(screen.getByTestId("prompt-length-1").textContent).toBe(`${baseline + 2} / 1000`);
    expect(screen.queryByTestId("prompt-limit-error-1")).toBeNull();
  });

  it("flags a scene prompt that exceeds the 1000 UTF-16 code-unit limit", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await screen.findByTestId("preview-list");
    const textarea = screen.getByLabelText("Runway 프롬프트", { selector: "#prompt-1" }) as HTMLTextAreaElement;
    const overLong = "a".repeat(1001);
    fireEvent.change(textarea, { target: { value: overLong } });

    expect(screen.getByTestId("prompt-length-1").textContent).toBe("1001 / 1000");
    const alert = screen.getByTestId("prompt-limit-error-1");
    expect(alert).toBeTruthy();
    expect(alert.textContent).toBe("프롬프트가 최대 글자 수(1000자)를 초과했습니다.");
  });

  it("does not flag a scene prompt exactly at the 1000 UTF-16 code-unit limit", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await screen.findByTestId("preview-list");
    const textarea = screen.getByLabelText("Runway 프롬프트", { selector: "#prompt-1" }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "a".repeat(1000) } });

    expect(screen.getByTestId("prompt-length-1").textContent).toBe("1000 / 1000");
    expect(screen.queryByTestId("prompt-limit-error-1")).toBeNull();
  });

  it("shows a safe error with a retry action instead of the raw backend message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(409, { code: "VIDEO_PREVIEW_NOT_ALLOWED", message: "raw backend detail" }));
    renderScreen(fetchMock);

    const alert = await screen.findByTestId("preview-error");
    expect(alert.textContent).toBe("영상 미리보기는 장면 이미지 6장이 모두 승인된 프로젝트에서만 가능합니다.");
    expect(alert).toHaveAttribute("data-error-code", "VIDEO_PREVIEW_NOT_ALLOWED");
    expect(alert.textContent).not.toContain("raw backend detail");

    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, response));
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await screen.findByTestId("preview-list");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps a network failure while loading to a safe network error", async () => {
    renderScreen(vi.fn().mockRejectedValue(new Error("network down")));

    const alert = await screen.findByTestId("preview-error");
    expect(alert).toHaveAttribute("data-error-code", "CLIENT_NETWORK_ERROR");
  });

  it("never issues a video-generation, provider, or FFmpeg request while previewing or editing", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    renderScreen(fetchMock);

    await screen.findByTestId("preview-list");
    const textarea = screen.getByLabelText("Runway 프롬프트", { selector: "#prompt-1" }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "수정된 프롬프트" } });

    const calledUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(calledUrls).toEqual(["/projects/sample_project/videos/preview"]);
    expect(calledUrls.some((url) => url.includes("/videos/generations"))).toBe(false);
  });
});
