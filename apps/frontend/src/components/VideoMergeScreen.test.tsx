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
/** The confirmed count's real source, addressed by the job id the project carries. */
const REVIEW_URL = "/projects/sample_project/videos/generations/job_1/review";
/** A second job id, so the harness's stand-in answer cannot collide with a test that answers job_1 itself. */
const DEFAULT_JOB_ID = "job_default";
const DEFAULT_REVIEW_URL = `/projects/sample_project/videos/generations/${DEFAULT_JOB_ID}/review`;

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
  // See ImageGenerationScreen.test.tsx: the callback carries the annotation, so an invented field is a compile
  // error here rather than an extra the response could never have.
  return [1, 2, 3, 4, 5, 6].map((number): Scene => ({
    number: number as Scene["number"],
    script: `Scene ${number}`,
    motionPrompt: `Motion ${number}`,
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
  /** Which scenes the video review reports as confirmed. Defaults to all of them. */
  approved?: number[],
  onOpenInstagramPost?: (projectId: string) => void,
  /**
   * Which model made each scene's clip, as the review reports it — by scene number, so a test can put two
   * different models in one reel. Absent is the local fake execution mode, where no provider made anything.
   */
  clipModels?: Record<number, string>,
  /** 그 장면 클립을 잰 값, 장면 번호별 — 없는 것이 정상입니다(ffprobe 없음 · 가짜 실행 · 병합을 마친 프로젝트). */
  clipFacts?: Record<number, { width: number; height: number; hasAudio: boolean }>,
) {
  // The confirmation count comes from the video review route, never from a field on the scene — no response has
  // ever carried one (see the note above the COMPLETED-project test). A test says which scenes are confirmed by
  // number, which is the thing the route actually reports.
  const scenes = (project.scenes ?? sixScenes()) as Scene[];
  const reviews = scenes.map((scene) => ({ sceneNumber: scene.number, status: (approved ?? scenes.map((one) => one.number)).includes(scene.number) ? "approved" as const : "pending" as const, updatedAt: "2026-08-23T00:00:00.000Z", ...(clipModels?.[scene.number] ? { model: clipModels[scene.number] } : {}), ...(clipFacts?.[scene.number] ? { clip: clipFacts[scene.number] } : {}) }));
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === PROJECT_URL && !init) {
      return jsonResponse(200, { project: makeProject({ workflowState: WorkflowState.VideosApproved, scenes, currentVideoJobId: DEFAULT_JOB_ID, ...project }) });
    }
    if (url === DEFAULT_REVIEW_URL && !init) return jsonResponse(200, { project: makeProject({ scenes }), reviews });
    if (url === SETTINGS_URL && !init) {
      if (settings === "fails") return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "raw" });
      return jsonResponse(200, { settings: makeSettings(settings.narrationEnabled, settings.subtitlesEnabled), sceneCountChangeable: true, aspectRatioChangeable: true });
    }
    if (url === AUDIO_LIBRARY_URL && !init) return jsonResponse(200, { tracks });
    const call = mergeFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    return call(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, render: render(<VideoMergeScreen projectId="sample_project" onBack={() => {}} onOpenInstagramPost={onOpenInstagramPost} />) };
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

  /**
   * The screen that prompted this had all three of its old options in the state a person actually hits: no
   * narration recorded and a track sitting in the library. "나레이션만" and "나레이션 + 배경음악" were both locked
   * for want of narration, leaving 무음 as the only reachable choice — so the music they had already uploaded
   * could not be used at all. Music alone was never forbidden; the contract simply had no word for it
   * (MergeAudioSettings' "bgm" doc comment).
   */
  it("lets a project with no narration merge music alone", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    renderScreen(mergeFetch, { narrationAvailable: false }, undefined, [makeTrack()]);

    await screen.findByTestId("merge-audio-settings");
    // The two narration modes stay locked — this is the exact state where the old screen had nothing left.
    expect(screen.getByTestId("merge-audio-narration")).toBeDisabled();
    expect(screen.getByTestId("merge-audio-narration+bgm")).toBeDisabled();
    expect(screen.getByTestId("merge-audio-bgm")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("merge-audio-bgm"));
    // Needs a track for the same reason "narration+bgm" does: a music mode with no music would render silence
    // and look finished.
    expect(screen.getByTestId("open-merge-confirm-button")).toBeDisabled();

    fireEvent.change(screen.getByTestId("merge-audio-track"), { target: { value: "t1" } });
    expect(screen.getByTestId("open-merge-confirm-button").textContent).toContain("배경음악만");

    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    fireEvent.click(await screen.findByTestId("confirm-merge-button"));

    await waitFor(() => expect(mergeFetch).toHaveBeenCalled());
    const [, init] = mergeFetch.mock.calls[0] as [string, RequestInit];
    // No narration in the request: the server's volume default differs by mode, and sending "narration+bgm"
    // here would quarter a track that has nothing to sit beneath.
    expect(JSON.parse(String(init.body))).toEqual({ audio: { mode: "bgm", trackId: "t1" } });
  });

  it("says why background music is unavailable instead of leaving a dead option", async () => {
    renderScreen(vi.fn(), { narrationAvailable: true });

    await screen.findByTestId("merge-audio-settings");
    expect(screen.getByTestId("merge-audio-narration+bgm")).toBeDisabled();
    expect(screen.getByTestId("merge-audio-bgm-unavailable").textContent).toContain("음원 보관함");
    // Music-only is locked for the same reason and says so in its own words rather than sitting there dead.
    expect(screen.getByTestId("merge-audio-bgm")).toBeDisabled();
    expect(screen.getByTestId("merge-audio-bgm-only-unavailable").textContent).toContain("음원 보관함");
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
    await waitFor(() => expect(screen.getByTestId("merge-scope-notice").textContent).toContain("확정된 6개 장면 영상을 순서대로 이어 붙입니다"));
    expect(mergeFetch).not.toHaveBeenCalled();
  });

  /**
   * The load state this screen has always tracked and never shown.
   *
   * `loadState` was set on both branches and read nowhere, so a failed project read rendered the whole merge
   * UI as though it had loaded — no spinner, no error, 확정 counts silently null — and the person pressed 병합
   * and got the server's refusal instead of the sentence saying the screen never managed to read the project.
   *
   * The button is deliberately still reachable: the count being unknown does not block, by the same rule the
   * screen already follows ("a button disabled on a guess is worse than one that fails honestly"). What was
   * missing is the saying-so, and that is what this asserts.
   */
  it("says the project could not be read instead of rendering as if it had", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === PROJECT_URL
      ? jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "raw backend detail" })
      : jsonResponse(200, { tracks: [] })));
    render(<VideoMergeScreen projectId="sample_project" onBack={() => {}} />);

    const alert = await screen.findByTestId("merge-load-error");
    expect(alert.textContent).not.toContain("raw backend detail");
    expect(alert).toHaveAttribute("data-error-code", "PROJECT_STORAGE_ERROR");
    // Not a spinner that never stops either: the load is over, it just failed.
    expect(screen.queryByTestId("merge-loading")).toBeNull();
  });

  /**
   * Seen live on 이배드의 탄생, a COMPLETED project with six videos and a final file on disk.
   *
   * The count used to be taken off `scene.videoReview`, a field that has never existed anywhere:
   * `project.mapper.ts` spreads the stored scene and asserts `as unknown as Scene`, so two required fields
   * nothing writes were being read as answers. All six came back `undefined`, `undefined !== "approved"` made
   * them unconfirmed, and the screen said 장면 6개 중 0개 확정됨 and 아직 확정하지 않은 장면이 6개 있습니다 — in
   * the same panel that was printing the finished video's path.
   *
   * A finished project's review is refused (VIDEO_WORKFLOW_NOT_ALLOWED — there is nothing left to confirm),
   * which is an ordinary answer and not this screen failing. The rule the screen already states covers it:
   * "unknown stays unblocked, the server is still the real gate". So the assertions are that the number and
   * the blocker are both absent, not that they read zero.
   */
  it("says nothing about confirmations when the review is refused", async () => {
    const mergeFetch = vi.fn(async (input: RequestInfo | URL) => String(input) === REVIEW_URL
      ? jsonResponse(409, { code: "VIDEO_WORKFLOW_NOT_ALLOWED", message: "raw" })
      : jsonResponse(404, { code: "NOT_FOUND", message: "raw" }));
    renderScreen(mergeFetch, {
      workflowState: WorkflowState.Completed, scenes: sixScenes(),
      finalVideoPath: "videos/final/instagram_reel.mp4", currentVideoJobId: "job_1",
    });

    await waitFor(() => expect(screen.getByTestId("merge-scope-notice").textContent).toContain("이어 붙입니다"));
    expect(screen.queryByTestId("merge-approved-count")).toBeNull();
    expect(screen.queryByTestId("merge-blocked")).toBeNull();
    // And the number that was wrong must not reappear anywhere in the panel's own sentence.
    expect(screen.getByTestId("merge-scope-notice").textContent).not.toContain("확정된 0개");
  });

  /**
   * The half that keeps the above from turning into "never count anything".
   *
   * This shape is what the server actually sends — the same review list the Episode merge screen reads — so
   * unlike the version it replaces, its green comes from a response the backend can really produce rather than
   * from a scene field nothing has ever written.
   */
  it("counts and blocks from the review list", async () => {
    const reviews = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({
      sceneNumber, status: sceneNumber <= 4 ? "approved" : "pending", updatedAt: "2026-08-23T00:00:00.000Z",
    }));
    const mergeFetch = vi.fn(async (input: RequestInfo | URL) => String(input) === REVIEW_URL
      ? jsonResponse(200, { project: makeProject({ scenes: sixScenes() }), reviews })
      : jsonResponse(404, { code: "NOT_FOUND", message: "raw" }));
    renderScreen(mergeFetch, { scenes: sixScenes(), currentVideoJobId: "job_1" });

    expect((await screen.findByTestId("merge-approved-count")).textContent).toContain("4개 확정됨");
    expect((await screen.findByTestId("merge-blocked")).textContent).toContain("2개 있습니다");
  });

  /** No job at all: nothing to ask, so nothing is claimed — and the review route is not called. */
  it("asks for no review when the project has no video job", async () => {
    const mergeFetch = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(404, { code: "NOT_FOUND", message: "raw" }));
    // Said outright rather than left to the harness default, which supplies a job so the older tests can count.
    renderScreen(mergeFetch, { scenes: sixScenes(), currentVideoJobId: undefined });

    await waitFor(() => expect(screen.getByTestId("merge-scope-notice").textContent).toContain("이어 붙입니다"));
    expect(screen.queryByTestId("merge-approved-count")).toBeNull();
    expect(mergeFetch.mock.calls.some(([url]) => String(url) === REVIEW_URL)).toBe(false);
  });

  it("does not call the merge endpoint on the first click — only an explicit confirmation does", async () => {
    const mergeFetch = vi.fn();
    renderScreen(mergeFetch);

    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
    const panel = await screen.findByTestId("merge-confirm-panel");
    expect(panel.textContent).toContain("유료 요청은 전송되지 않습니다");
    await waitFor(() => expect(panel.textContent).toContain("확정된 6개 장면 영상을 하나의 최종 영상으로 병합할까요?"));
    expect(mergeFetch).not.toHaveBeenCalled();
  });

  it("shows the project's actual scene count (not a fixed six) for a four-scene project", async () => {
    const mergeFetch = vi.fn();
    renderScreen(mergeFetch, { scenes: sixScenes().slice(0, 4) });

    await waitFor(() => expect(screen.getByTestId("merge-scope-notice").textContent).toContain("확정된 4개 장면 영상을 순서대로 이어 붙입니다"));
    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    const panel = await screen.findByTestId("merge-confirm-panel");
    await waitFor(() => expect(panel.textContent).toContain("확정된 4개 장면 영상을 하나의 최종 영상으로 병합할까요?"));
  });

  /**
   * The screen used to call the scene total "승인 장면" and offer the button regardless, so a project with two
   * scenes still pending was told it would merge six approved clips and then refused by the server. The Episode
   * screen has named the gap before the button since it was written; this is the short project's half of it.
   */
  it("names the scenes still unconfirmed and refuses to open the confirmation", async () => {
    const mergeFetch = vi.fn();
    renderScreen(mergeFetch, { scenes: sixScenes() }, undefined, undefined, [1, 2, 3, 4]);

    expect((await screen.findByTestId("merge-approved-count")).textContent).toContain("4개 확정됨");
    expect((await screen.findByTestId("merge-blocked")).textContent).toContain("2개");
    expect(screen.getByTestId("open-merge-confirm-button")).toBeDisabled();

    // Disabled is a claim about what a press would do; the guard has to hold even if the attribute is bypassed.
    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    expect(screen.queryByTestId("merge-confirm-panel")).toBeNull();
    expect(mergeFetch).not.toHaveBeenCalled();
  });

  /**
   * A photo card had no way out of the block above.
   *
   * Its one scene is a still picture, so `videoReview` is never "approved" — 0 of 1 confirmed, button disabled,
   * forever. And the only thing the message told the person to do, confirm the scene in the video screen, means
   * generating a scene video, which is a paid call: the dead end charged money to leave. Meanwhile the server
   * merges the card happily; video-merge.service.ts branches on the same fact and reads the picture directly.
   */
  it("merges a photo card, which has no scene video to confirm", async () => {
    const mergeFetch = vi.fn();
    const still: Scene[] = [{ number: 1, script: "불광불급", motionPrompt: "" }];
    renderScreen(mergeFetch, { photoCard: true, scenes: still }, undefined, undefined, []);

    await screen.findByTestId("merge-scope-notice");
    expect(screen.queryByTestId("merge-blocked")).toBeNull();
    // The scene tally is about clips being confirmed one by one, which is not what a card is.
    expect(screen.queryByTestId("merge-approved-count")).toBeNull();
    expect(screen.getByTestId("open-merge-confirm-button")).not.toBeDisabled();
    expect(screen.getByTestId("merge-scope-notice").textContent).toContain("그림 한 장");
  });

  /**
   * The controls exist because the only other way to see the result was to publish and look.
   *
   * The first card went out with its text under Instagram's own interface, unreadable. The values are carried
   * on the merge — the one request that actually uses them — so what is stored is always a layout some video
   * was really made with.
   */
  /**
   * 🔴 2026-09-13 에 완성된 첫 릴 위아래에 검은 띠가 붙었습니다. 원인은 병합이 아니라 모델입니다 — 클립이
   * 릴 틀과 다른 모양(장면 그림의 2:3)으로 왔고, 병합은 그 모양을 틀 안에 넣느라 여백을 붙였습니다.
   * 잘라 채우면 **어느 모델을 골랐든** 띠가 없어집니다.
   *
   * 🔴 「여백」일 때는 칸을 아예 안 보냅니다. 계약이 「생략 = pad」이니 결과는 같은데, 안 보내면 오늘까지의
   * 요청과 바이트가 같습니다 — 이 파일의 다른 짝들이 본문을 통째로 비교하고 있어서, 늘 보내면 새 칸이
   * 생겼다는 이유만으로 그 짝들이 전부 빨개집니다. 그건 기능이 아니라 남의 짝을 고치는 일입니다.
   */
  it("sends the frame fit only when it is not the default", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    renderScreen(mergeFetch, { scenes: sixScenes() });

    // 기본값은 「여백 두기」 — 고르기 전 결과는 지금까지와 같아야 합니다.
    expect((await screen.findByTestId("merge-frame-fit-pad")) as HTMLInputElement).toBeTruthy();
    expect(((screen.getByTestId("merge-frame-fit-pad")) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    fireEvent.click(await screen.findByTestId("confirm-merge-button"));
    await waitFor(() => expect(mergeFetch).toHaveBeenCalled());
    expect(Object.keys(JSON.parse(String((mergeFetch.mock.calls[0] as [string, RequestInit])[1].body))))
      .not.toContain("frameFit");
  });

  it("sends fill once someone asks for it", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    renderScreen(mergeFetch, { scenes: sixScenes() });

    fireEvent.click(await screen.findByTestId("merge-frame-fit-fill"));
    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    fireEvent.click(await screen.findByTestId("confirm-merge-button"));

    await waitFor(() => expect(mergeFetch).toHaveBeenCalled());
    const [, init] = mergeFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).frameFit).toBe("fill");
  });

  /**
   * 🔴 포토카드는 틀에 맞춰 그려지므로 이 선택이 아무것도 바꾸지 않고, 서버도 거절합니다(INVALID_REQUEST).
   * 아무것도 못 하는 선택을 보여 주면 사람은 눌러 보고, 눌러서 병합이 실패합니다.
   */
  it("hides the frame fit on a photo card, where it would only be refused", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const still: Scene[] = [{ number: 1, script: "", motionPrompt: "", narration: "한 줄" }];
    renderScreen(mergeFetch, { photoCard: true, scenes: still }, undefined, undefined, []);

    await screen.findByTestId("open-merge-confirm-button");
    expect(screen.queryByTestId("merge-frame-fit")).toBeNull();
  });

  /**
   * 🔴 CLI 깨기에서 살아남은 것: 「위아래가 조금 잘립니다」를 「좌우」로 바꿔도 초록이었습니다 — `aspectVertical`
   * 이 거짓인 경우의 짝이 없었기 때문입니다. 세로 릴은 2:3 이 9:16 보다 넓어 **좌우**가 잘리고, 가로 릴은
   * 3:2 가 16:9 보다 좁아 **위아래**가 잘립니다. 두 문장이 다 검사돼야 한쪽을 고칠 때 다른 쪽이 조용히 틀리지
   * 않습니다.
   */
  it("names the edge that is actually cut, on both reel shapes", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    renderScreen(mergeFetch, { scenes: sixScenes() });
    const vertical = await screen.findByTestId("merge-frame-fit");
    expect(vertical.textContent).toContain("좌우 가장자리");
    expect(vertical.textContent).not.toContain("위아래 가장자리");
  });

  it("names the top and bottom on a landscape reel", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    renderScreen(mergeFetch, { scenes: sixScenes(), aspectRatio: "16:9" });
    const horizontal = await screen.findByTestId("merge-frame-fit");
    expect(horizontal.textContent).toContain("위아래 가장자리");
    expect(horizontal.textContent).not.toContain("좌우 가장자리");
  });

  /**
   * 🔴 띠를 만드는 것은 **설정이 아니라 이미 만들어진 클립**입니다. 2026-09-13 에 확인 화면의 설정을 읽고 이
   * 릴이 무엇으로 나갔는지 틀리게 보고한 일이 있었고(CLI Round 809), 그래서 이 문장은 `VideoReview.model` —
   * 작업 기록의 모델 — 에서만 나옵니다. 설정을 아무리 바꿔도 이 줄은 안 바뀝니다.
   */
  it("names the model that actually made the clips, and whether that leaves bars", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const scenes = sixScenes();
    const madeWithH3 = Object.fromEntries(scenes.map((scene) => [scene.number, "h3_max_768p"]));
    renderScreen(mergeFetch, { scenes }, undefined, undefined, undefined, undefined, madeWithH3);

    const note = await screen.findByTestId("merge-frame-fit-clip-models");
    expect(note.textContent).toContain("MiniMax H3 Max (768p)");
    expect(note.textContent).toContain("띠가 남습니다");
  });

  /**
   * 🔴 「확인 안 됨」은 「틀과 다름」이 아닙니다. `h3_max_480p` 는 안 재 봤고(그래서 `unconfirmed`), 그 릴에
   * 「띠가 남습니다」라고 말하면 근거 없는 단정입니다 — 경고 쪽으로 틀린 것이라 해는 작지만, 이 저장소가
   * 세 값을 만든 이유가 그 단정을 안 하기 위해서였습니다. 보내기 전 화면은 이미 「생깁니다 / 생길 수
   * 있습니다」로 가르고 있어서, 여기서 접으면 **같은 릴에 대해 두 화면의 확신이 달라집니다.**
   *
   * 「남을 수 있습니다」가 있다는 것만으로는 부족합니다 — 두 문장을 다 넣어 둔 코드도 통과하니, 단정하는
   * 쪽이 **없다**는 것까지 같이 봅니다.
   */
  it("does not claim bars for a model whose shape was never measured", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const scenes = sixScenes();
    const madeWith480 = Object.fromEntries(scenes.map((scene) => [scene.number, "h3_max_480p"]));
    renderScreen(mergeFetch, { scenes }, undefined, undefined, undefined, undefined, madeWith480);

    const note = await screen.findByTestId("merge-frame-fit-clip-models");
    expect(note.textContent).toContain("확인되지 않았습니다");
    expect(note.textContent).toContain("띠가 남을 수 있습니다");
    expect(note.textContent, "안 재 본 모델에 대해 단정하지 않습니다").not.toContain("띠가 남습니다");
  });

  it("says there is nothing to fix when the clips already match the reel", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const scenes = sixScenes();
    const madeWithSeedance = Object.fromEntries(scenes.map((scene) => [scene.number, "seedance2_720p"]));
    renderScreen(mergeFetch, { scenes }, undefined, undefined, undefined, undefined, madeWithSeedance);

    const note = await screen.findByTestId("merge-frame-fit-clip-models");
    expect(note.textContent).toContain("어느 쪽을 골라도 띠가 없습니다");
  });

  /** 설정을 바꾼 뒤 일부 장면만 다시 만들면 한 릴 안에 모양이 다른 클립이 섞입니다 — 지어낸 경우가 아닙니다. */
  it("says so when one reel holds clips from two different models", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const scenes = sixScenes();
    const mixed = Object.fromEntries(scenes.map((scene) => [scene.number, scene.number === 1 ? "seedance2_720p" : "h3_max_768p"]));
    renderScreen(mergeFetch, { scenes }, undefined, undefined, undefined, undefined, mixed);

    const note = await screen.findByTestId("merge-frame-fit-clip-models");
    expect(note.textContent).toContain("서로 다른 모델");
    expect(note.textContent).toContain("일부 클립에만");
  });

  /** 🔴 모르는 이름의 모양을 아는 척하느니 아무 말도 안 합니다. 가짜 실행 모드에는 모델 자체가 없습니다. */
  it("stays silent when no provider model is recorded", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    renderScreen(mergeFetch, { scenes: sixScenes() });

    await screen.findByTestId("merge-frame-fit");
    expect(screen.queryByTestId("merge-frame-fit-clip-models")).toBeNull();
  });

  /**
   * 🔴 잰 값이 모델 표를 이겨야 합니다. 모델 표는 「이 모델이면 이렇게 될 것이다」이고 `clip` 은 「이 파일이
   * 이렇다」입니다 — 둘이 갈리면 파일이 맞습니다. 두 짝이 **반대 방향으로** 그걸 봅니다: 하나는 모델 표라면
   * 「띠 없음」이라 할 상황에서 잰 값이 띠를 말하고, 다른 하나는 그 반대입니다. 한 방향만 보면 잰 값을 아예
   * 안 읽는 코드도 절반은 통과합니다.
   *
   * 768×1152 는 2:3 이고 세로 릴 틀은 9:16 이라, 실제로 꽃말_버즘나무가 띠를 얻은 그 숫자입니다.
   */
  it("trusts the measured clip over the model table — when the file has bars and the model says it would not", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const scenes = sixScenes();
    // Seedance 는 비율을 받는 모델이라 모델 표만 보면 「띠가 없습니다」가 나옵니다.
    const models = Object.fromEntries(scenes.map((scene) => [scene.number, "seedance2_720p"]));
    const facts = Object.fromEntries(scenes.map((scene) => [scene.number, { width: 768, height: 1152, hasAudio: false }]));
    renderScreen(mergeFetch, { scenes }, undefined, undefined, undefined, undefined, models, facts);

    const note = await screen.findByTestId("merge-frame-fit-clip-models");
    expect(note.textContent).toContain("768×1152");
    expect(note.textContent).toContain("띠가 남습니다");
    expect(note.textContent, "모델 표를 읽었다면 나왔을 문장").not.toContain("어느 쪽을 골라도 띠가 없습니다");
  });

  it("trusts the measured clip over the model table — when the file is fine and the model says it would not be", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const scenes = sixScenes();
    // H3 768p 는 측정으로 follows_first_frame — 모델 표만 보면 「띠가 남습니다」입니다.
    const models = Object.fromEntries(scenes.map((scene) => [scene.number, "h3_max_768p"]));
    const facts = Object.fromEntries(scenes.map((scene) => [scene.number, { width: 1080, height: 1920, hasAudio: false }]));
    renderScreen(mergeFetch, { scenes }, undefined, undefined, undefined, undefined, models, facts);

    const note = await screen.findByTestId("merge-frame-fit-clip-models");
    expect(note.textContent).toContain("1080×1920");
    expect(note.textContent).toContain("어느 쪽을 골라도 띠가 없습니다");
    expect(note.textContent).not.toContain("띠가 남습니다");
  });

  /**
   * 🔴 잰 것만 보고 전체를 말하면 안 됩니다. 파일 하나가 깨졌거나 ffprobe 가 한 번 실패하면 여섯 중 다섯만
   * 재지는데, 그 다섯이 다 맞는다고 「어느 쪽을 골라도 띠가 없습니다」라고 하면 **여섯째에 대해 아는 척**하는
   * 것입니다. 잰 값이 모델 표를 이기는 이유가 「짐작이 아니라서」인데, 여기서 짐작으로 돌아가면 그 이유가
   * 무너집니다.
   *
   * 안심시키는 방향의 단정이라 해가 특히 큽니다 — 사람은 「여백 두기」를 그대로 두고 띠가 붙은 릴을 받습니다.
   */
  it("does not promise a clean frame for clips it could not measure", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const scenes = sixScenes();
    // 여섯 중 다섯만 재졌고, 잰 다섯은 전부 릴 틀과 같은 모양입니다.
    const facts = Object.fromEntries(
      scenes.filter((scene) => scene.number !== 6).map((scene) => [scene.number, { width: 1080, height: 1920, hasAudio: false }]),
    );
    renderScreen(mergeFetch, { scenes }, undefined, undefined, undefined, undefined, undefined, facts);

    const note = await screen.findByTestId("merge-frame-fit-clip-models");
    expect(note.textContent).toContain("잰 클립 5개");
    expect(note.textContent).toContain("나머지 1개는 재지 못했습니다");
    expect(note.textContent).toContain("띠가 남을 수 있습니다");
    expect(note.textContent, "모르는 한 장면에 대해 약속하지 않습니다").not.toContain("어느 쪽을 골라도 띠가 없습니다");
  });

  /** 설정을 바꾼 뒤 일부 장면만 다시 만들면 한 릴 안에 크기가 다른 클립이 섞입니다. */
  it("says when only some of the measured clips will get bars", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const scenes = sixScenes();
    const facts = Object.fromEntries(scenes.map((scene) => [
      scene.number,
      scene.number === 1 ? { width: 1080, height: 1920, hasAudio: false } : { width: 768, height: 1152, hasAudio: false },
    ]));
    renderScreen(mergeFetch, { scenes }, undefined, undefined, undefined, undefined, undefined, facts);

    const note = await screen.findByTestId("merge-frame-fit-clip-models");
    expect(note.textContent).toContain("섞여 있습니다");
    expect(note.textContent).toContain("일부 클립에만");
  });

  /**
   * 🔴 소리가 있다는 것은 이제 **잰 사실**입니다. 그리고 이 앱은 그 소리를 한 번도 쓰지 않습니다 — 병합이
   * 화면만 가져오고 소리는 새로 붙이니까요. 소리 되는 모델에 더 내고 그 소리를 버리는 일이 이 화면에서
   * 보이지 않으면 사람은 그걸 모릅니다. 소리가 없는 릴에서는 이 줄이 **없어야** 합니다.
   */
  // (Since B3-a the line introduces the clip-sound level: 0% drops it, as every merge did before.)
  it("says the clips carry sound and what 0% does with it, and only when they do", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const scenes = sixScenes();
    const withSound = Object.fromEntries(scenes.map((scene) => [scene.number, { width: 768, height: 1152, hasAudio: true }]));
    const first = renderScreen(mergeFetch, { scenes }, undefined, undefined, undefined, undefined, undefined, withSound);
    const line = await screen.findByTestId("merge-clip-audio");
    expect(line.textContent).toContain("6개에 소리가 들어 있습니다");
    expect(line.textContent).toContain("0%면 버리고");
    first.render.unmount();

    const silent = Object.fromEntries(scenes.map((scene) => [scene.number, { width: 768, height: 1152, hasAudio: false }]));
    renderScreen(mergeFetch, { scenes }, undefined, undefined, undefined, undefined, undefined, silent);
    await screen.findByTestId("merge-frame-fit");
    expect(screen.queryByTestId("merge-clip-audio")).toBeNull();
  });

  /**
   * 🔴 이 화면에 층이 하나 생겼습니다 — 클립 자체 소리. 그런데 버튼 글자는 모드 하나만 읽고 있었고, 그대로
   * 두면 **「무음으로 병합」을 누르고 소리 있는 릴이 나옵니다.** 오늘 하루 고친 것이 전부 「글자가 참이 아닌
   * 자리」라, 층을 얹으면서 같은 것을 새로 만들 수는 없습니다.
   *
   * 0%일 때 옛 글자가 그대로인 것도 같이 봅니다 — 「무음」이 사라지면 이번엔 반대쪽이 거짓말입니다.
   */
  /**
   * 🔴 「나레이션만 + 영상 소리로 병합」은 자기 안에서 부딪힙니다 — 「만」은 「이것 하나뿐」인데 바로 옆에
   * 「+」가 붙습니다(CLI Round 826). 버튼이 자기가 무슨 일을 하는지 두 가지로 말하면, 그건 아무 말도 안 한
   * 것과 같습니다.
   *
   * 0% 일 때 「나레이션만으로 병합」이 **그대로**인 것도 같이 봅니다 — 「만」을 아예 없애면 이번엔 그쪽이
   * 거짓말입니다(나레이션만 들어가는 게 맞으니까요).
   */
  it("drops 만 only when something is actually added to the narration", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const scenes = sixScenes();
    const withSound = Object.fromEntries(scenes.map((scene) => [scene.number, { width: 768, height: 1152, hasAudio: true }]));
    renderScreen(
      mergeFetch,
      { scenes, narrationAvailable: true },
      { narrationEnabled: true, subtitlesEnabled: false },
      undefined, undefined, undefined, undefined, withSound,
    );

    const button = await screen.findByTestId("open-merge-confirm-button");
    expect(button.textContent, "나레이션만 들어가는 동안은 「만」이 맞습니다").toBe("나레이션만으로 병합");

    fireEvent.change(screen.getByLabelText("섞는 음량"), { target: { value: "30" } });
    expect(button.textContent).toBe("나레이션 + 영상 소리로 병합");
    expect(button.textContent, "「만」과 「+」가 같이 있으면 안 됩니다").not.toContain("만 +");
  });

  it("never says 무음 when the clips' own sound is going in", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const scenes = sixScenes();
    const withSound = Object.fromEntries(scenes.map((scene) => [scene.number, { width: 768, height: 1152, hasAudio: true }]));
    renderScreen(mergeFetch, { scenes }, undefined, undefined, undefined, undefined, undefined, withSound);

    const button = await screen.findByTestId("open-merge-confirm-button");
    // 기본은 0% — 나레이션이 없는 프로젝트라 모드는 「무음」이고, 글자도 그대로여야 합니다.
    expect(button.textContent).toBe("무음으로 병합");

    fireEvent.change(screen.getByLabelText("섞는 음량"), { target: { value: "40" } });
    expect(button.textContent, "소리가 들어가는데 「무음」이라고 하면 안 됩니다").toBe("영상 소리로 병합");
    expect(button.textContent).not.toContain("무음");
  });

  /**
   * 🔴 0% 는 **안 보냅니다.** 계약이 「생략·0 = 오늘과 같음」이니 결과는 같고, 안 보내면 오늘까지의 요청이
   * 바이트 그대로입니다 — 이 파일의 다른 짝들이 본문을 통째로 비교하고 있어서 `frameFit` 때와 같은 규칙입니다.
   */
  it("sends the clip volume only once someone raises it", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const scenes = sixScenes();
    const withSound = Object.fromEntries(scenes.map((scene) => [scene.number, { width: 768, height: 1152, hasAudio: true }]));
    const { render: first } = renderScreen(mergeFetch, { scenes }, undefined, undefined, undefined, undefined, undefined, withSound);

    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
    fireEvent.click(await screen.findByTestId("confirm-merge-button"));
    await waitFor(() => expect(mergeFetch).toHaveBeenCalled());
    expect(JSON.parse(String((mergeFetch.mock.calls[0] as [string, RequestInit])[1].body)).audio)
      .toEqual({ mode: "silent" });
    first.unmount();

    const second = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    renderScreen(second, { scenes }, undefined, undefined, undefined, undefined, undefined, withSound);
    fireEvent.change(await screen.findByLabelText("섞는 음량"), { target: { value: "40" } });
    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    fireEvent.click(await screen.findByTestId("confirm-merge-button"));
    await waitFor(() => expect(second).toHaveBeenCalled());
    expect(JSON.parse(String((second.mock.calls[0] as [string, RequestInit])[1].body)).audio)
      .toEqual({ mode: "silent", clipVolume: 0.4 });
  });

  /** 소리가 들어 있는 클립이 하나도 없으면 칸 자체가 없습니다 — 아무것도 못 하는 칸은 눌러 보게 만듭니다. */
  it("offers no clip-sound control when no clip carries sound", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const scenes = sixScenes();
    const silent = Object.fromEntries(scenes.map((scene) => [scene.number, { width: 768, height: 1152, hasAudio: false }]));
    renderScreen(mergeFetch, { scenes }, undefined, undefined, undefined, undefined, undefined, silent);

    await screen.findByTestId("merge-frame-fit");
    expect(screen.queryByTestId("merge-clip-audio")).toBeNull();
  });

  /**
   * 🔴 완성본이 무엇으로 만들어졌는지는 **기록**이 답합니다. 다시 만들면 화면의 칸은 초기화되지만 이미 만든
   * 영상은 그대로라, 「이 영상에 클립 소리가 들어 있나」를 화면 상태로 답하면 틀립니다.
   */
  it("reads what the finished merge actually used, from the record", async () => {
    const withClipSound = makeResponse({
      project: makeProject({ scenes: sixScenes(), usedAudio: { mode: "silent", clipVolume: 0.4 } }),
    });
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, withClipSound));
    renderScreen(mergeFetch, { scenes: sixScenes() });

    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
    fireEvent.click(await screen.findByTestId("confirm-merge-button"));

    const line = await screen.findByTestId("merge-used-clip-audio");
    expect(line.textContent).toContain("40%");
  });

  it("sends a photo card's adjusted subtitle layout with the merge", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const still: Scene[] = [{ number: 1, script: "", motionPrompt: "", narration: "불광불급(不狂不及)\n미치도록 몰입한 사람만이," }];
    renderScreen(mergeFetch, { photoCard: true, scenes: still, subtitleLayout: { scale: 0.027, center: 0.4 } }, undefined, undefined, []);

    const center = await screen.findByTestId("photo-card-subtitle-center");
    fireEvent.change(center, { target: { value: "0.55" } });
    expect(screen.getByTestId("photo-card-subtitle-center-value").textContent).toContain("55%");

    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    fireEvent.click(await screen.findByTestId("confirm-merge-button"));

    await waitFor(() => expect(mergeFetch).toHaveBeenCalled());
    const [, init] = mergeFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ audio: { mode: "silent" }, subtitleLayout: { scale: 0.027, center: 0.55 } });
  });

  /**
   * The same control for an ordinary reel, which is where 캡틴D found the problem.
   *
   * The scene subtitle sat in the bottom 13% of the frame with a 3px stroke — the two things the photo card had
   * already been moved off, for reasons written into PHOTO_CARD_SUBTITLE_CENTER and _OUTLINE, and which the
   * scene branch never received. A fixed better position was not enough: a scene is moving footage, so the
   * place that clears Reels' own interface on one shot covers the subject on the next.
   */
  it("offers the scene subtitle control and sends its numbers with the merge", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const narrated: Scene[] = [
      { number: 1, script: "", motionPrompt: "", narration: "빨간 장미의 꽃말은 열렬한 사랑입니다." },
      { number: 2, script: "", motionPrompt: "", narration: "붉은 색과 장미가 사랑의 여신과 이어졌다는 이야기가 전해집니다." },
    ];
    renderScreen(mergeFetch, { scenes: narrated }, { narrationEnabled: false, subtitlesEnabled: true });

    const center = await screen.findByTestId("scene-subtitle-center");
    // Every scene that carries a line gets a chip, because the layout is one setting for all of them and the
    // longest sentence is the one that runs off the frame.
    expect(screen.getByTestId("scene-subtitle-scene-1")).toBeTruthy();
    expect(screen.getByTestId("scene-subtitle-scene-2")).toBeTruthy();

    fireEvent.change(center, { target: { value: "0.62" } });
    expect(screen.getByTestId("scene-subtitle-center-value").textContent).toContain("62%");
    fireEvent.change(screen.getByTestId("scene-subtitle-scale"), { target: { value: "0.04" } });

    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    fireEvent.click(await screen.findByTestId("confirm-merge-button"));

    await waitFor(() => expect(mergeFetch).toHaveBeenCalled());
    const [, init] = mergeFetch.mock.calls[0] as [string, RequestInit];
    // 🔴 Its own field, never the card's. The two layouts are the same SHAPE and different numbers — a card
    // centres at 0.40, a scene at 0.78 — so one field carrying both would type-check while putting a scene's
    // subtitle in the middle of moving footage.
    expect(JSON.parse(String(init.body))).toEqual({ audio: { mode: "silent" }, sceneSubtitleLayout: { scale: 0.04, center: 0.62 } });
  });

  /**
   * 🔴 No text burned in, no numbers sent.
   *
   * A project with subtitles turned off still carries the narration text it will not draw, so "has narration"
   * is the wrong question. Storing a chosen position for something that never appeared would put a value on
   * the project that no video was ever made with, which is the one promise the stored layout makes.
   */
  it("neither offers nor sends a scene layout when the merge burns in no subtitles", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const narrated: Scene[] = [{ number: 1, script: "", motionPrompt: "", narration: "문장은 있지만 자막은 꺼져 있습니다." }];
    renderScreen(mergeFetch, { scenes: narrated }, { narrationEnabled: true, subtitlesEnabled: false });

    await screen.findByTestId("open-merge-confirm-button");
    expect(screen.queryByTestId("scene-subtitle-center")).toBeNull();

    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    fireEvent.click(await screen.findByTestId("confirm-merge-button"));
    await waitFor(() => expect(mergeFetch).toHaveBeenCalled());
    const [, init] = mergeFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("sceneSubtitleLayout");
  });

  /** Starts from what this reel was last merged with, for the reason the card's own test gives. */
  it("starts a reel from the scene layout the server sent back", async () => {
    const narrated: Scene[] = [{ number: 1, script: "", motionPrompt: "", narration: "문장" }];
    renderScreen(vi.fn(), { scenes: narrated, sceneSubtitleLayout: { scale: 0.045, center: 0.5 } }, { narrationEnabled: false, subtitlesEnabled: true });

    expect((await screen.findByTestId("scene-subtitle-center")).getAttribute("value")).toBe("0.5");
    expect(screen.getByTestId("scene-subtitle-scale-value").textContent).toContain("86px");
  });

  // Starts from what this card was last merged with, not from the published default — otherwise every revisit
  // silently proposes undoing the adjustment the person already made.
  it("starts a photo card from the layout the server sent back", async () => {
    const still: Scene[] = [{ number: 1, script: "", motionPrompt: "", narration: "문장" }];
    renderScreen(vi.fn(), { photoCard: true, scenes: still, subtitleLayout: { scale: 0.041, center: 0.62 } }, undefined, undefined, []);

    expect((await screen.findByTestId("photo-card-subtitle-scale-value")).textContent).toContain("79px");
    expect(screen.getByTestId("photo-card-subtitle-center-value").textContent).toContain("62%");
  });

  /**
   * Finding out the text sits too low happens by watching the finished video — which is this screen.
   *
   * A card had no way back: merged once, Completed forever, and the only remedy was building a new card under
   * a new name with the same picture and the same line. Nothing was being protected by that — a card has no
   * paid clips behind it and the old file is archived on the way out (CLI Round 441).
   */
  it("lets a finished photo card be made again with different subtitles", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const still: Scene[] = [{ number: 1, script: "", motionPrompt: "", narration: "불광불급(不狂不及)\n미치도록 몰입한 사람만이," }];
    renderScreen(mergeFetch, { photoCard: true, scenes: still, workflowState: WorkflowState.Completed, finalVideoPath: "videos/final/instagram_reel.mp4" }, undefined, undefined, []);

    await screen.findByTestId("merge-success");
    expect(screen.queryByTestId("photo-card-subtitle-preview")).toBeNull();

    fireEvent.click(screen.getByTestId("photo-card-remake"));
    fireEvent.change(await screen.findByTestId("photo-card-subtitle-center"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    fireEvent.click(await screen.findByTestId("confirm-merge-button"));

    await waitFor(() => expect(mergeFetch).toHaveBeenCalled());
    const [, init] = mergeFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ audio: { mode: "silent" }, subtitleLayout: { scale: 0.027, center: 0.5 } });
  });

  // The one card that must not be remade. Replacing the file would leave the Instagram post pointing at a
  // video nobody published, and neither side would record that it had changed.
  it("refuses to remake a card that is already published, and says what to do instead", async () => {
    const still: Scene[] = [{ number: 1, script: "", motionPrompt: "", narration: "문장" }];
    renderScreen(vi.fn(), {
      photoCard: true, scenes: still, workflowState: WorkflowState.Completed, finalVideoPath: "videos/final/instagram_reel.mp4",
      instagramPost: { mediaId: "m1", igUserId: "1", publishedAt: "2026-09-02T00:00:00.000Z", caption: "" },
    });

    await screen.findByTestId("merge-success");
    expect(screen.queryByTestId("photo-card-remake")).toBeNull();
    expect((screen.getByTestId("photo-card-remake-published")).textContent).toContain("새 이름");
  });

  // An ordinary finished project keeps its one-way door: there are paid clips behind that file.
  it("offers no remake on an ordinary finished project", async () => {
    renderScreen(vi.fn(), { workflowState: WorkflowState.Completed, finalVideoPath: "videos/final/instagram_reel.mp4" });

    await screen.findByTestId("merge-success");
    expect(screen.queryByTestId("photo-card-remake")).toBeNull();
  });

  // An ordinary project has no card text to place, and the server refuses the field for one. Showing controls
  // that cannot be sent would be an offer the merge would reject.
  it("shows no subtitle controls for an ordinary project", async () => {
    renderScreen(vi.fn());

    await screen.findByTestId("merge-approved-count");
    expect(screen.queryByTestId("photo-card-subtitle-preview")).toBeNull();
  });

  // The other half: an ordinary project keeps its gate. Unblocking the card must not unblock everything.
  it("still blocks an ordinary project with an unconfirmed scene", async () => {
    const mergeFetch = vi.fn();
    renderScreen(mergeFetch, { scenes: sixScenes() }, undefined, undefined, [1, 2, 3, 4, 5]);

    expect((await screen.findByTestId("merge-blocked")).textContent).toContain("1개");
    expect(screen.getByTestId("open-merge-confirm-button")).toBeDisabled();
  });

  it("counts only the confirmed scenes, and does not block once they all are", async () => {
    const mergeFetch = vi.fn();
    renderScreen(mergeFetch);

    expect((await screen.findByTestId("merge-approved-count")).textContent).toContain("6개 확정됨");
    expect(screen.queryByTestId("merge-blocked")).toBeNull();
    expect(screen.getByTestId("open-merge-confirm-button")).not.toBeDisabled();
  });

  /**
   * A song is longer than a Reel, so the part someone wants is rarely the first thirty seconds.
   *
   * The position is taken from the player rather than typed, for the same reason the cover frame is: nobody can
   * say which second of a two-minute track is the good one without hearing it. Zero is not sent — it is what the
   * server does anyway, and a number that says nothing would later read as a choice someone made.
   */
  it("sends the music start point taken from the player", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    renderScreen(mergeFetch, { narrationAvailable: false }, { narrationEnabled: false, subtitlesEnabled: false }, [makeTrack({ durationSeconds: 128.4 })]);

    fireEvent.click(await screen.findByTestId("merge-audio-bgm"));
    fireEvent.change(screen.getByTestId("merge-audio-track"), { target: { value: "t1" } });

    const player = await screen.findByTestId("merge-audio-start-player");
    Object.defineProperty(player, "currentTime", { value: 42.5, configurable: true });
    fireEvent.click(screen.getByTestId("merge-audio-start-set"));
    expect(screen.getByTestId("merge-audio-start-at").textContent).toContain("0:42");

    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    fireEvent.click(await screen.findByTestId("confirm-merge-button"));

    await waitFor(() => expect(mergeFetch).toHaveBeenCalled());
    const [, init] = mergeFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ audio: { mode: "bgm", trackId: "t1", startSeconds: 42.5 } });
  });

  // The start belongs to the track it was heard in. Carrying it over would apply "1분 20초" to a song that may
  // be a minute long, and the server would refuse a merge nobody meant to ask for.
  it("forgets the start point when a different track is chosen", async () => {
    renderScreen(vi.fn(), { narrationAvailable: false }, { narrationEnabled: false, subtitlesEnabled: false }, [
      makeTrack({ durationSeconds: 128.4 }),
      makeTrack({ trackId: "t2", title: "짧은 곡", durationSeconds: 40 }),
    ]);

    fireEvent.click(await screen.findByTestId("merge-audio-bgm"));
    fireEvent.change(screen.getByTestId("merge-audio-track"), { target: { value: "t1" } });
    const player = await screen.findByTestId("merge-audio-start-player");
    Object.defineProperty(player, "currentTime", { value: 80, configurable: true });
    fireEvent.click(screen.getByTestId("merge-audio-start-set"));
    expect(screen.getByTestId("merge-audio-start-at")).toBeTruthy();

    fireEvent.change(screen.getByTestId("merge-audio-track"), { target: { value: "t2" } });
    expect(await screen.findByTestId("merge-audio-start-unset")).toBeTruthy();
  });

  // The server refuses a start at or past the end; refusing it here first keeps that from being discovered by
  // pressing merge and reading an error about a choice already made.
  //
  // 캡틴D pressed 「여기부터」 and reported it dead. Both guards were correct and completely silent, so a refused
  // press and a broken button look exactly alike from the outside — the refusal has to say which one it is.
  it("will not take a position at or past the end of the track, and says why", async () => {
    renderScreen(vi.fn(), { narrationAvailable: false }, { narrationEnabled: false, subtitlesEnabled: false }, [makeTrack({ durationSeconds: 40 })]);

    fireEvent.click(await screen.findByTestId("merge-audio-bgm"));
    fireEvent.change(screen.getByTestId("merge-audio-track"), { target: { value: "t1" } });
    const player = await screen.findByTestId("merge-audio-start-player");
    Object.defineProperty(player, "currentTime", { value: 40, configurable: true });
    fireEvent.click(screen.getByTestId("merge-audio-start-set"));

    expect(screen.getByTestId("merge-audio-start-unset")).toBeTruthy();
    expect(screen.getByTestId("merge-audio-start-refused").textContent).toContain("0:40");
  });

  it("says so when the position could not be read at all, instead of doing nothing", async () => {
    renderScreen(vi.fn(), { narrationAvailable: false }, { narrationEnabled: false, subtitlesEnabled: false }, [makeTrack({ durationSeconds: 40 })]);

    fireEvent.click(await screen.findByTestId("merge-audio-bgm"));
    fireEvent.change(screen.getByTestId("merge-audio-track"), { target: { value: "t1" } });
    const player = await screen.findByTestId("merge-audio-start-player");
    // What a browser reports before it has measured the track — never recorded as "the beginning".
    Object.defineProperty(player, "currentTime", { value: Number.NaN, configurable: true });
    fireEvent.click(screen.getByTestId("merge-audio-start-set"));

    expect(screen.getByTestId("merge-audio-start-unset")).toBeTruthy();
    expect(screen.getByTestId("merge-audio-start-refused")).toBeTruthy();
  });

  // A press that succeeds must clear whatever the last refusal said, or the reason outlives the problem.
  it("clears the refusal once a position is accepted", async () => {
    renderScreen(vi.fn(), { narrationAvailable: false }, { narrationEnabled: false, subtitlesEnabled: false }, [makeTrack({ durationSeconds: 40 })]);

    fireEvent.click(await screen.findByTestId("merge-audio-bgm"));
    fireEvent.change(screen.getByTestId("merge-audio-track"), { target: { value: "t1" } });
    const player = await screen.findByTestId("merge-audio-start-player");
    Object.defineProperty(player, "currentTime", { value: 40, configurable: true });
    fireEvent.click(screen.getByTestId("merge-audio-start-set"));
    expect(screen.getByTestId("merge-audio-start-refused")).toBeTruthy();

    Object.defineProperty(player, "currentTime", { value: 12, configurable: true });
    fireEvent.click(screen.getByTestId("merge-audio-start-set"));
    expect(screen.queryByTestId("merge-audio-start-refused")).toBeNull();
    expect(screen.getByTestId("merge-audio-start-at").textContent).toContain("0:12");
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

  it("keeps this project selected when moving from its finished video to post preparation", async () => {
    const openPostPreparation = vi.fn();
    renderScreen(vi.fn(), { workflowState: WorkflowState.Completed, finalVideoPath: "videos/final/instagram_reel.mp4" }, undefined, [], undefined, openPostPreparation);

    fireEvent.click(await screen.findByTestId("open-instagram-post"));

    expect(openPostPreparation).toHaveBeenCalledWith("sample_project");
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
    // Cache-busted by the project's own updatedAt: the address is otherwise identical after a re-merge, and the
    // browser happily replays the previous cut — which reads as "the merge did nothing".
    const src = screen.getByTestId("final-video-player").getAttribute("src") ?? "";
    expect(src.startsWith("/projects/sample_project/videos/final/content?v=")).toBe(true);
    // And specifically from the project's updatedAt — any constant would also satisfy the line above while
    // pinning the address across the re-merge it exists to defeat.
    expect(src).toContain(encodeURIComponent("2026-08-21T00:00:00.000Z"));
    expect(screen.queryByTestId("open-in-explorer-button")).toBeNull();
  });

  /**
   * The merge can report success over a file the player cannot open — an empty scene clip carried through the
   * concat produces one. The screen used to leave a silent black rectangle, which reads as "it worked", so the
   * person went on to publish it. The notice says what to check instead.
   */
  it("says the final video will not play instead of leaving a silent black player", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    renderScreen(mergeFetch);

    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
    await screen.findByTestId("merge-confirm-panel");
    fireEvent.click(screen.getByTestId("confirm-merge-button"));
    await screen.findByTestId("merge-success");

    fireEvent.error(screen.getByTestId("final-video-player"));

    expect((await screen.findByTestId("final-video-missing")).textContent).toContain("재생할 수 없습니다");
    // The dead player goes away with it: two claims about the same file, one of them wrong, is worse than none.
    expect(screen.queryByTestId("final-video-player")).toBeNull();
    // The path stays — it is what the person needs to look at the file themselves.
    expect(screen.getByTestId("final-video-path")).toBeTruthy();
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
