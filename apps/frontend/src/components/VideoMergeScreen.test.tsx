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
   * `videoReview` is required on the contract but the mapper omits it for scenes stored before per-scene review
   * existed, and `undefined !== "approved"` counted all six as unconfirmed. The screen then said 장면 6개 중
   * 0개 확정됨 and 아직 확정하지 않은 장면이 6개 있습니다 — in the same panel where it was printing the finished
   * video's path. A person is sent to go and confirm work the screen has just shown them the result of.
   *
   * The rule the screen already states for this case is "unknown stays unblocked, the server is still the real
   * gate", so the assertions are that the number and the blocker are both absent, not that they read zero.
   */
  it("says nothing about confirmations when no scene carries a review at all", async () => {
    const legacy = sixScenes().map((scene) => {
      const { videoReview: _videoReview, ...rest } = scene;
      return rest as Scene;
    });
    renderScreen(vi.fn(), { workflowState: WorkflowState.Completed, scenes: legacy, finalVideoPath: "videos/final/instagram_reel.mp4" });

    await waitFor(() => expect(screen.getByTestId("merge-scope-notice").textContent).toContain("이어 붙입니다"));
    expect(screen.queryByTestId("merge-approved-count")).toBeNull();
    expect(screen.queryByTestId("merge-blocked")).toBeNull();
    // And the number that was wrong must not reappear anywhere in the panel's own sentence.
    expect(screen.getByTestId("merge-scope-notice").textContent).not.toContain("확정된 0개");
  });

  /**
   * The half that keeps the above from turning into "never count anything": a project whose scenes do answer
   * still gets the count and the blocker.
   */
  it("still counts and blocks when every scene has answered", async () => {
    const partly = sixScenes().map((scene, index) => ({ ...scene, videoReview: index < 4 ? "approved" as const : "pending" as const }));
    renderScreen(vi.fn(), { scenes: partly });

    expect((await screen.findByTestId("merge-approved-count")).textContent).toContain("4개 확정됨");
    expect((await screen.findByTestId("merge-blocked")).textContent).toContain("2개 있습니다");
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
    const partly = sixScenes().map((scene, index) => (index < 4 ? scene : { ...scene, videoReview: "pending" as const }));
    renderScreen(mergeFetch, { scenes: partly });

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
    const still: Scene[] = [{ number: 1, script: "불광불급", imagePrompt: "", motionPrompt: "", imageReview: "approved", videoReview: "pending" }];
    renderScreen(mergeFetch, { photoCard: true, scenes: still });

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
  it("sends a photo card's adjusted subtitle layout with the merge", async () => {
    const mergeFetch = vi.fn().mockResolvedValue(jsonResponse(200, makeResponse()));
    const still: Scene[] = [{ number: 1, script: "", imagePrompt: "", motionPrompt: "", imageReview: "approved", videoReview: "pending", narration: "불광불급(不狂不及)\n미치도록 몰입한 사람만이," }];
    renderScreen(mergeFetch, { photoCard: true, scenes: still, subtitleLayout: { scale: 0.027, center: 0.4 } });

    const center = await screen.findByTestId("photo-card-subtitle-center");
    fireEvent.change(center, { target: { value: "0.55" } });
    expect(screen.getByTestId("photo-card-subtitle-center-value").textContent).toContain("55%");

    fireEvent.click(screen.getByTestId("open-merge-confirm-button"));
    fireEvent.click(await screen.findByTestId("confirm-merge-button"));

    await waitFor(() => expect(mergeFetch).toHaveBeenCalled());
    const [, init] = mergeFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ audio: { mode: "silent" }, subtitleLayout: { scale: 0.027, center: 0.55 } });
  });

  // Starts from what this card was last merged with, not from the published default — otherwise every revisit
  // silently proposes undoing the adjustment the person already made.
  it("starts a photo card from the layout the server sent back", async () => {
    const still: Scene[] = [{ number: 1, script: "", imagePrompt: "", motionPrompt: "", imageReview: "approved", videoReview: "pending", narration: "문장" }];
    renderScreen(vi.fn(), { photoCard: true, scenes: still, subtitleLayout: { scale: 0.041, center: 0.62 } });

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
    const still: Scene[] = [{ number: 1, script: "", imagePrompt: "", motionPrompt: "", imageReview: "approved", videoReview: "pending", narration: "불광불급(不狂不及)\n미치도록 몰입한 사람만이," }];
    renderScreen(mergeFetch, { photoCard: true, scenes: still, workflowState: WorkflowState.Completed, finalVideoPath: "videos/final/instagram_reel.mp4" });

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
    const still: Scene[] = [{ number: 1, script: "", imagePrompt: "", motionPrompt: "", imageReview: "approved", videoReview: "pending", narration: "문장" }];
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
    const partly = sixScenes().map((scene, index) => (index < 5 ? scene : { ...scene, videoReview: "pending" as const }));
    renderScreen(mergeFetch, { scenes: partly });

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
  it("will not take a position at or past the end of the track", async () => {
    renderScreen(vi.fn(), { narrationAvailable: false }, { narrationEnabled: false, subtitlesEnabled: false }, [makeTrack({ durationSeconds: 40 })]);

    fireEvent.click(await screen.findByTestId("merge-audio-bgm"));
    fireEvent.change(screen.getByTestId("merge-audio-track"), { target: { value: "t1" } });
    const player = await screen.findByTestId("merge-audio-start-player");
    Object.defineProperty(player, "currentTime", { value: 40, configurable: true });
    fireEvent.click(screen.getByTestId("merge-audio-start-set"));

    expect(screen.getByTestId("merge-audio-start-unset")).toBeTruthy();
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
