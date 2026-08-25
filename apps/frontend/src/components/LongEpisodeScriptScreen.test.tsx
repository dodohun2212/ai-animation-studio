import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../api/testUtils.js";
import { LongEpisodeScriptScreen } from "./LongEpisodeScriptScreen.js";

const script = { title: "Draft", synopsis: "Summary", ending: "Ending", scenes: Array.from({ length: 6 }, (_, index) => ({ number: index + 1, description: "Description", visualAction: "Action", startMotion: "Start", mainMotion: "Main", endMotion: "End", shotSize: "Medium", cameraAngle: "Eye", composition: "Center", lensFeel: "Natural", focusSubject: "Hero", cameraMotion: "Slow", environmentMotion: "Wind", motionSpeed: "Normal", motionIntensity: "Moderate", expressionChange: "Calm", continuityHint: "Continue" })) };
const episode = (status: "outline_ready" | "script_review" | "script_approved", withScript = status !== "outline_ready") => ({ episodeNumber: 1, title: "Episode 1", summary: "Summary", mainEvent: "Event", conflict: "Conflict", cliffhanger: "Hook", nextEpisodeHook: "Next", status, approved: status === "script_approved", scriptRevision: withScript ? 1 : 0, scriptHistoryCount: withScript ? 1 : 0, ...(withScript ? { script } : {}) });

describe("LongEpisodeScriptScreen", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("generates a local six-scene script and only approves after the final confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { episode: episode("outline_ready", false) })).mockResolvedValueOnce(jsonResponse(200, { episode: episode("script_review") })).mockResolvedValueOnce(jsonResponse(200, { episode: episode("script_approved") }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeScriptScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    // This step is local-only by design (EpisodeScriptsService gets no provider or budget injected), and the
    // short project's story step is not — so the difference has to be on screen before the button is pressed.
    expect((await screen.findByTestId("episode-script-cost-notice")).textContent).toContain("비용이 들지 않습니다");
    fireEvent.click(screen.getByRole("button", { name: "대본 초안 만들기" }));
    // The script arrives as labelled fields now, not a JSON blob the user has to keep syntactically valid.
    await waitFor(() => expect(screen.getByTestId("episode-script-field-description")).toHaveValue("Description"));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/long-projects/long/episodes/1/script/generations");
    fireEvent.click(screen.getByRole("button", { name: "대본 승인" }));
    expect(await screen.findByTestId("episode-script-approve-confirm")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "최종 승인" }));
    await waitFor(() => expect(screen.getByText(/대본이 승인되었습니다/)).toBeTruthy());
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({ approved: true });
  });

  it("shows the Episode status in Korean instead of the raw stored value", async () => {
    // Every other Long Project screen runs the status through longEpisodeStatusLabel; this one printed the
    // enum itself, so a finished Episode read "videos_approved" here and "영상 승인됨" everywhere else.
    const approved = { ...episode("script_approved"), status: "videos_approved" as const };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { episode: approved })));
    render(<LongEpisodeScriptScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const status = await screen.findByTestId("episode-script-status");
    expect(status.textContent).toContain("영상 승인됨");
    expect(status.textContent).not.toContain("videos_approved");
    expect(status.textContent).not.toContain("revision");
    expect(status.textContent).not.toContain("history");
  });

  it("edits one field and saves the whole script, keeping every other value untouched", async () => {
    const saved = { ...episode("script_review") };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode("script_review") }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: saved }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeScriptScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const shotSize = await screen.findByTestId("episode-script-field-shotSize");
    // Saving is offered only once something actually changed.
    expect((screen.getByTestId("episode-script-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(shotSize, { target: { value: "close up" } });
    expect((await screen.findByTestId("episode-script-unsaved")).textContent).toContain("저장해야 승인할 수 있습니다");

    fireEvent.click(screen.getByTestId("episode-script-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/long-projects/long/episodes/1/script");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(String(init.body)) as { script: typeof script };
    expect(body.script.scenes[0]?.shotSize).toBe("close up");
    // The endpoint takes the whole script, so an untouched field must survive the round trip verbatim.
    expect(body.script.scenes[0]?.cameraAngle).toBe("Eye");
    expect(body.script.scenes[5]?.shotSize).toBe("Medium");
    expect(body.script.title).toBe("Draft");
  });

  it("edits the scene the tab selects, not always the first one", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode("script_review") }))
      .mockResolvedValue(jsonResponse(200, { episode: episode("script_review") }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeScriptScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    fireEvent.click(await screen.findByTestId("episode-scene-tab-4"));
    fireEvent.change(screen.getByTestId("episode-script-field-mainMotion"), { target: { value: "4번만 바뀜" } });
    fireEvent.click(screen.getByTestId("episode-script-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as { script: typeof script };
    expect(body.script.scenes[3]?.mainMotion).toBe("4번만 바뀜");
    expect(body.script.scenes[0]?.mainMotion).toBe("Main");
  });

  it("says what each group of fields costs to change, before it is changed", async () => {
    // The whole reason the fields are grouped: the endpoint takes them as one flat set, but a composition edit
    // means paying to regenerate an image while the on-screen script costs nothing.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { episode: episode("script_review") })));
    render(<LongEpisodeScriptScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect((await screen.findByTestId("episode-script-group-구도")).textContent).toContain("이미지를 다시 만들어야");
    expect(screen.getByTestId("episode-script-group-움직임").textContent).toContain("영상을 다시 만들어야");
    expect(screen.getByTestId("episode-script-group-화면 대본").textContent).toContain("다시 만들 것이 없습니다");
    // Long-form Episodes have no narration at all, so that group must not appear here.
    expect(screen.queryByTestId("episode-script-group-내레이션 문장")).toBeNull();
  });

  it("shows an approved Episode read-only instead of pretending it can be edited", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { episode: episode("script_approved") })));
    render(<LongEpisodeScriptScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect((await screen.findByTestId("episode-script-readonly")).textContent).toContain("지금은 고칠 수 없습니다");
    expect(screen.queryByTestId("episode-script-save")).toBeNull();
    expect((screen.getByTestId("episode-script-field-description") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
