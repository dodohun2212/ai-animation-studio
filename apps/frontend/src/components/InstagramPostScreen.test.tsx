import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Scene } from "@ai-animation-studio/shared";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { InstagramPostScreen } from "./InstagramPostScreen.js";

/** Every required Scene field, plus the one the caption suggestion actually reads. */
function scene(number: number, narration: string): Scene {
  return {
    number: number as Scene["number"],
    script: "",
    motionPrompt: "",
    imageReview: "pending",
    videoReview: "pending",
    narration,
  };
}

const LIBRARY_URL = "/videos/library";

function libraryProject(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "p1",
    topic: "이배드의 탄생",
    updatedAt: "2026-08-26T17:29:37.982Z",
    sceneCount: 6,
    videosReadyCount: 6,
    finalVideoAvailable: true,
    totalActualCostUsd: 1.5,
    aspectRatio: "9:16",
    ...overrides,
  };
}

/**
 * One Episode row in the library. There were no Episode fixtures in this file at all, which is the structural
 * reason capability after capability shipped on the short side only: nothing here could notice.
 */
function libraryEpisode(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "long", episodeNumber: 1, title: "재생", projectTitle: "이배드",
    updatedAt: "2026-08-26T17:29:37.982Z", sceneCount: 6, videosReadyCount: 6,
    finalVideoAvailable: true, totalActualCostUsd: 1.5, aspectRatio: "9:16",
    ...overrides,
  };
}

/** Only durationSeconds matters to this screen; the rest is filler the response type requires. */
function makeSettings(durationSeconds: number) {
  return {
    projectName: "이름", topic: "주제", genre: "장르", mood: "분위기", character: "인물",
    lore: "", fullStory: "", durationSeconds, sceneCount: 6, clipDurationSeconds: 5,
    additionalNotes: "", styleNotes: {}, narrationEnabled: false, subtitlesEnabled: false,
  };
}

/**
 * Routes the three reads this screen makes: the library listing, then — once a project is picked — that
 * project and its settings.
 */
function renderScreen(options: {
  projects?: ReturnType<typeof libraryProject>[];
  project?: Parameters<typeof makeProject>[0];
  durationSeconds?: number | "fails";
  /** "fails" refuses every read; "fails-once" refuses the first and answers the rest — the retry path. */
  draft?: { body?: string; hashtags?: string; aiNotice?: boolean } | "fails" | "fails-once";
  targets?: { targets: { igUserId: string; username: string; pageName: string }[]; selectedIgUserId?: string } | "not-connected";
  publish?: "ok" | "INSTAGRAM_ALREADY_PUBLISHED" | "INSTAGRAM_PUBLISH_FAILED" | "INSTAGRAM_NOT_CONNECTED";
  forget?: "ok" | "not-recorded";
  episodes?: ReturnType<typeof libraryEpisode>[];
  episode?: Record<string, unknown>;
} = {}) {
  const projects = options.projects ?? [libraryProject()];
  let draftReads = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === LIBRARY_URL) return jsonResponse(200, { projects, episodes: options.episodes ?? [] });
    if (url === "/long-projects/long/episodes/1") {
      return jsonResponse(200, { episode: { episodeNumber: 1, title: "재생", summary: "", mainEvent: "", conflict: "", cliffhanger: "", nextEpisodeHook: "", status: "completed", approved: true, scriptRevision: 1, scriptHistoryCount: 1, updatedAt: "2026-08-27T10:00:00.000Z", ...options.episode } });
    }
    if (url === "/long-projects/long/episodes/1/settings") {
      return jsonResponse(200, { settings: { sceneCount: 6, clipDurationSeconds: 5, episodeDurationSeconds: 30 }, changeable: true, projectDefaults: { sceneCount: 6, clipDurationSeconds: 5 } });
    }
    if (url === "/long-projects/long/settings") {
      return jsonResponse(200, { settings: { ...makeSettings(30), aspectRatio: "9:16" } });
    }
    if (url === "/projects/p1") return jsonResponse(200, { project: makeProject({ id: "p1", ...options.project }) });
    if (url === "/projects/p1/settings") {
      if (options.durationSeconds === "fails") return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "raw" });
      return jsonResponse(200, { settings: makeSettings(options.durationSeconds ?? 30), sceneCountChangeable: true, aspectRatioChangeable: true });
    }
    if (url === "/projects/p1/instagram/publish") {
      if (options.publish && options.publish !== "ok") {
        return jsonResponse(409, { code: options.publish, message: "raw backend detail" });
      }
      return jsonResponse(200, {
        mediaId: "media_1",
        publishedAt: "2026-08-27T10:00:00.000Z",
        project: makeProject({ id: "p1", ...options.project, instagramPost: { mediaId: "media_1", igUserId: "1", publishedAt: "2026-08-27T10:00:00.000Z", caption: "이전 캡션" } }),
      });
    }
    if (url === "/settings/instagram/targets" || url === "/settings/instagram/target") {
      if (options.targets === "not-connected") {
        return jsonResponse(409, { code: "INSTAGRAM_NOT_CONNECTED", message: "raw backend detail" });
      }
      return jsonResponse(200, options.targets ?? { targets: [] });
    }
    if (url === "/projects/p1/instagram/post") {
      if (options.forget === "not-recorded") return jsonResponse(409, { code: "INSTAGRAM_POST_NOT_RECORDED", message: "raw backend detail" });
      return jsonResponse(200, { project: makeProject({ id: "p1", ...options.project, instagramPost: undefined }) });
    }
    if (url === "/projects/p1/post-draft") {
      if (options.draft === "fails") return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "raw" });
      if (options.draft === "fails-once") {
        if (draftReads++ === 0) return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "raw" });
        return jsonResponse(200, { body: "저장돼 있던 본문", hashtags: "태그", aiNotice: true });
      }
      return jsonResponse(200, options.draft ?? {});
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, ...render(<InstagramPostScreen onBack={() => {}} />) };
}

