import type { MergeVideosResponse, Project, Scene } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { VideoMergeScreen } from "./VideoMergeScreen.js";

const PROJECT_URL = "/projects/sample_project";
const MERGE_URL = "/projects/sample_project/videos/merge";

function sixScenes(): Scene[] {
  return [1, 2, 3, 4, 5, 6].map((number) => ({
    number: number as Scene["number"],
    script: `Scene ${number}`,
    imagePrompt: `Image ${number}`,
    motionPrompt: `Motion ${number}`,
    imageReview: "approved",
    videoReview: "approved",
  }));
}

function makeResponse(overrides: Partial<MergeVideosResponse> = {}): MergeVideosResponse {
  return {
    project: makeProject({ scenes: sixScenes() }),
    finalVideoPath: "videos/final/instagram_reel.mp4",
    ...overrides,
  };
}

/** Routes GET /projects/:id (defaulting to VIDEOS_APPROVED with six approved scenes, not yet merged) and lets the caller supply the merge-time fetch behavior. */
function renderScreen(mergeFetch: ReturnType<typeof vi.fn>, project: Partial<Project> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === PROJECT_URL && !init) {
      return jsonResponse(200, { project: makeProject({ workflowState: WorkflowState.VideosApproved, scenes: sixScenes(), ...project }) });
    }
    const call = mergeFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    return call(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, render: render(<VideoMergeScreen projectId="sample_project" onBack={() => {}} />) };
}

