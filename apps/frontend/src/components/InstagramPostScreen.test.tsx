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
    imagePrompt: "",
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
  draft?: { body?: string; hashtags?: string; aiNotice?: boolean } | "fails";
  targets?: { targets: { igUserId: string; username: string; pageName: string }[]; selectedIgUserId?: string } | "not-connected";
  publish?: "ok" | "INSTAGRAM_ALREADY_PUBLISHED" | "INSTAGRAM_PUBLISH_FAILED" | "INSTAGRAM_NOT_CONNECTED";
} = {}) {
  const projects = options.projects ?? [libraryProject()];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === LIBRARY_URL) return jsonResponse(200, { projects });
    if (url === "/projects/p1") return jsonResponse(200, { project: makeProject({ id: "p1", ...options.project }) });
    if (url === "/projects/p1/settings") {
      if (options.durationSeconds === "fails") return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "raw" });
      return jsonResponse(200, { settings: makeSettings(options.durationSeconds ?? 30) });
    }
    if (url === "/projects/p1/instagram/publish") {
      if (options.publish && options.publish !== "ok") {
        return jsonResponse(409, { code: options.publish, message: "raw backend detail" });
      }
      return jsonResponse(200, {
        mediaId: "media_1",
        publishedAt: "2026-08-27T10:00:00.000Z",
        project: makeProject({ id: "p1", ...options.project, instagramPost: { mediaId: "media_1", igUserId: "1", publishedAt: "2026-08-27T10:00:00.000Z" } }),
      });
    }
    if (url === "/settings/instagram/targets" || url === "/settings/instagram/target") {
      if (options.targets === "not-connected") {
        return jsonResponse(409, { code: "INSTAGRAM_NOT_CONNECTED", message: "raw backend detail" });
      }
      return jsonResponse(200, options.targets ?? { targets: [] });
    }
    if (url === "/projects/p1/post-draft") {
      if (options.draft === "fails") return jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "raw" });
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
      if (url === "/projects/p1/settings") return jsonResponse(200, { settings: makeSettings(30) });
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

  // Losing the draft read must not cost the screen — it opens with the same caption a project that never had a
  // draft gets. Nothing is lost by that: a failed read means nothing saved was found, and the person can still
  // clear the box.
  it("still opens when the draft read fails", async () => {
    renderScreen({ draft: "fails", project: { topic: "기록관의 밤" } });
    await pickProject();
    expect((screen.getByTestId("post-body") as HTMLTextAreaElement).value).toBe("기록관의 밤");
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

  // The server only echoes a stored choice back when it is actually still in this list, so its absence means
  // the page was disconnected or lost its permission since. Saying so beats an empty selector.
  it("asks the user to choose again when the stored account is no longer listed", async () => {
    renderScreen({ targets: { targets: [{ igUserId: "1", username: "other", pageName: "다른 페이지" }] } });

    expect((await screen.findByTestId("post-target-unset")).textContent).toContain("다시 골라");
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

  // Already out in the world: there is no state of this screen in which pressing again is wanted, so the button
  // is gone rather than disabled.
  it("offers no publish button at all once the project has been published", async () => {
    renderScreen({
      targets: { targets: [{ igUserId: "1", username: "ibad_studio", pageName: "이배드" }], selectedIgUserId: "1" },
      project: { instagramPost: { mediaId: "m1", igUserId: "1", publishedAt: "2026-08-27T10:00:00.000Z" } },
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
