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
/**
 * `aspectRatioChangeable` is required by the contract, so every settings body needs it or the guard rejects the
 * response and the screen renders nothing. Defaulted here rather than at fifteen call sites — a test that says
 * nothing about the lock is a test about an unlocked project, which is what they all were before it existed.
 */
function withSettingsDefaults(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (!("settings" in record) || "aspectRatioChangeable" in record) return record;
  return { aspectRatioChangeable: true, ...record };
}

function stubScreenFetch(settingsBody: unknown, options: { settingsStatus?: number } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.startsWith("/assets")) return jsonResponse(200, { assets: [] });
    if (url.includes("/story-bible")) return jsonResponse(200, { storyBible: { basic: {}, world: {}, characters: [], locations: [], props: [], secrets: [], foreshadowing: [], updatedAt: "2026-08-23T00:00:00.000Z" } });
    return jsonResponse(options.settingsStatus ?? 200, withSettingsDefaults(settingsBody));
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

  /**
   * The gap Cowork Round 475 found: an Episode passed `""` where the style line goes, so nothing anyone said
   * about how the work should look ever reached a paid image call. The backend now carries the four fields; a
   * screen with no boxes for them would leave the feature exactly as unreachable as before.
   *
   * Asserting the round trip rather than the boxes: four inputs that render and send nothing is the same
   * feature gap wearing a different coat.
   */
  it("sends the art direction it was given, edited, back through PATCH", async () => {
    const settings = makeLongProjectSettings({ visualStyle: "수채화", color: "차가운 청록", lighting: "", avoid: "" });
    const fetchMock = stubScreenFetch({ settings });
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    expect(await screen.findByDisplayValue("수채화")).toBeTruthy();
    // All four are typed into, not one. Each box is wired separately, so editing a single one leaves a dead
    // onChange on the other three indistinguishable from a working one — the box is drawn, the value never
    // leaves the screen, and "칸만 그리고 안 보내면 같은 구멍" is exactly the defect this test is named for.
    fireEvent.change(screen.getByDisplayValue("수채화"), { target: { value: "손그림 수채화" } });
    fireEvent.change(screen.getByDisplayValue("차가운 청록"), { target: { value: "따뜻한 주황" } });
    fireEvent.change(screen.getByLabelText("조명"), { target: { value: "역광" } });
    fireEvent.change(screen.getByLabelText(/피할 요소/), { target: { value: "사진 같은 질감" } });
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    expect(JSON.parse(String(callTo(fetchMock, "/long-projects/long_test/settings", "PATCH")[1].body)))
      .toMatchObject({ settings: { visualStyle: "손그림 수채화", color: "따뜻한 주황", lighting: "역광", avoid: "사진 같은 질감" } });
  });

  /**
   * The one sentence this group exists to carry. 톤 and 메모 sit a few centimetres above these boxes and go to
   * the script; these go to the picture. Nothing on screen distinguishes them but the words, and the screen's
   * own top line says everything here reaches 대본 생성 — so without this the page contradicts itself.
   */
  it("says the art direction reaches the picture and not the script", async () => {
    stubScreenFetch({ settings: makeLongProjectSettings() });
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    const scope = await screen.findByTestId("long-settings-style-scope");
    expect(scope.textContent).toContain("그림에만");
    expect(scope.textContent).toContain("대본에는 들어가지 않습니다");
    // And the page-wide line no longer claims otherwise about these four.
    expect(screen.getByTestId("long-settings-scope").textContent).toContain("그림체");
  });

  /**
   * All four blank is the default for every project that existed before these fields did, and it has to keep
   * meaning "carry on exactly as before" rather than reading as four things left undone.
   */
  it("says a blank art direction changes nothing", async () => {
    stubScreenFetch({ settings: makeLongProjectSettings() });
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    const group = await screen.findByTestId("long-settings-style-group");
    expect(group.textContent).toContain("비워 두면 지금까지와 똑같습니다");
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
      .mockResolvedValueOnce(jsonResponse(200, { settings, aspectRatioChangeable: true }))
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
    expect(subtitleLabel?.textContent).toContain("비용 없음");
  });

  it("edits scene count and clip duration, derives the displayed total, and sends both (never the derived field) on save", async () => {
    const settings = makeLongProjectSettings({ sceneCount: 6, clipDurationSeconds: 5, episodeDurationSeconds: 30 });
    const project = makeLongProject({ settings: { ...settings, sceneCount: 8, clipDurationSeconds: 10, episodeDurationSeconds: 80 } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { settings, aspectRatioChangeable: true }))
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

  // Everything the script prompt reads about the work now lives on this one screen. The move is only real if
  // the cards are actually mounted here — a rename of the import or a lost line puts them nowhere at all, and
  // the old screen no longer has them either, so nothing on screen would say the feature had disappeared.
  it("carries 주인공, 전체 그림체, 세계관 설명 and 비밀·복선 on one screen", async () => {
    stubScreenFetch({ settings: makeLongProjectSettings() });
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    expect(await screen.findByTestId("story-world-card")).toBeTruthy();
    expect(screen.getByTestId("story-secrets-card")).toBeTruthy();
    expect(screen.getByRole("button", { name: "세계관 설명 저장" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "비밀 추가" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "복선 추가" })).toBeTruthy();
  });

  // Moved here from StoryWorldCard.test.tsx. The rule is true of all four cards below — 주인공, 전체 그림체,
  // 세계관 설명, 비밀·복선 — so it is stated once at the top rather than four times over. A screen that repeats
  // itself four times is a screen people stop reading, and then they miss the line that was card-specific.
  it("states once, for the whole screen, when what is written here is read", async () => {
    stubScreenFetch({ settings: makeLongProjectSettings() });
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    const notice = await screen.findByTestId("long-settings-scope");
    expect(notice.textContent).toContain("대본 생성");
    // Blank is a complete answer — the prompt already treats it that way, and the screen read as a form that
    // had to be filled in.
    expect(notice.textContent).toContain("빈 칸은 AI가 알아서");
    // And what happens to Episodes that already have a script, which is the half people lose money on.
    expect(notice.textContent).toContain("다시 만들어야");
  });

  /**
   * A long project's aspect ratio is read by image generation, video generation and the merge, every time they
   * run. Changing it after an Episode has images means portrait pictures sent to Runway asking for landscape
   * video, then padded by the merge — all paid for, none matching, and nothing on this screen said so.
   *
   * The server answers it, computed by the same function the save enforces with; the screen never re-derives
   * the rule. Said before the change rather than after the refusal: the refusal is identical either way, and
   * the only thing that can differ is whether it comes before the person decided.
   */
  it("locks the aspect ratio once an Episode has images, and names the Episode that closed it", async () => {
    stubScreenFetch({ settings: makeLongProjectSettings(), aspectRatioChangeable: false, aspectRatioLockedByEpisodeNumber: 2 });
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    expect(await screen.findByTestId("long-settings-aspect-ratio")).toBeDisabled();
    const notice = screen.getByTestId("long-settings-aspect-locked");
    // "Why now" has one answer and the server already knows it.
    expect(notice.textContent).toContain("2화");
    expect(notice.textContent).toContain("비용이 듭니다");
  });

  it("leaves the aspect ratio editable and says nothing when the project is not locked", async () => {
    stubScreenFetch({ settings: makeLongProjectSettings(), aspectRatioChangeable: true });
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    expect(await screen.findByTestId("long-settings-aspect-ratio")).not.toBeDisabled();
    // The counterpart the rule above needs: without it, a change that disabled the field unconditionally would
    // still pass the locked test.
    expect(screen.queryByTestId("long-settings-aspect-locked")).toBeNull();
  });
});
