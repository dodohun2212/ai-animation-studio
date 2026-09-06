import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeProject, withStatus } from "../api/testUtils.js";
import { CreateFlowerReelForm } from "./CreateFlowerReelForm.js";

const project = makeProject({ id: "꽃말_장미" });

function fill() {
  fireEvent.change(screen.getByTestId("flower-name"), { target: { value: "장미" } });
  fireEvent.change(screen.getByTestId("flower-meaning"), { target: { value: "열정" } });
}

/** Both calls succeed: create, then the preset save. */
function stubOk() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === "/projects") return jsonResponse(200, { project });
    if (url.endsWith("/settings")) {
      return jsonResponse(200, { project, settings: { projectName: "", topic: "", genre: "", mood: "", character: "", lore: "", fullStory: "", durationSeconds: 20, sceneCount: 2, clipDurationSeconds: 10, additionalNotes: "", styleNotes: {}, narrationEnabled: true, subtitlesEnabled: true } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("CreateFlowerReelForm", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /**
   * 🔴 This form writes a brief, not a script.
   *
   * An earlier version typed two fields per scene by hand and the image prompt came out empty — the prompts
   * read seventeen scene fields, and only story generation fills them. So what this asserts is that the flower
   * facts reach the *settings* the story prompt is built from, and that nothing here tries to author scenes.
   */
  it("creates an ordinary project and saves the flower brief into its settings", async () => {
    const fetchMock = stubOk();
    const onCreated = vi.fn();
    render(<CreateFlowerReelForm onCreated={onCreated} onCancel={() => {}} />);

    fill();
    fireEvent.click(screen.getByTestId("flower-submit"));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
    const calls = fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit }));
    expect(calls[0]!.url).toBe("/projects");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ projectId: "꽃말_장미", topic: "장미의 꽃말 — 열정" });

    const saved = JSON.parse(String(calls[1]!.init.body)) as { settings: Record<string, unknown> };
    const settings = saved.settings as { fullStory: string; sceneCount: number; clipDurationSeconds: number; styleNotes: Record<string, string>; narrationEnabled: boolean; sceneImageContinuityEnabled: boolean };
    expect(settings.fullStory).toContain("장미");
    // The growth arc and the sameness clause are the whole brief — an image prompt built without them draws a
    // different flower in every shot, which is the one failure this preset exists to fight.
    expect(settings.fullStory).toContain("씨앗");
    expect(settings.fullStory).toContain("같은 각도");
    expect(settings.styleNotes.avoid).toContain("장면마다 바뀌는 것");
    // 씨앗 → 싹 → 봉오리 → 개화. Two scenes jumped from a sprout to an open flower in one cut, and that jump
    // survived however steady the pot was kept; the video cost is unchanged and the images cost $0.20 more.
    expect(settings.sceneCount).toBe(4);
    expect(settings.clipDurationSeconds).toBe(5);
    expect(settings.narrationEnabled).toBe(true);
    // The preset turns the chain on, which is the setting's whole distinction: one flower, one pot, one
    // forward movement. The brief above asks for 「같은 화분」 and this is what lets the pictures obey it.
    expect(settings.sceneImageContinuityEnabled).toBe(true);
    // durationSeconds is derived server-side and rejected as an unsupported field if sent.
    expect(settings).not.toHaveProperty("durationSeconds");
  });

  it("passes a typed origin through, and leaves it out when blank", async () => {
    const fetchMock = stubOk();
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);
    fill();
    fireEvent.change(screen.getByTestId("flower-origin"), { target: { value: "그리스 신화에서 유래한다" } });
    fireEvent.click(screen.getByTestId("flower-submit"));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));
    const settings = (JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body)) as { settings: { fullStory: string } }).settings;
    expect(settings.fullStory).toContain("그리스 신화에서 유래한다");
  });

  /**
   * 🔴 The money sentence has to match what the button does.
   *
   * While this form wrote the script itself it truthfully said 비용이 들지 않습니다. The script now comes from
   * a paid call, so that sentence would be a promise the screen no longer keeps — on the button that spends.
   */
  it("says the script generation charge is next, not that this is free", () => {
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);
    const note = screen.getByTestId("flower-cost-note").textContent ?? "";
    expect(note).toContain("$0.05");
    expect(note).not.toContain("비용이 들지 않습니다");
    // And the origin field says where a wrong fact gets corrected, before any image is bought.
    expect(screen.getByTestId("flower-origin-note").textContent).toContain("이미지를 만들기 전에");
  });

  it("suggests a folder name from the flower and keeps a typed one", () => {
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("flower-name"), { target: { value: "장미" } });
    expect((screen.getByTestId("flower-project-id") as HTMLInputElement).value).toBe("꽃말_장미");

    fireEvent.change(screen.getByTestId("flower-project-id"), { target: { value: "rose_01" } });
    fireEvent.change(screen.getByTestId("flower-name"), { target: { value: "수국" } });
    expect((screen.getByTestId("flower-project-id") as HTMLInputElement).value).toBe("rose_01");
  });

  /**
   * 🔴 Only the first of the two calls is irreversible.
   *
   * When the preset save fails the folder already exists, so retrying must not create it again — pressing the
   * button a second time would only ever get PROJECT_ALREADY_EXISTS about the project this screen just made.
   */
  it("says the project was made when only the preset failed, and retries just the preset", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === "/projects") return jsonResponse(200, { project });
      return withStatus(500, { code: "PROJECT_STORAGE_ERROR", message: "raw" }) as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);

    fill();
    fireEvent.click(screen.getByTestId("flower-submit"));

    const partial = await screen.findByTestId("flower-partial");
    expect(partial.textContent).toContain("꽃말_장미");
    expect(screen.getByTestId("flower-submit").textContent).toContain("다시 저장");

    fireEvent.click(screen.getByTestId("flower-submit"));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(3));
    // Three calls, and only one of them was the create.
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/projects")).toHaveLength(1);
  });

  it("does not submit until the flower and its meaning are filled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateFlowerReelForm onCreated={() => {}} onCancel={() => {}} />);

    expect((screen.getByTestId("flower-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("flower-submit"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
