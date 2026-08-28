import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeLongProject, makeLongProjectSettings } from "../api/testUtils.js";
import { LongProjectSettingsScreen } from "./LongProjectSettingsScreen.js";

/**
 * Finds the request by the route it went to, not by the order it went in.
 *
 * The screen gained a card that lists Assets, so its own settings calls stopped being the first and second
 * things it did and every positional index moved. Counting to a request is only ever right until the screen
 * does one more thing.
 */
/**
 * Answers the screen's own settings route, and the two the style card asks for.
 *
 * The card was added to this screen after these tests were written; answering everything with `{ settings }`
 * left it rendering its own error, which then made "the alert" ambiguous in tests that assert on one.
 */
function stubScreenFetch(settingsBody: unknown, options: { settingsStatus?: number } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.startsWith("/assets")) return jsonResponse(200, { assets: [] });
    if (url.includes("/story-bible")) return jsonResponse(200, { storyBible: { basic: {}, world: {}, characters: [], locations: [], props: [], secrets: [], foreshadowing: [], updatedAt: "2026-08-23T00:00:00.000Z" } });
    return jsonResponse(options.settingsStatus ?? 200, settingsBody);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** How many requests used `method` on `suffix`. Counting every request instead says "and nothing else happened", which stopped being true when this screen gained a card. */
function countTo(fetchMock: ReturnType<typeof vi.fn>, suffix: string, method: string): number {
  return (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>)
    .filter(([url, init]) => String(url).endsWith(suffix) && init?.method === method).length;
}

function callTo(fetchMock: ReturnType<typeof vi.fn>, suffix: string, method?: string): [string, RequestInit] {
  // The method matters as well as the route: this screen reads and writes the same URL, so asking for the route
  // alone finds the GET when the assertion is about the PATCH.
  const call = (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>)
    .find(([url, init]) => String(url).endsWith(suffix) && (method === undefined || init?.method === method));
  if (!call) throw new Error(`No ${method ?? ""} request was made to ${suffix}`);
  return call as [string, RequestInit];
}

describe("LongProjectSettingsScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reopens saved settings via GET and saves an edited title through PATCH", async () => {
    const settings = makeLongProjectSettings({ title: "우주 방랑자", logline: "귀환 이야기" });
    const project = makeLongProject({ settings: { ...settings, title: "새 제목" } });
    const fetchMock = stubScreenFetch({ settings });
    void project;
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    expect(await screen.findByDisplayValue("우주 방랑자")).toBeTruthy();
    expect(callTo(fetchMock, "/long-projects/long_test/settings")[0]).toBe("/long-projects/long_test/settings");
    fireEvent.change(screen.getByDisplayValue("우주 방랑자"), { target: { value: "새 제목" } });
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    const [url, init] = callTo(fetchMock, "/long-projects/long_test/settings", "PATCH");
    expect(url).toBe("/long-projects/long_test/settings");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toMatchObject({ settings: { title: "새 제목", logline: "귀환 이야기" } });
  });

  it("blocks an empty title before sending PATCH", async () => {
    const settings = makeLongProjectSettings();
    stubScreenFetch({ settings });
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    const title = await screen.findByDisplayValue(settings.title);
    fireEvent.change(title, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    expect(await screen.findByRole("alert")).toHaveAttribute("data-error-code", "INVALID_REQUEST");
    expect(countTo(vi.mocked(fetch), "/long-projects/long_test/settings", "PATCH")).toBe(0);
  });

  it("blocks a non-positive episode count before sending PATCH", async () => {
    const settings = makeLongProjectSettings();
    stubScreenFetch({ settings });
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByDisplayValue(settings.title);
    fireEvent.change(screen.getByDisplayValue(String(settings.episodeCount)), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    expect(await screen.findByRole("alert")).toHaveAttribute("data-error-code", "INVALID_REQUEST");
    expect(countTo(vi.mocked(fetch), "/long-projects/long_test/settings", "PATCH")).toBe(0);
  });

  it("shows a safe error instead of the raw backend message when reopening fails", async () => {
    stubScreenFetch({ code: "LONG_PROJECT_NOT_FOUND", message: "raw backend detail" }, { settingsStatus: 404 });
    render(<LongProjectSettingsScreen projectId="missing" onBack={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("raw backend detail");
    expect(alert).toHaveAttribute("data-error-code", "LONG_PROJECT_NOT_FOUND");
  });

  it("turns voice and subtitles on independently and sends both flags", async () => {
    // They are two separate settings on purpose: subtitles cost nothing and voice costs per scene per Episode,
    // so "subtitles only" has to be reachable without paying for anything. A single combined toggle would
    // quietly make every captioned Episode a paid one.
    const settings = makeLongProjectSettings({ narrationEnabled: false, subtitlesEnabled: false });
    const project = makeLongProject({ settings: { ...settings, subtitlesEnabled: true } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { settings }))
      .mockResolvedValueOnce(jsonResponse(200, { project }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    const voice = (await screen.findByTestId("long-settings-narration-enabled")) as HTMLInputElement;
    const subtitles = screen.getByTestId("long-settings-subtitles-enabled") as HTMLInputElement;
    expect(voice.checked).toBe(false);
    expect(subtitles.checked).toBe(false);

    fireEvent.click(subtitles);
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    const [, init] = callTo(fetchMock, "/long-projects/long_test/settings", "PATCH");
    const body = JSON.parse(String(init.body)) as { settings: Record<string, unknown> };
    expect(body.settings).toMatchObject({ subtitlesEnabled: true, narrationEnabled: false });
  });

  it("says plainly which of the two costs money", async () => {
    // This is the one place someone decides to spend per scene per Episode, and the cost has to be legible
    // before the checkbox, not after the bill.
    stubScreenFetch({ settings: makeLongProjectSettings() });
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    const voiceLabel = (await screen.findByTestId("long-settings-narration-enabled")).closest("label");
    expect(voiceLabel?.textContent).toContain("에피소드마다, 장면마다 한 번씩 비용이 듭니다");
    const subtitleLabel = screen.getByTestId("long-settings-subtitles-enabled").closest("label");
    expect(subtitleLabel?.textContent).toContain("비용이 들지 않습니다");
  });

  it("edits scene count and clip duration, derives the displayed total, and sends both (never the derived field) on save", async () => {
    const settings = makeLongProjectSettings({ sceneCount: 6, clipDurationSeconds: 5, episodeDurationSeconds: 30 });
    const project = makeLongProject({ settings: { ...settings, sceneCount: 8, clipDurationSeconds: 10, episodeDurationSeconds: 80 } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { settings }))
      .mockResolvedValueOnce(jsonResponse(200, { project }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    const sceneCountInput = (await screen.findByDisplayValue("6")) as HTMLInputElement;
    fireEvent.change(sceneCountInput, { target: { value: "8" } });
    const clipDurationSelect = (await screen.findByDisplayValue("5초")) as HTMLSelectElement;
    expect([...clipDurationSelect.options].map((option) => option.value)).toEqual(["5", "10"]);
    fireEvent.change(clipDurationSelect, { target: { value: "10" } });
    expect(screen.getByText(/에피소드당 예상 영상 길이: 80초/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    const [, init] = callTo(fetchMock, "/long-projects/long_test/settings", "PATCH");
    const body = JSON.parse(String(init.body)) as { settings: Record<string, unknown> };
    expect(body.settings).toMatchObject({ sceneCount: 8, clipDurationSeconds: 10 });
    expect(body.settings).not.toHaveProperty("episodeDurationSeconds");
  });
});