describe("VideoMergeScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the no-provider notice and never calls the merge endpoint before any confirmation", async () => {
    const mergeFetch = vi.fn();
    const { fetchMock } = renderScreen(mergeFetch);

    expect(screen.getByTestId("merge-scope-notice").textContent).toContain("이 단계는 비용이 들지 않습니다");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(PROJECT_URL));
    // The scene count follows the project's actual scenes, not a fixed six.
    await waitFor(() => expect(screen.getByTestId("merge-scope-notice").textContent).toContain("6개 승인 장면 영상을 순서대로 이어 붙이고"));
    expect(mergeFetch).not.toHaveBeenCalled();
  });

  it("does not call the merge endpoint on the first click — only an explicit confirmation does", async () => {
    const mergeFetch = vi.fn();
    renderScreen(mergeFetch);

    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
    const panel = await screen.findByTestId("merge-confirm-panel");
    expect(panel.textContent).toContain("유료 요청은 전송되지 않습니다");
    await waitFor(() => expect(panel.textContent).toContain("6개 승인 장면 영상을 하나의 최종 영상으로 병합할까요?"));
    expect(mergeFetch).not.toHaveBeenCalled();
  });

  it("shows the project's actual scene count (not a fixed six) for a four-scene project", async () => {
    const mergeFetch = vi.fn();
    renderScreen(mergeFetch, { scenes: sixScenes().slice(0, 4) });

    await waitFor(() => expect(screen.getByTestId("merge-scope-notice").textContent).toContain("4개 승인 장면 영상을 순서대로 이어 붙이고"));
    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    const panel = await screen.findByTestId("merge-confirm-panel");
    await waitFor(() => expect(panel.textContent).toContain("4개 승인 장면 영상을 하나의 최종 영상으로 병합할까요?"));
  });

  it("cancels the confirmation without ever calling the merge endpoint", async () => {
    const mergeFetch = vi.fn();
    renderScreen(mergeFetch);

    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
    await screen.findByTestId("merge-confirm-panel");
    fireEvent.click(screen.getByTestId("cancel-merge-button"));

    expect(screen.queryByTestId("merge-confirm-panel")).toBeNull();
    expect(mergeFetch).not.toHaveBeenCalled();
  });

  it("merges via POST /projects/:id/videos/merge with no body only after explicit confirmation, then shows the completed state", async () => {
    const response = makeResponse();
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, response));
    renderScreen(mergeFetch);

    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
    await screen.findByTestId("merge-confirm-panel");
    fireEvent.click(screen.getByTestId("confirm-merge-button"));

    await screen.findByTestId("merge-success");
    const [url, init] = mergeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(MERGE_URL);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(mergeFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("final-video-path").textContent).toBe("저장 위치: videos/final/instagram_reel.mp4");
    expect(screen.queryByTestId("open-merge-confirm-button")).toBeNull();
  });

  it("shows the existing result immediately when reopened for an already-completed project, without re-merging", async () => {
    const mergeFetch = vi.fn();
    renderScreen(mergeFetch, { workflowState: WorkflowState.Completed, finalVideoPath: "videos/final/instagram_reel.mp4" });

    await screen.findByTestId("merge-success");
    expect(screen.queryByTestId("open-merge-confirm-button")).toBeNull();
    expect(mergeFetch).not.toHaveBeenCalled();
  });

  it("shows the actual final video and no open-in-explorer button outside Electron", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    renderScreen(mergeFetch);

    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
    await screen.findByTestId("merge-confirm-panel");
    fireEvent.click(screen.getByTestId("confirm-merge-button"));

    await screen.findByTestId("merge-success");
    expect(screen.getByTestId("final-video-player")).toHaveAttribute("src", "/projects/sample_project/videos/final/content");
    expect(screen.queryByTestId("open-in-explorer-button")).toBeNull();
  });

  it("opens the final video's folder through the Electron bridge when running inside the desktop shell", async () => {
    const openProjectPath = vi.fn().mockResolvedValue({ opened: true });
    (window as unknown as { electronAPI?: unknown }).electronAPI = { openProjectPath };
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    renderScreen(mergeFetch);

    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
    await screen.findByTestId("merge-confirm-panel");
    fireEvent.click(screen.getByTestId("confirm-merge-button"));
    await screen.findByTestId("merge-success");

    fireEvent.click(await screen.findByTestId("open-in-explorer-button"));
    await waitFor(() => expect(openProjectPath).toHaveBeenCalledWith("sample_project", "videos/final/instagram_reel.mp4"));
    expect(screen.queryByTestId("open-in-explorer-error")).toBeNull();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it("shows a pending state while the merge request is in flight", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const mergeFetch = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    renderScreen(mergeFetch);

    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
    await screen.findByTestId("merge-confirm-panel");
    fireEvent.click(screen.getByTestId("confirm-merge-button"));

    expect(await screen.findByRole("button", { name: "병합 중..." })).toBeTruthy();
    resolveFetch(jsonResponse(200, makeResponse()));
    await screen.findByTestId("merge-success");
  });

  it.each([
    ["VIDEO_MERGE_NOT_ALLOWED", "모든 장면 영상이 승인된 뒤에만 최종 병합을 진행할 수 있습니다."],
    ["VIDEO_MERGE_CLIPS_INVALID", "승인된 장면 영상 파일을 확인할 수 없습니다. 영상 검토 화면에서 장면을 다시 확인해 주세요."],
    ["FFMPEG_UNAVAILABLE", "이 컴퓨터에서 로컬 영상 병합 프로그램을 사용할 수 없습니다. 설치 상태를 확인해 주세요."],
    ["VIDEO_MERGE_FAILED", "로컬 영상 병합에 실패했습니다. 승인된 장면 영상은 그대로 보존됩니다."],
  ])("shows a safe message for %s instead of the raw backend detail, and stays retryable", async (code, message) => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(409, { code, message: "raw backend detail C:/Users/someone" }));
    renderScreen(mergeFetch);

    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
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
    const mergeFetch = vi.fn().mockRejectedValue(new Error("network down"));
    renderScreen(mergeFetch);

    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
    await screen.findByTestId("merge-confirm-panel");
    fireEvent.click(screen.getByTestId("confirm-merge-button"));

    const alert = await screen.findByTestId("merge-error");
    expect(alert).toHaveAttribute("data-error-code", "CLIENT_NETWORK_ERROR");
  });

  it("never shows an absolute filesystem path anywhere on screen", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    renderScreen(mergeFetch);

    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
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
