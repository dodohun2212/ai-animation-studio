import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { InstagramPostScreen } from "./InstagramPostScreen.js";

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

  // "Prepare a post" could mean either thing, and only one of them is true here. Said before anything else on
  // the screen, because a person who assumes the other one finds out by not finding their post.
  it("says up front that it publishes nothing", async () => {
    renderScreen();
    const notice = await screen.findByTestId("post-scope-notice");
    expect(notice.textContent).toContain("올리지 않습니다");
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

  it("starts blank with the AI notice on when nothing was ever drafted", async () => {
    renderScreen();
    await pickProject();

    expect((screen.getByTestId("post-body") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByTestId("post-ai-notice") as HTMLInputElement).checked).toBe(true);
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

  // Losing the draft read must not cost the screen — the caption is simply blank, as it is for a new project.
  it("still opens when the draft read fails", async () => {
    renderScreen({ draft: "fails" });
    await pickProject();
    expect((screen.getByTestId("post-body") as HTMLTextAreaElement).value).toBe("");
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
  // The one thing this screen must never grow by accident: a call that actually publishes, or any provider
  // credential handling. Posting needs a Creator account and Meta's Content Publishing API, and is out of scope
  // by decision, not by oversight (docs/06_DECISIONS.md D-012).
  it("never reaches Instagram, a provider, or client-side storage", async () => {
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
