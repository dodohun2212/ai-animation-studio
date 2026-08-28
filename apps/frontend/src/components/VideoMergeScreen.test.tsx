import type { MergeVideosResponse, Project, Scene } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { VideoMergeScreen } from "./VideoMergeScreen.js";

const PROJECT_URL = "/projects/sample_project";
const MERGE_URL = "/projects/sample_project/videos/merge";
const SETTINGS_URL = "/projects/sample_project/settings";
const AUDIO_LIBRARY_URL = "/audio/library";

function makeTrack(overrides: Record<string, unknown> = {}) {
  return {
    trackId: "t1", title: "기록관의 밤", durationSeconds: 95, bytes: 2_400_000,
    source: "upload", licenseKind: "self-made", attributionRequired: false,
    addedAt: "2026-08-26T18:00:00.000Z", ...overrides,
  };
}

/** Only narrationEnabled/subtitlesEnabled matter to this screen; the rest is filler the response type requires. */
function makeSettings(narrationEnabled: boolean, subtitlesEnabled: boolean) {
  return {
    projectName: "이름", topic: "주제", genre: "장르", mood: "분위기", character: "인물",
    lore: "", fullStory: "", durationSeconds: 30, sceneCount: 6, clipDurationSeconds: 5,
    additionalNotes: "", styleNotes: {}, narrationEnabled, subtitlesEnabled,
  };
}

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

/**
 * Swaps in a clipboard for one test and puts the real descriptor back afterwards. Defined on the existing
 * navigator rather than replacing the whole object, so nothing else that reads navigator during render
 * (userAgent, and whatever the testing library reaches for) disappears for the duration.
 */
async function withClipboard(writeText: ReturnType<typeof vi.fn>, body: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  try {
    await body();
  } finally {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "clipboard");
  }
}

/** Routes GET /projects/:id (defaulting to VIDEOS_APPROVED with six approved scenes, not yet merged) and lets the caller supply the merge-time fetch behavior. */
function renderScreen(
  mergeFetch: ReturnType<typeof vi.fn>,
  project: Partial<Project> = {},
  settings: { narrationEnabled: boolean; subtitlesEnabled: boolean } | "fails" = { narrationEnabled: false, subtitlesEnabled: false },
  tracks: ReturnType<typeof makeTrack>[] = [],
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === PROJECT_URL && !init) {
      return jsonResponse(200, { project: makeProject({ workflowState: WorkflowState.VideosApproved, scenes: sixScenes(), ...project }) });
    }
    if (url === SETTINGS_URL && !init) {
      if (settings === "fails") return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "raw" });
      return jsonResponse(200, { settings: makeSettings(settings.narrationEnabled, settings.subtitlesEnabled), sceneCountChangeable: true, aspectRatioChangeable: true });
    }
    if (url === AUDIO_LIBRARY_URL && !init) return jsonResponse(200, { tracks });
    const call = mergeFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    return call(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, render: render(<VideoMergeScreen projectId="sample_project" onBack={() => {}} />) };
}

/** A completed project whose merge used a track that requires credit — the state the notice exists for. */
function renderCredited() {
  return renderScreen(vi.fn(), {
    workflowState: WorkflowState.Completed,
    finalVideoPath: "videos/final/instagram_reel.mp4",
    usedAudio: { mode: "narration+bgm", attributionRequired: true, attributionText: "Music by ○○○" },
  });
}

