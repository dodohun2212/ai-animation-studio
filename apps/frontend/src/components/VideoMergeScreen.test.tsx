import type { MergeVideosResponse } from "@ai-animation-studio/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { VideoMergeScreen } from "./VideoMergeScreen.js";

const MERGE_URL = "/projects/sample_project/videos/merge";

function makeResponse(overrides: Partial<MergeVideosResponse> = {}): MergeVideosResponse {
  return {
    project: makeProject(),
    finalVideoPath: "videos/final/instagram_reel.mp4",
    ...overrides,
  };
}

function renderScreen(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return render(<VideoMergeScreen projectId="sample_project" onBack={() => {}} />);
}

describe("VideoMergeScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the no-provider notice and never calls the network before any confirmation", () => {
    const fetchMock = vi.fn();
    renderScreen(fetchMock);

    expect(screen.getByTestId("no-provider-notice").textContent).toContain("실제 유료 Runway나 OpenAI Provider를 호출하지 않습니다");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call the merge endpoint on the first click — only an explicit confirmation does", async () => {
    const fetchMock = vi.fn();
    renderScreen(fetchMock);

    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    const panel = await screen.findByTestId("merge-confirm-panel");
    expect(panel.textContent).toContain("실제 유료 Provider 요청은 전송되지 않습니다");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels the confirmation without ever calling the network", async () => {
    const fetchMock = vi.fn();
    renderScreen(fetchMock);

    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    await screen.findByTestId("merge-confirm-panel");
    fireEvent.click(screen.getByTestId("cancel-merge-button"));

    expect(screen.queryByTestId("merge-confirm-panel")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("merges via POST /projects/:id/videos/merge with no body only after explicit confirmation, then shows the completed state", async () => {
    const response = makeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    renderScreen(fetchMock);

    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    await screen.findByTestId("merge-confirm-panel");
    fireEvent.click(screen.getByTestId("confirm-merge-button"));

    await screen.findByTestId("merge-success");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(MERGE_URL);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("final-video-path").textContent).toBe("저장 위치: videos/final/instagram_reel.mp4");
    expect(screen.queryByTestId("open-merge-confirm-button")).toBeNull();
  });

  it("shows a pending state while the merge request is in flight", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    renderScreen(fetchMock);

    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    await screen.findByTestId("merge-confirm-panel");
    fireEvent.click(screen.getByTestId("confirm-merge-button"));

    expect(await screen.findByRole("button", { name: "병합 중..." })).toBeTruthy();
    resolveFetch(jsonResponse(200, makeResponse()));
    await screen.findByTestId("merge-success");
  });

  it.each([
    ["VIDEO_MERGE_NOT_ALLOWED", "6개 장면 영상이 모두 승인된 뒤에만 최종 병합을 진행할 수 있습니다."],
    ["VIDEO_MERGE_CLIPS_INVALID", "승인된 장면 영상 파일을 확인할 수 없습니다. 영상 검토 화면에서 장면을 다시 확인해 주세요."],
    ["FFMPEG_UNAVAILABLE", "이 컴퓨터에서 로컬 영상 병합 프로그램을 사용할 수 없습니다. 설치 상태를 확인해 주세요."],
    ["VIDEO_MERGE_FAILED", "로컬 영상 병합에 실패했습니다. 승인된 장면 영상은 그대로 보존됩니다."],
  ])("shows a safe message for %s instead of the raw backend detail, and stays retryable", async (code, message) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(409, { code, message: "raw backend detail C:/Users/someone" }));
    renderScreen(fetchMock);

    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    await screen.findByTestId("merge-confirm-panel");
    fireEvent.click(screen.getByTestId("confirm-merge-button"));

    const alert = await screen.findByTestId("merge-error");
    expect(alert.textContent).toBe(message);
    expect(alert).toHaveAttribute("data-error-code", code);
    expect(alert.textContent).not.toContain("raw backend detail");
    expect(alert.textContent).not.toContain("C:/Users");
    // Failure keeps the confirmation panel available for another explicit attempt.
    expect(screen.getByTestId("merge-confirm-panel")).toBeTruthy();
    expect(screen.queryByTestId("merge-success")).toBeNull();
  });

  it("maps a network failure to a safe network error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    renderScreen(fetchMock);

    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    await screen.findByTestId("merge-confirm-panel");
    fireEvent.click(screen.getByTestId("confirm-merge-button"));

    const alert = await screen.findByTestId("merge-error");
    expect(alert).toHaveAttribute("data-error-code", "CLIENT_NETWORK_ERROR");
  });

  it("never shows an absolute filesystem path anywhere on screen", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    renderScreen(fetchMock);

    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    await screen.findByTestId("merge-confirm-panel");
    fireEvent.click(screen.getByTestId("confirm-merge-button"));

    await screen.findByTestId("merge-success");
    expect(document.body.textContent).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(document.body.textContent).not.toContain("learning_data");
  });
});

describe("VideoMergeScreen source", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("never touches Runway, OpenAI, FFmpeg, or client-side storage surfaces", async () => {
    const fsPromises = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const srcRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)));
    const content = await fsPromises.readFile(path.join(srcRoot, "VideoMergeScreen.tsx"), "utf8");
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