async function pickProject() {
  fireEvent.change(await screen.findByTestId("post-project"), { target: { value: "p1" } });
  return screen.findByTestId("post-checks");
}

/** Swaps in a clipboard for one test and puts the real descriptor back afterwards. */
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

describe("InstagramPostScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says up front that the account is confirmed before anything goes out", async () => {
    renderScreen();
    const notice = await screen.findByTestId("post-scope-notice");
    expect(notice.textContent).toContain("어느 계정으로 나가는지");
  });

  // A project with no merged result has nothing to post, so offering it would be a dead choice.
  it("offers only projects that have a merged final video", async () => {
    renderScreen({
      projects: [libraryProject(), libraryProject({ projectId: "p2", topic: "미완성", finalVideoAvailable: false })],
    });

    const select = await screen.findByTestId("post-project");
    expect(select.textContent).toContain("이배드의 탄생");
    expect(select.textContent).not.toContain("미완성");
  });

  it("says so when nothing has been merged yet", async () => {
    renderScreen({ projects: [] });
    expect(await screen.findByTestId("post-empty")).toBeTruthy();
    expect(screen.queryByTestId("post-project")).toBeNull();
  });

  it("composes body, AI notice and hashtags into one caption and counts what it will actually copy", async () => {
    renderScreen();
    await pickProject();

    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "기록관의 밤" } });
    // No "#" required — the person is listing topics, not writing markup.
    fireEvent.change(screen.getByTestId("post-hashtags"), { target: { value: "애니메이션, ai영상 #단편" } });

    const caption = screen.getByTestId("post-caption-preview").textContent ?? "";
    expect(caption).toContain("기록관의 밤");
    expect(caption).toContain("#애니메이션 #ai영상 #단편");
    expect(caption).toContain("AI로 만든 영상입니다.");
    expect(screen.getByTestId("post-caption-count").textContent).toContain(`${caption.length}/2200`);
    expect(screen.getByTestId("post-hashtag-count").textContent).toContain("3/30");
  });

  it("blocks the copy when the caption is past Instagram's own limit", async () => {
    renderScreen();
    await pickProject();

    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "가".repeat(2201) } });

    expect(screen.getByTestId("post-caption-count").textContent).toContain("한도를 넘었");
    expect(screen.getByTestId("post-copy")).toBeDisabled();
  });

  it("blocks the copy past 30 hashtags", async () => {
    renderScreen();
    await pickProject();

    fireEvent.change(screen.getByTestId("post-hashtags"), {
      target: { value: Array.from({ length: 31 }, (_, index) => `태그${index}`).join(" ") },
    });

    expect(screen.getByTestId("post-hashtag-count").textContent).toContain("31/30");
    expect(screen.getByTestId("post-copy")).toBeDisabled();
  });

  // 3 minutes is Instagram's reel ceiling; over it the file cannot go up as a reel at all, and finding that
  // out here beats finding it out in the upload sheet.
  it("flags a video past the reel length limit", async () => {
    renderScreen({ durationSeconds: 200 });
    await pickProject();
    expect(screen.getByTestId("post-check-length").textContent).toContain("한도(3분)를 넘습니다");
  });

  it("passes a video inside the reel length limit", async () => {
    renderScreen({ durationSeconds: 30 });
    await pickProject();
    expect(screen.getByTestId("post-check-length").textContent).toContain("한도(3분) 안입니다");
    expect(screen.getByTestId("post-check-length").textContent).toContain("0:30");
  });

  // The length check is a convenience; losing it must not cost the whole screen.
  it("still works when the settings read fails, saying the length is unknown", async () => {
    renderScreen({ durationSeconds: "fails" });
    await pickProject();
    expect(screen.getByTestId("post-check-length").textContent).toContain("확인하지 못했습니다");
    expect(screen.getByTestId("post-copy")).toBeTruthy();
  });

  /**
   * The panel called itself "checked while the file is still on this machine" while reading the project's
   * *planned* duration and *planned* aspect ratio. A merge that produced something else — a dropped scene, a
   * clip that ran long — was reported as compliant on a number nobody had compared to the video, and the user
   * would find out in Instagram's upload sheet instead.
   *
   * jsdom never fires `loadedmetadata` on its own, so the event is dispatched with the values a real browser
   * would expose. The 200s plan and the 30s file disagree deliberately: only reading the file gets this right.
   */
  function loadVideoMetadata(dimensions: { videoWidth: number; videoHeight: number; duration: number }): void {
    const player = screen.getByTestId("post-video-player");
    for (const [key, value] of Object.entries(dimensions)) {
      Object.defineProperty(player, key, { configurable: true, value });
    }
    fireEvent.loadedMetadata(player);
  }

  it("reports the file it measured, not the length the project planned", async () => {
    renderScreen({ durationSeconds: 200 });
    await pickProject();
    // Before the metadata arrives it says so rather than passing the plan off as a measurement.
    expect(screen.getByTestId("post-check-length").textContent).toContain("한도(3분)를 넘습니다");
    expect(screen.getByTestId("post-check-source").textContent).toContain("설정값으로 적었습니다");

    loadVideoMetadata({ videoWidth: 1080, videoHeight: 1920, duration: 30 });

    expect(screen.getByTestId("post-check-length").textContent).toContain("0:30");
    expect(screen.getByTestId("post-check-length").textContent).toContain("한도(3분) 안입니다");
    expect(screen.getByTestId("post-check-source").textContent).toContain("직접 재어 본");
  });

  it("reports the shape it measured, even when the project's settings say otherwise", async () => {
    renderScreen({ projects: [libraryProject({ aspectRatio: "9:16" })], project: { aspectRatio: "9:16" }, durationSeconds: 30 });
    await pickProject();
    expect(screen.getByTestId("post-check-shape").textContent).toContain("세로 9:16");

    // The settings say vertical; the file that came out is not. The file wins.
    loadVideoMetadata({ videoWidth: 1920, videoHeight: 1080, duration: 30 });

    expect(screen.getByTestId("post-check-shape").textContent).toContain("가로 영상");
  });

  /**
   * The other half of that rule, and the half that was wrong.
   *
   * A browser can state a duration and no frame size. The screen copied the PLANNED orientation into the
   * measured slot for that case, so 위 영상 파일을 직접 재어 본 값입니다 appeared under a shape nothing had
   * looked at — and a 16:9 file made from a project set to 9:16 passed as 세로 9:16, three cards above the one
   * button in this app that cannot be taken back. The panel's own comment already names this as the worst of
   * the three outcomes: a check that reports the plan as a measurement is believed.
   */
  it("does not call the planned shape a measurement when the file gave no frame size", async () => {
    renderScreen({ durationSeconds: 30 });
    await pickProject();

    loadVideoMetadata({ videoWidth: 0, videoHeight: 0, duration: 42 });

    // The length really was read, so it is used and said to be read.
    expect(screen.getByTestId("post-check-length").textContent).toContain("0:42");
    const source = screen.getByTestId("post-check-source").textContent ?? "";
    expect(source).toContain("길이는 위 영상 파일에서 직접 쟀고");
    expect(source).toContain("화면 비율은");
    expect(source).toContain("설정값");
    // And not the sentence that claims both.
    expect(source).not.toBe("위 영상 파일을 직접 재어 본 값입니다.");
  });

  // A stream whose duration the browser cannot state reports Infinity. That is "not measured", never "0:00" —
  // a zero-second chip under a real video is a confident wrong answer.
  it("keeps the planned length when the file reports no usable duration", async () => {
    renderScreen({ durationSeconds: 30 });
    await pickProject();

    loadVideoMetadata({ videoWidth: 1080, videoHeight: 1920, duration: Number.POSITIVE_INFINITY });

    expect(screen.getByTestId("post-check-length").textContent).toContain("0:30");
    expect(screen.getByTestId("post-check-length").textContent).not.toContain("0:00");
  });

  /**
   * A published Episode used to be a dead end: the button was gone and the only advice was to make a new video.
   * That is right for the accident it prevents — a second press when the first one's outcome is unclear — and
   * wrong for the person who deleted the post on Instagram and wants to put it up again.
   *
   * Two steps, and the second asks about a fact rather than about resolve. Whether the post is still up is the
   * only thing that decides one post or two, and the only thing this app cannot look up for itself.
   */
  it("does not clear the publish record until the second, fact-asking confirmation", async () => {
    const { fetchMock } = renderScreen({ project: { instagramPost: { mediaId: "m1", igUserId: "1", publishedAt: "2026-08-27T10:00:00.000Z", caption: "이전 캡션" } } });
    await pickProject();
    expect(screen.getByTestId("post-published")).toBeTruthy();

    fireEvent.click(screen.getByTestId("post-forget"));

    const panel = await screen.findByTestId("post-forget-confirm");
    expect(panel.textContent).toContain("인스타그램에서 그 게시물을 지우셨습니까?");
    // The two facts a person needs and cannot get anywhere else on this screen.
    expect(panel.textContent).toContain("같은 게시물이 두 개가 됩니다");
    expect(panel.textContent).toContain("인스타그램의 게시물은 그대로 남습니다");
    // Opening the panel must not have touched anything yet.
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);
  });

  it("unlocks publishing from the server's own answer once the record is cleared", async () => {
    const { fetchMock } = renderScreen({ project: { instagramPost: { mediaId: "m1", igUserId: "1", publishedAt: "2026-08-27T10:00:00.000Z", caption: "이전 캡션" } }, targets: { targets: [{ igUserId: "1", username: "acct", pageName: "Page" }], selectedIgUserId: "1" } });
    await pickProject();

    fireEvent.click(screen.getByTestId("post-forget"));
    fireEvent.click(await screen.findByTestId("post-forget-confirm-button"));

    // The lock lifts because the response carried a project with no record — not because a local flag flipped.
    await waitFor(() => expect(screen.queryByTestId("post-published")).toBeNull());
    const deleted = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "DELETE");
    const [url, init] = deleted as [string, RequestInit];
    expect(url).toBe("/projects/p1/instagram/post");
    expect(JSON.parse(String(init.body))).toEqual({ acknowledged: true });
  });

  // "There was nothing to clear" and "it is cleared" leave the same state. They are not the same sentence to
  // the person about to press 올리기, so the screen says which one happened.
  it("says plainly when there was no record to clear rather than reporting a success", async () => {
    renderScreen({ project: { instagramPost: { mediaId: "m1", igUserId: "1", publishedAt: "2026-08-27T10:00:00.000Z", caption: "이전 캡션" } }, forget: "not-recorded" });
    await pickProject();

    fireEvent.click(screen.getByTestId("post-forget"));
    fireEvent.click(await screen.findByTestId("post-forget-confirm-button"));

    const alert = await screen.findByTestId("post-forget-error");
    expect(alert).toHaveAttribute("data-error-code", "INSTAGRAM_POST_NOT_RECORDED");
    expect(alert.textContent).toContain("지울 게시 기록이 없습니다");
    expect(alert.textContent).not.toContain("raw backend detail");
  });

  /**
   * 🔴 The credit line was read from `project?.usedAudio` only. An Episode has carried `usedAudio` since the
   * Episode merge screen started asking about audio, and this is the screen where the caption is written — so
   * an Episode built on a CC BY track went to Instagram uncredited, with nothing blocking the button. D-003
   * again, open on the long side alone.
   *
   * Nothing here could have caught it: this file had no Episode fixture at all.
   */
  it("puts the licence credit in an Episode's caption, the same as a project's", async () => {
    renderScreen({
      projects: [],
      episodes: [libraryEpisode()],
      episode: { usedAudio: { mode: "bgm", trackId: "t1", attributionRequired: true, attributionText: "Music by ○○○" } },
    });
    fireEvent.change(await screen.findByTestId("post-project"), { target: { value: "episode:long|1" } });

    await screen.findByTestId("post-checks");
    expect((await screen.findByTestId("post-caption-preview")).textContent).toContain("Music by ○○○");
  });

  it("blocks an Episode whose credit line is required but blank, the same as a project's", async () => {
    renderScreen({
      projects: [],
      episodes: [libraryEpisode()],
      episode: { usedAudio: { mode: "bgm", trackId: "t1", attributionRequired: true } },
    });
    fireEvent.change(await screen.findByTestId("post-project"), { target: { value: "episode:long|1" } });

    await screen.findByTestId("post-checks");
    // Required but blank: the app must not invent wording a licence may be specific about, and must not let
    // the video out without it either.
    expect(screen.getByTestId("post-copy")).toBeDisabled();
  });

  /**
   * The history exists because clearing the publish record is the only way to publish a re-cut video, and that
   * clearing would otherwise erase the one thing the app knows and cannot re-check: something may still be
   * live on the account. Written and never read is how such a record quietly stops being kept correctly, so it
   * is on screen — and above the publish button, because the state that matters is the one right after
   * clearing, when the button is live again.
   */
  it("shows what this video was published as before, with the publish button live again", async () => {
    renderScreen({
      project: {
        previousInstagramPosts: [
          { mediaId: "old1", igUserId: "1", publishedAt: "2026-08-28T10:00:00.000Z", caption: "1화. 재생\n\nAI로 만든 영상입니다." },
        ],
      },
      targets: { targets: [{ igUserId: "1", username: "acct", pageName: "Page" }], selectedIgUserId: "1" },
    });
    await pickProject();

    const previous = await screen.findByTestId("post-previous");
    expect(previous.textContent).toContain("전에 1번 올라간 적이 있습니다");
    // The caption, because that is where the credit line and the AI disclosure lived.
    expect(previous.textContent).toContain("AI로 만든 영상입니다");
    // Not a lock — the record was cleared, so publishing is offered. The warning stands beside the button.
    expect(screen.queryByTestId("post-published")).toBeNull();
    expect(screen.getByTestId("post-publish-button")).not.toBeDisabled();
  });

  // A post that went out with an empty caption is a fact worth stating, not a blank line to skip.
  it("says a previous post went out with no caption rather than showing nothing", async () => {
    renderScreen({
      project: { previousInstagramPosts: [{ mediaId: "old1", igUserId: "1", publishedAt: "2026-08-28T10:00:00.000Z", caption: "" }] },
    });
    await pickProject();

    expect((await screen.findByTestId("post-previous")).textContent).toContain("캡션 없이 올라갔습니다");
  });

  it("warns when the video is landscape rather than the vertical shape a reel expects", async () => {
    renderScreen({ projects: [libraryProject({ aspectRatio: "16:9" })], project: { aspectRatio: "16:9" } });
    await pickProject();
    expect(screen.getByTestId("post-check-shape").textContent).toContain("가로 영상");
  });

  // The credit line is the reason the licence field exists at all — it is put into the caption automatically
  // rather than left for the user to remember, and it is not editable here so it cannot drift from the licence.
  it("puts the required credit line into the caption by itself", async () => {
    renderScreen({
      project: { usedAudio: { mode: "narration+bgm", attributionRequired: true, attributionText: "Music by ○○○ (CC BY 4.0)" } },
    });
    await pickProject();

    expect(screen.getByTestId("post-credit").textContent).toContain("Music by ○○○ (CC BY 4.0)");
    expect(screen.getByTestId("post-caption-preview").textContent).toContain("Music by ○○○ (CC BY 4.0)");
  });

  it("refuses to hand over a caption when credit is required but the sentence is blank", async () => {
    renderScreen({ project: { usedAudio: { mode: "narration+bgm", attributionRequired: true } } });
    await pickProject();

    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "본문" } });
    expect(screen.getByTestId("post-credit-missing").textContent).toContain("음원 보관함");
    expect(screen.getByTestId("post-copy")).toBeDisabled();
  });

  it("says nothing about credit for a track that never required it", async () => {
    renderScreen({ project: { usedAudio: { mode: "narration", attributionRequired: false } } });
    await pickProject();

    expect(screen.queryByTestId("post-credit")).toBeNull();
    expect(screen.queryByTestId("post-credit-missing")).toBeNull();
  });

  // The draft exists because a caption was being lost by walking away from the screen. A series creator whose
  // hashtag set barely changes between episodes should find it already there.
  it("fills the caption from the saved draft", async () => {
    renderScreen({ draft: { body: "지난 회차 본문", hashtags: "애니 단편", aiNotice: false } });
    await pickProject();

    expect((screen.getByTestId("post-body") as HTMLTextAreaElement).value).toBe("지난 회차 본문");
    expect((screen.getByTestId("post-hashtags") as HTMLInputElement).value).toBe("애니 단편");
    expect((screen.getByTestId("post-ai-notice") as HTMLInputElement).checked).toBe(false);
  });

  // Replaces "starts blank": a blank box was the screen asking for work it could already do. The topic and the
  // narration are both sitting in the project by the time this screen opens.
  it("fills the caption from the project itself when nothing was ever drafted", async () => {
    renderScreen({ project: { topic: "기록관의 밤", scenes: [scene(1, "문이 열렸다."), scene(2, "빛이 새어 나왔다.")] } });
    await pickProject();

    expect((screen.getByTestId("post-body") as HTMLTextAreaElement).value)
      .toBe("기록관의 밤\n\n문이 열렸다. 빛이 새어 나왔다.");
    // Said out loud, because text that appears on its own reads as text someone else wrote and must not be touched.
    expect(screen.getByTestId("post-body-autofilled")).toBeTruthy();
    expect((screen.getByTestId("post-ai-notice") as HTMLInputElement).checked).toBe(true);
  });

  /**
   * The defect the quote posts had: a photo card stores its quote twice — once as the project's topic and once
   * as scene narration, because the renderer needs it there to draw onto the picture — so the suggestion joined
   * the sentence to itself and it had to be deleted by hand before every post.
   *
   * Asserting the whole value rather than a "appears once" count on purpose: a fix that dropped the topic and
   * kept the narration would also print the quote once, and would be wrong the moment a card's two copies stop
   * matching.
   */
  it("writes a photo card's quote into the caption once", async () => {
    const quote = "불광불급(不狂不及)\n미치도록 몰입한 사람만이, 끝내 자신만의 빛에 닿는다.";
    renderScreen({ project: { photoCard: true, topic: quote, scenes: [scene(1, quote)] } });
    await pickProject();

    expect((screen.getByTestId("post-body") as HTMLTextAreaElement).value).toBe(quote);
  });

  /**
   * The photo-card branch, measured on the one case only it can answer.
   *
   * The test above passes with the branch deleted — a card stores its quote twice byte for byte, so the equality
   * guard catches it too, and nothing was holding the branch up. Cowork's own reason for writing both layers is
   * this: the day the two copies drift, the guard stops matching and the caption goes back to carrying the quote
   * twice. That day arrives whenever someone edits the quote without redrawing the card, and the picture on
   * screen is then the older of the two — so the caption must follow the topic, which is the one a person wrote.
   */
  it("writes a photo card's quote once even after the drawn copy has drifted from it", async () => {
    const edited = "불광불급(不狂不及)\n미치도록 몰입한 사람만이, 끝내 자신만의 빛에 닿는다.";
    const drawn = "불광불급(不狂不及)\n미치도록 몰입한 사람만이 빛에 닿는다.";
    renderScreen({ project: { photoCard: true, topic: edited, scenes: [scene(1, drawn)] } });
    await pickProject();

    const body = (screen.getByTestId("post-body") as HTMLTextAreaElement).value;
    expect(body).toBe(edited);
    expect(body).not.toContain(drawn);
  });

  // The same duplication reached through the other door: an ordinary project whose one scene narrates its title.
  // The photo-card branch does not cover this one, so it is its own test rather than a variation of the above.
  it("does not repeat narration that already says the topic", async () => {
    renderScreen({ project: { topic: "기록관의 밤", scenes: [scene(1, "기록관의 밤")] } });
    await pickProject();

    expect((screen.getByTestId("post-body") as HTMLTextAreaElement).value).toBe("기록관의 밤");
  });

  // The half that matters more than the filling: a body saved as empty is a person having cleared it. Refilling
  // that on the next visit is the screen undoing an edit, silently, which is the exact shape of the scene-edit
  // defect. `undefined` (never saved) and `""` (saved empty) have to stay different here.
  it("leaves the caption empty when an empty one was actually saved", async () => {
    renderScreen({ draft: { body: "", hashtags: "", aiNotice: true }, project: { topic: "기록관의 밤" } });
    await pickProject();

    expect((screen.getByTestId("post-body") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByTestId("post-body-autofilled")).toBeNull();
  });

  it("stops calling the caption pre-filled once it has been edited", async () => {
    renderScreen({ project: { topic: "기록관의 밤" } });
    await pickProject();

    expect(screen.getByTestId("post-body-autofilled")).toBeTruthy();
    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "내가 쓴 본문" } });
    expect(screen.queryByTestId("post-body-autofilled")).toBeNull();
  });

  // Saving on blur, not per keystroke and not behind a button people forget. The endpoint replaces rather than
  // merges, so a save has to carry all three fields or it deletes the other two.
  it("saves the whole draft when a field is left", async () => {
    const { fetchMock } = renderScreen();
    await pickProject();

    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "본문" } });
    fireEvent.change(screen.getByTestId("post-hashtags"), { target: { value: "태그" } });
    fireEvent.blur(screen.getByTestId("post-hashtags"));

    await screen.findByTestId("post-draft-saved");
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({ body: "본문", hashtags: "태그", aiNotice: true });
  });

  // A checkbox has no meaningful blur — the click is the whole interaction.
  it("saves as soon as the AI notice is toggled", async () => {
    const { fetchMock } = renderScreen();
    await pickProject();

    fireEvent.click(screen.getByTestId("post-ai-notice"));

    await screen.findByTestId("post-draft-saved");
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect(JSON.parse(String((put?.[1] as RequestInit).body)).aiNotice).toBe(false);
  });

  // The text is still in the box, so a failed save is a warning — never a reason to block the one action that
  // actually gets the caption out of here.
  it("warns but still lets the caption be copied when the save fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === LIBRARY_URL) return jsonResponse(200, { projects: [libraryProject()] });
      if (url === "/projects/p1") return jsonResponse(200, { project: makeProject({ id: "p1" }) });
      if (url === "/projects/p1/settings") return jsonResponse(200, { settings: makeSettings(30), sceneCountChangeable: true, aspectRatioChangeable: true });
      if (url === "/projects/p1/post-draft" && init?.method === "PUT") {
        return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "raw backend detail" });
      }
      if (url === "/projects/p1/post-draft") return jsonResponse(200, {});
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InstagramPostScreen onBack={() => {}} />);
    await pickProject();

    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "본문" } });
    fireEvent.blur(screen.getByTestId("post-body"));

    const error = await screen.findByTestId("post-draft-error");
    expect(error.textContent).not.toContain("raw backend detail");
    expect(screen.getByTestId("post-copy")).not.toBeDisabled();
    expect((screen.getByTestId("post-body") as HTMLTextAreaElement).value).toBe("본문");
  });

  /**
   * This replaces "still opens when the draft read fails", whose comment carried the assumption that was
   * wrong: *"a failed read means nothing saved was found"*. It does not. It means nothing was found out.
   *
   * The old behaviour filled the box with the suggestion and labelled it 미리 채워 뒀습니다 — a positive claim
   * that nothing was stored — and leaving the field then PUT that suggestion over the caption it had just
   * failed to read. The saved caption, its hashtags and the credit line in it were gone, with nothing on
   * screen having said so. An automatic save must never be the thing that destroys what it exists to keep.
   *
   * The screen still opens, and the caption typed here still goes out with the post. What it does not do is
   * write.
   */
  it("does not write over a saved draft it could not read", async () => {
    const { fetchMock } = renderScreen({ draft: "fails", project: { topic: "기록관의 밤" } });
    await pickProject();

    // No suggestion: it would be the thing written over the stored caption.
    expect((screen.getByTestId("post-body") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByTestId("post-body-autofilled")).toBeNull();
    expect((await screen.findByTestId("post-draft-unread")).textContent).toContain("불러오지 못했습니다");

    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "새로 쓴 본문" } });
    fireEvent.blur(screen.getByTestId("post-body"));

    // The assertion that matters: nothing was sent.
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT")).toBe(false);
    expect(screen.queryByTestId("post-draft-saved")).toBeNull();
    // And the caption is still usable — it just is not being persisted.
    expect((screen.getByTestId("post-body") as HTMLTextAreaElement).value).toBe("새로 쓴 본문");
  });

  /**
   * The way out of that state, and the half that keeps the fix from being "this project can never save again".
   * A second answer that arrives puts the stored caption on screen and lets saving resume.
   */
  it("takes the saved draft back once it can be read", async () => {
    renderScreen({ draft: "fails-once" });
    await pickProject();

    fireEvent.click(await screen.findByTestId("post-draft-reload"));

    await waitFor(() => expect((screen.getByTestId("post-body") as HTMLTextAreaElement).value).toBe("저장돼 있던 본문"));
    expect(screen.queryByTestId("post-draft-unread")).toBeNull();

    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "고친 본문" } });
    fireEvent.blur(screen.getByTestId("post-body"));
    await screen.findByTestId("post-draft-saved");
  });

  // Where it goes belongs beside what goes, not two screens away in settings: a credential answers "can we act
  // at all?" and this answers "where does it land?".
  it("shows the chosen account by its handle", async () => {
    renderScreen({
      targets: { targets: [{ igUserId: "17841400000000000", username: "ibad_studio", pageName: "이배드" }], selectedIgUserId: "17841400000000000" },
    });

    const chosen = await screen.findByTestId("post-target-selected");
    expect(chosen.textContent).toContain("@ibad_studio");
    expect(screen.queryByTestId("post-target-unset")).toBeNull();
  });

  /**
   * The field is absent for two reasons, and the screen cannot tell them apart: a stored choice that is no
   * longer in the list, and no choice ever having been made. It used to state the first as fact, so a
   * first-time publisher on a perfectly healthy connection was told their page had been disconnected or its
   * permission revoked — and went to Meta to fix nothing.
   *
   * What has to hold is that the sentence is true in both cases: the ask comes first, and the disconnection is
   * written as the condition it is.
   */
  it("asks for an account without asserting the connection broke", async () => {
    renderScreen({ targets: { targets: [{ igUserId: "1", username: "other", pageName: "다른 페이지" }] } });

    const notice = await screen.findByTestId("post-target-unset");
    expect(notice.textContent).toContain("아직 정해지지 않았습니다");
    expect(notice.textContent).toContain("골라 주세요");
    // Still says what may have happened — as a condition, not as the answer.
    expect(notice.textContent).toContain("전에 골라 두신 적이 있다면");
    expect(screen.queryByTestId("post-target-selected")).toBeNull();
  });

  it("saves the pick and shows it as the destination", async () => {
    const { fetchMock } = renderScreen({
      targets: { targets: [{ igUserId: "1", username: "ibad_studio", pageName: "이배드" }] },
    });

    fireEvent.change(await screen.findByTestId("post-target-select"), { target: { value: "1" } });

    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
      if (!call) throw new Error("no PUT yet");
      return call;
    });
    expect(String(put[0])).toBe("/settings/instagram/target");
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({ igUserId: "1" });
  });

  // An empty list is neither an error nor "log in" — the account exists but no Page is linked, which is a
  // different thing for the user to go fix.
  it("separates having no linked account from not being logged in", async () => {
    renderScreen({ targets: { targets: [] } });
    expect((await screen.findByTestId("post-target-none")).textContent).toContain("페이스북 페이지");
    expect(screen.queryByTestId("post-target-error")).toBeNull();
  });

  it("says to log in when the token is missing or expired, without leaking the raw message", async () => {
    renderScreen({ targets: "not-connected" });

    const error = await screen.findByTestId("post-target-error");
    expect(error).toHaveAttribute("data-error-code", "INSTAGRAM_NOT_CONNECTED");
    expect(error.textContent).toContain("로그인");
    expect(error.textContent).not.toContain("raw backend detail");
  });

  // The backend puts the numeric id in `username` rather than dropping an account it cannot name — being unable
  // to pick your own account is worse. But a bare number must never stand as the account name, so the screen
  // names it by its Page and says the handle could not be read.
  it("never presents a numeric id as the account name", async () => {
    renderScreen({
      targets: { targets: [{ igUserId: "17841400000000000", username: "17841400000000000", pageName: "이배드" }], selectedIgUserId: "17841400000000000" },
    });

    const chosen = await screen.findByTestId("post-target-selected");
    expect(chosen.textContent).toContain("이배드");
    expect(chosen.textContent).not.toContain("17841400000000000");
    expect(screen.getByTestId("post-target-handle-missing")).toBeTruthy();
  });

  // Publishing is the only action here that cannot be undone by anyone, so it is never one press away and the
  // panel names the account — including when there is only one, because the day a second appears is the day a
  // wrong destination costs something permanent.
  it("does not publish on the first press, and names the account in the confirmation", async () => {
    const { fetchMock } = renderScreen({ targets: { targets: [{ igUserId: "1", username: "ibad_studio", pageName: "이배드" }], selectedIgUserId: "1" } });
    await pickProject();
    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "본문" } });

    fireEvent.click(await screen.findByTestId("post-publish-button"));

    const panel = await screen.findByTestId("post-publish-confirm");
    expect(screen.getByTestId("post-publish-confirm-account").textContent).toBe("@ibad_studio");
    expect(panel.textContent).toContain("되돌릴 수 없습니다");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/instagram/publish"))).toBe(false);
  });

  it("sends approved with the account the panel named, and the caption it showed", async () => {
    const { fetchMock } = renderScreen({ targets: { targets: [{ igUserId: "1", username: "ibad_studio", pageName: "이배드" }], selectedIgUserId: "1" } });
    await pickProject();
    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "본문" } });
    const caption = screen.getByTestId("post-caption-preview").textContent;

    fireEvent.click(await screen.findByTestId("post-publish-button"));
    fireEvent.click(await screen.findByTestId("post-publish-confirm-button"));

    await screen.findByTestId("post-published");
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/instagram/publish"));
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ approved: true, caption, igUserId: "1" });
  });

  /**
   * Instagram's own uploader lets you pick the cover frame; this app published whatever frame 0 happened to be.
   *
   * The choice is read from the player rather than from a scene number: the frame on screen when the button is
   * pressed is the frame that goes, so there is no gap between what was shown and what was sent. A scene picker
   * would have had to name a moment the person cannot see — and the scene's generated image is not that frame,
   * since the video was animated from it.
   */
  it("sends the player's position as the cover, in milliseconds", async () => {
    const { fetchMock } = renderScreen({ targets: { targets: [{ igUserId: "1", username: "ibad_studio", pageName: "이배드" }], selectedIgUserId: "1" } });
    await pickProject();
    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "본문" } });

    const player = await screen.findByTestId("post-video-player");
    Object.defineProperty(player, "currentTime", { value: 12.34, configurable: true });
    fireEvent.click(screen.getByTestId("post-cover-set"));
    expect(screen.getByTestId("post-cover-set-at").textContent).toContain("12.3초");

    fireEvent.click(await screen.findByTestId("post-publish-button"));
    fireEvent.click(await screen.findByTestId("post-publish-confirm-button"));

    await screen.findByTestId("post-published");
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/instagram/publish"));
    expect(JSON.parse(String((call?.[1] as RequestInit).body)).thumbOffsetMs).toBe(12340);
  });

  /**
   * The confirmation says which cover is about to go out, in both directions.
   *
   * 캡틴D published Episode 4 twice, having picked a frame both times, and got the first frame both times. The
   * record settles what happened: the request carried no cover offset at all, so the control beside the player
   * was never actually pressed. Nothing on the confirmation said so — it named the account and warned that
   * publishing cannot be undone, while the only note about the cover was a grey line in the other column.
   *
   * The account is named on this panel because a mistaken post cannot be unseen. The cover is the other thing
   * about the post that cannot be changed afterwards, and it belongs in the same place for the same reason.
   */
  it("says which cover is going out on the confirmation, chosen or not", async () => {
    renderScreen({ targets: { targets: [{ igUserId: "1", username: "ibad_studio", pageName: "이배드" }], selectedIgUserId: "1" } });
    await pickProject();
    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "본문" } });

    fireEvent.click(await screen.findByTestId("post-publish-button"));

    // Nothing chosen: the panel says the first frame goes, where the person can still turn back.
    expect((await screen.findByTestId("post-publish-confirm-cover")).textContent).toContain("첫 장면");

    fireEvent.click(screen.getByTestId("post-publish-cancel"));
    const player = await screen.findByTestId("post-video-player");
    Object.defineProperty(player, "currentTime", { value: 12.34, configurable: true });
    fireEvent.click(screen.getByTestId("post-cover-set"));
    fireEvent.click(await screen.findByTestId("post-publish-button"));

    const chosen = await screen.findByTestId("post-publish-confirm-cover");
    expect(chosen.textContent).toContain("12.3초");
    expect(chosen.textContent).not.toContain("첫 장면");
  });

  /**
   * A photo card is one picture held under a slow zoom: every frame is the same frame. The picker would ask a
   * question whose answers are identical, so it is dropped and a sentence says why — silence would read as a
   * missing feature.
   *
   * The pair matters more than either half. A screen that hid the picker from everyone would pass the first
   * assertion alone, and take the choice away from ordinary projects, where the frames genuinely differ.
   */
  it("drops the cover picker for a photo card and says why", async () => {
    renderScreen({ project: { photoCard: true } });
    await pickProject();

    expect(screen.queryByTestId("post-cover")).toBeNull();
    expect(screen.queryByTestId("post-cover-set")).toBeNull();
    expect((await screen.findByTestId("post-cover-photo-card")).textContent).toContain("같은 그림");
  });

  it("keeps the cover picker for an ordinary project", async () => {
    renderScreen();
    await pickProject();

    expect(await screen.findByTestId("post-cover")).toBeTruthy();
    expect(screen.getByTestId("post-cover-set")).toBeTruthy();
    expect(screen.queryByTestId("post-cover-photo-card")).toBeNull();
  });

  /**
   * Unset and "the first frame" post the same picture, so the field is left out rather than sent as 0 — one of
   * those is a decision somebody made and the other is nobody having touched it, and only the first should be
   * recorded as one. It also means nothing on this screen has to be filled in before publishing.
   */
  it("omits the cover entirely when nobody chose one", async () => {
    const { fetchMock } = renderScreen({ targets: { targets: [{ igUserId: "1", username: "ibad_studio", pageName: "이배드" }], selectedIgUserId: "1" } });
    await pickProject();
    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "본문" } });

    expect((await screen.findByTestId("post-cover-unset")).textContent).toContain("첫 장면");

    fireEvent.click(await screen.findByTestId("post-publish-button"));
    fireEvent.click(await screen.findByTestId("post-publish-confirm-button"));

    await screen.findByTestId("post-published");
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/instagram/publish"));
    expect(Object.keys(JSON.parse(String((call?.[1] as RequestInit).body)))).not.toContain("thumbOffsetMs");
  });

  it("takes the cover back to the first frame", async () => {
    renderScreen({ targets: { targets: [{ igUserId: "1", username: "ibad_studio", pageName: "이배드" }], selectedIgUserId: "1" } });
    await pickProject();

    const player = await screen.findByTestId("post-video-player");
    Object.defineProperty(player, "currentTime", { value: 5, configurable: true });
    fireEvent.click(screen.getByTestId("post-cover-set"));
    fireEvent.click(screen.getByTestId("post-cover-clear"));

    expect(screen.getByTestId("post-cover-unset")).toBeTruthy();
    expect(screen.queryByTestId("post-cover-set-at")).toBeNull();
  });

  // Already out in the world: there is no state of this screen in which pressing again is wanted, so the button
  // is gone rather than disabled.
  it("offers no publish button at all once the project has been published", async () => {
    renderScreen({
      targets: { targets: [{ igUserId: "1", username: "ibad_studio", pageName: "이배드" }], selectedIgUserId: "1" },
      project: { instagramPost: { mediaId: "m1", igUserId: "1", publishedAt: "2026-08-27T10:00:00.000Z", caption: "이전 캡션" } },
    });
    await pickProject();

    expect(await screen.findByTestId("post-published")).toBeTruthy();
    expect(screen.queryByTestId("post-publish-button")).toBeNull();
  });

  it("will not offer to publish before an account is chosen", async () => {
    renderScreen({ targets: { targets: [{ igUserId: "1", username: "ibad_studio", pageName: "이배드" }] } });
    await pickProject();
    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "본문" } });

    expect(screen.getByTestId("post-publish-button")).toBeDisabled();
    expect(screen.getByTestId("post-publish-needs-target").textContent).toContain("계정을 먼저");
  });

  // These two say opposite things about the world. "Failed" means nothing went out and retrying is safe;
  // "already published" means retrying does the one thing that cannot be taken back.
  it("says a failed publish is safe to retry", async () => {
    renderScreen({ targets: { targets: [{ igUserId: "1", username: "ibad_studio", pageName: "이배드" }], selectedIgUserId: "1" }, publish: "INSTAGRAM_PUBLISH_FAILED" });
    await pickProject();
    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "본문" } });
    fireEvent.click(await screen.findByTestId("post-publish-button"));
    fireEvent.click(await screen.findByTestId("post-publish-confirm-button"));

    const error = await screen.findByTestId("post-publish-error");
    expect(error.textContent).toContain("아무것도 게시되지 않았");
    expect(error.textContent).not.toContain("raw backend detail");
  });

  it("never tells the reader to retry a publish that already went out", async () => {
    renderScreen({ targets: { targets: [{ igUserId: "1", username: "ibad_studio", pageName: "이배드" }], selectedIgUserId: "1" }, publish: "INSTAGRAM_ALREADY_PUBLISHED" });
    await pickProject();
    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "본문" } });
    fireEvent.click(await screen.findByTestId("post-publish-button"));
    fireEvent.click(await screen.findByTestId("post-publish-confirm-button"));

    const error = await screen.findByTestId("post-publish-error");
    expect(error.textContent).toContain("이미 게시");
    expect(error.textContent).not.toContain("다시 시도");
  });

  it("backs out of the confirmation without sending anything", async () => {
    const { fetchMock } = renderScreen({ targets: { targets: [{ igUserId: "1", username: "ibad_studio", pageName: "이배드" }], selectedIgUserId: "1" } });
    await pickProject();
    fireEvent.change(screen.getByTestId("post-body"), { target: { value: "본문" } });
    fireEvent.click(await screen.findByTestId("post-publish-button"));
    fireEvent.click(await screen.findByTestId("post-publish-cancel"));

    expect(screen.queryByTestId("post-publish-confirm")).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/instagram/publish"))).toBe(false);
  });

  it("copies the composed caption", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await withClipboard(writeText, async () => {
      renderScreen();
      await pickProject();
      fireEvent.change(screen.getByTestId("post-body"), { target: { value: "본문" } });
      fireEvent.click(screen.getByTestId("post-copy"));

      await screen.findByTestId("post-copied");
      expect(writeText).toHaveBeenCalledWith(screen.getByTestId("post-caption-preview").textContent);
    });
  });

  it("tells the reader to copy by hand when the clipboard refuses", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    await withClipboard(writeText, async () => {
      renderScreen();
      await pickProject();
      fireEvent.change(screen.getByTestId("post-body"), { target: { value: "본문" } });
      fireEvent.click(screen.getByTestId("post-copy"));

      await screen.findByTestId("post-copy-failed");
    });
  });
});

describe("InstagramPostScreen source", () => {
  // This screen publishes now, but it must never do so by talking to Meta itself. The token lives on the server
  // and never reaches the browser, so every call here goes to our own backend — a fetch to graph.facebook.com
  // from this file could only work by having a token in the page, which is the one thing that must never happen.
  it("publishes only through our own backend, never Meta directly, and never touches a token", async () => {
    const fsPromises = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const srcRoot = path.dirname(url.fileURLToPath(import.meta.url));
    const content = await fsPromises.readFile(path.join(srcRoot, "InstagramPostScreen.tsx"), "utf8");
    for (const pattern of [
      /graph\.instagram\.com/i,
      /graph\.facebook\.com/i,
      /media_publish/i,
      /access_token/i,
      /localStorage/,
      /sessionStorage/,
      /indexedDB/i,
      /console\s*\./,
      /api\.openai\.com/,
      /runwayml\.com/,
    ]) {
      expect(pattern.test(content)).toBe(false);
    }
  });
});