describe("VideoMergeScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Regression: the default used to be "narration only" regardless of whether the project had any. A project
  // that never generated narration would then be labelled as narrated while producing a silent video — the
  // screen saying one thing and the file being another (docs/06_DECISIONS.md D-011).
  it("defaults to silent for a project with no narration, and refuses to offer the narration mode at all", async () => {
    renderScreen(vi.fn(), { narrationAvailable: false });

    await screen.findByTestId("merge-audio-settings");
    expect(screen.getByTestId("merge-audio-silent")).toBeChecked();
    expect(screen.getByTestId("merge-audio-narration")).toBeDisabled();
    expect(screen.getByTestId("merge-audio-narration-unavailable")).toBeTruthy();
    // The button states the outcome, so no confirmation dialog has to ask about audio.
    expect(screen.getByTestId("open-merge-confirm-button").textContent).toContain("무음");
  });

  it("defaults to narration when the project actually has it", async () => {
    renderScreen(vi.fn(), { narrationAvailable: true });

    await screen.findByTestId("merge-audio-settings");
    expect(screen.getByTestId("merge-audio-narration")).toBeChecked();
    expect(screen.getByTestId("open-merge-confirm-button").textContent).toContain("나레이션만");
  });

  it("offers background music only once a track exists, and sends the chosen one with the merge", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    renderScreen(mergeFetch, { narrationAvailable: true }, { narrationEnabled: true, subtitlesEnabled: false }, [makeTrack()]);

    await screen.findByTestId("merge-audio-settings");
    expect(screen.getByTestId("merge-audio-narration+bgm")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("merge-audio-narration+bgm"));

    // A mode that needs a track cannot merge until one is picked — the button would otherwise send an
    // incomplete request and the server would reject it after the click.
    expect(screen.getByTestId("open-merge-confirm-button")).toBeDisabled();
    expect(screen.getByTestId("merge-audio-track-required")).toBeTruthy();

    fireEvent.change(screen.getByTestId("merge-audio-track"), { target: { value: "t1" } });
    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    fireEvent.click(await screen.findByTestId("confirm-merge-button"));

    await waitFor(() => expect(mergeFetch).toHaveBeenCalled());
    const [, init] = mergeFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ audio: { mode: "narration+bgm", trackId: "t1" } });
  });

  it("says why background music is unavailable instead of leaving a dead option", async () => {
    renderScreen(vi.fn(), { narrationAvailable: true });

    await screen.findByTestId("merge-audio-settings");
    expect(screen.getByTestId("merge-audio-narration+bgm")).toBeDisabled();
    expect(screen.getByTestId("merge-audio-bgm-unavailable").textContent).toContain("음원 보관함");
  });

  // The reminder has to reach the person while they are still writing the caption, not only on the library screen.
  it("repeats the attribution requirement of the selected track on the merge screen", async () => {
    renderScreen(vi.fn(), { narrationAvailable: true }, undefined, [makeTrack({ attributionRequired: true })]);

    await screen.findByTestId("merge-audio-settings");
    fireEvent.click(screen.getByTestId("merge-audio-narration+bgm"));
    fireEvent.change(screen.getByTestId("merge-audio-track"), { target: { value: "t1" } });

    expect(screen.getByTestId("merge-audio-attribution").textContent).toContain("출처");
  });

  it("shows the no-provider notice and never calls the merge endpoint before any confirmation", async () => {
    const mergeFetch = vi.fn();
    const { fetchMock } = renderScreen(mergeFetch);

    expect(screen.getByTestId("merge-scope-notice").textContent).toContain("이 단계는 비용이 들지 않습니다");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(PROJECT_URL));
    // The scene count follows the project's actual scenes, not a fixed six.
    await waitFor(() => expect(screen.getByTestId("merge-scope-notice").textContent).toContain("6개 승인 장면 영상을 순서대로 이어 붙입니다"));
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

    await waitFor(() => expect(screen.getByTestId("merge-scope-notice").textContent).toContain("4개 승인 장면 영상을 순서대로 이어 붙입니다"));
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

  it("merges via POST /projects/:id/videos/merge with the selected audio mode only after explicit confirmation, then shows the completed state", async () => {
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
    expect(init.body).toBe(JSON.stringify({ audio: { mode: "silent" } }));
    expect(mergeFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("final-video-path").textContent).toBe("저장 위치: videos/final/instagram_reel.mp4");
    expect(screen.queryByTestId("open-merge-confirm-button")).toBeNull();
  });

  // The whole point of collecting a licence at upload was to stop a credit line going missing at publish time.
  // It was being shown in the library and while picking a track, but not where the caption is actually written —
  // by then the sentence was two screens behind the user (docs/06_DECISIONS.md D-003).
  it("shows the credit line the finished video owes, with the sentence itself", async () => {
    const response = makeResponse({
      project: makeProject({
        scenes: sixScenes(),
        usedAudio: { mode: "narration+bgm", trackId: "t1", attributionRequired: true, attributionText: "Music by ○○○ (CC BY 4.0)" },
      }),
    });
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, response));
    renderScreen(mergeFetch);

    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
    fireEvent.click(await screen.findByTestId("confirm-merge-button"));

    await screen.findByTestId("merge-success");
    expect(screen.getByTestId("merge-attribution-text").textContent).toBe("Music by ○○○ (CC BY 4.0)");
  });

  // Reads usedAudio rather than the track on purpose: the sentence is copied by value at merge time so that
  // deleting the track afterwards cannot erase what an already-published video still owes.
  it("shows the credit line on a completed project even with the audio library empty", async () => {
    renderScreen(
      vi.fn(),
      {
        workflowState: WorkflowState.Completed,
        finalVideoPath: "videos/final/instagram_reel.mp4",
        usedAudio: { mode: "narration+bgm", attributionRequired: true, attributionText: "Music by ○○○" },
      },
      { narrationEnabled: false, subtitlesEnabled: false },
      [],
    );

    await screen.findByTestId("merge-success");
    expect(screen.getByTestId("merge-attribution-text").textContent).toBe("Music by ○○○");
  });

  it("says nothing about credit when the track did not require it", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    renderScreen(mergeFetch);

    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
    fireEvent.click(await screen.findByTestId("confirm-merge-button"));

    await screen.findByTestId("merge-success");
    expect(screen.queryByTestId("merge-attribution")).toBeNull();
  });

  // "Credit this" without saying what to write leaves the user inventing wording the licence may be specific
  // about, so the blank case points back at the one screen where it can be fixed.
  it("points back to the library when credit is required but the sentence is blank", async () => {
    renderScreen(
      vi.fn(),
      {
        workflowState: WorkflowState.Completed,
        finalVideoPath: "videos/final/instagram_reel.mp4",
        usedAudio: { mode: "narration+bgm", attributionRequired: true },
      },
    );

    await screen.findByTestId("merge-success");
    expect(screen.getByTestId("merge-attribution-missing").textContent).toContain("음원 보관함");
    expect(screen.queryByTestId("merge-attribution-copy")).toBeNull();
  });

  it("copies the sentence to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await withClipboard(writeText, async () => {
      renderCredited();
      fireEvent.click(await screen.findByTestId("merge-attribution-copy"));

      await screen.findByTestId("merge-attribution-copied");
      expect(writeText).toHaveBeenCalledWith("Music by ○○○");
    });
  });

  // A refused clipboard (no permission, insecure origin) must not become a dead end: the sentence is on screen
  // either way, so the button degrades to "select it yourself" rather than failing silently.
  it("tells the reader to copy by hand when the clipboard refuses", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    await withClipboard(writeText, async () => {
      renderCredited();
      fireEvent.click(await screen.findByTestId("merge-attribution-copy"));

      await screen.findByTestId("merge-attribution-copy-failed");
      expect(screen.getByTestId("merge-attribution-text").textContent).toBe("Music by ○○○");
    });
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

  it("says a scene with no audio still gets its subtitle when subtitles are on without narration", async () => {
    // Subtitles-only is a real mode (no TTS spend): the copy must not imply a silent scene loses its subtitle.
    renderScreen(vi.fn(), {}, { narrationEnabled: false, subtitlesEnabled: true });

    await waitFor(() =>
      expect(screen.getByTestId("merge-scope-notice").textContent).toContain("자막만 입힙니다"),
    );
    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    expect((await screen.findByTestId("merge-confirm-panel")).textContent).toContain("자막만 입힙니다");
  });

  it("still promises the subtitle on a scene with no audio yet when both are on", async () => {
    renderScreen(vi.fn(), {}, { narrationEnabled: true, subtitlesEnabled: true });

    await waitFor(() =>
      expect(screen.getByTestId("merge-scope-notice").textContent).toContain(
        "음성이 아직 없는 장면에도 자막은 들어갑니다",
      ),
    );
  });

  it("promises no audio when narration is off, matching the merge service's own gate", async () => {
    // "Off" means "not used", not "not made again" — a scene whose audio file still exists from before is
    // skipped, so the copy must not promise that audio comes back.
    renderScreen(vi.fn(), {}, { narrationEnabled: false, subtitlesEnabled: true });

    await waitFor(() => {
      const text = screen.getByTestId("merge-scope-notice").textContent ?? "";
      expect(text).toContain("음성은 꺼져 있어 넣지 않습니다");
      expect(text).not.toContain("음성이 입혀지고");
    });
  });

  it("promises no subtitles when only narration is on", async () => {
    renderScreen(vi.fn(), {}, { narrationEnabled: true, subtitlesEnabled: false });

    await waitFor(() =>
      expect(screen.getByTestId("merge-scope-notice").textContent).toContain("자막은 넣지 않습니다"),
    );
  });

  it("promises neither when both are off", async () => {
    renderScreen(vi.fn(), {}, { narrationEnabled: false, subtitlesEnabled: false });

    await waitFor(() =>
      expect(screen.getByTestId("merge-scope-notice").textContent).toContain("음성도 자막도 꺼져 있어"),
    );
  });

  it("claims nothing about audio or subtitles when the settings request fails", async () => {
    renderScreen(vi.fn(), {}, "fails");

    // The merge itself still works without settings, so the screen stays usable — it just stops describing
    // what it cannot confirm rather than guessing a mode.
    await waitFor(() => expect(screen.getByTestId("merge-scope-notice").textContent).toContain("순서대로 이어 붙입니다"));
    expect(screen.getByTestId("merge-scope-notice").textContent).not.toContain("자막");
    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    const panel = await screen.findByTestId("merge-confirm-panel");
    expect(panel.textContent).toContain("유료 요청은 전송되지 않습니다");
    expect(panel.textContent).not.toContain("자막");
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
