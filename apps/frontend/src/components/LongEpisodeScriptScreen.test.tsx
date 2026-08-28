import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../api/testUtils.js";
import { LongEpisodeScriptScreen } from "./LongEpisodeScriptScreen.js";
import { STORY_ESTIMATED_COST_USD } from "@ai-animation-studio/shared";

const script = { title: "Draft", synopsis: "Summary", ending: "Ending", scenes: Array.from({ length: 6 }, (_, index) => ({ number: index + 1, description: "Description", visualAction: "Action", startMotion: "Start", mainMotion: "Main", endMotion: "End", shotSize: "Medium", cameraAngle: "Eye", composition: "Center", lensFeel: "Natural", focusSubject: "Hero", cameraMotion: "Slow", environmentMotion: "Wind", motionSpeed: "Normal", motionIntensity: "Moderate", expressionChange: "Calm", continuityHint: "Continue" })) };
const episode = (status: "outline_ready" | "script_review" | "script_approved", withScript = status !== "outline_ready") => ({ episodeNumber: 1, title: "Episode 1", summary: "Summary", mainEvent: "Event", conflict: "Conflict", cliffhanger: "Hook", nextEpisodeHook: "Next", status, approved: status === "script_approved", scriptRevision: withScript ? 1 : 0, scriptHistoryCount: withScript ? 1 : 0, ...(withScript ? { script } : {}) });

describe("LongEpisodeScriptScreen", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("reuses one request id until the generation succeeds, so a retry is not a second charge", async () => {
    // The id is what lets the server answer a repeat with what the first press made. Minted per press it would
    // differ every time and protect nothing — which is what the video workflow screen still does — so the thing
    // to hold is that a retry after a failure carries the same id, and only a fresh intent gets a new one.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode("outline_ready", false) }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "LONG_EPISODE_SCRIPT_PROVIDER_ERROR", message: "raw" }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode("script_review") }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode("script_review") }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeScriptScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    await screen.findByRole("button", { name: "대본 초안 만들기" });

    fireEvent.click(screen.getByRole("button", { name: "대본 초안 만들기" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "대본 초안 만들기" }));
    await waitFor(() => expect(screen.getByTestId("episode-script-field-description")).toHaveValue("Description"));

    const idOf = (index: number) => JSON.parse(String((fetchMock.mock.calls[index]![1] as RequestInit).body)).userRequestId as string;
    expect(idOf(1)).toHaveLength(36);
    expect(idOf(2)).toBe(idOf(1));

    fireEvent.click(screen.getByRole("button", { name: "새로 생성" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(idOf(3)).not.toBe(idOf(1));
  });

  it("generates a local six-scene script and only approves after the final confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { episode: episode("outline_ready", false) })).mockResolvedValueOnce(jsonResponse(200, { episode: episode("script_review") })).mockResolvedValueOnce(jsonResponse(200, { episode: episode("script_approved") }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeScriptScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    // This asserted toContain("비용이 들지 않습니다") and was what kept the false claim alive: the notice went
    // stale when EpisodeScriptsService gained a provider and a budget, and the test went on passing because it
    // was pinned to the words rather than to the fact. Assert the charge and take the amount from the shared
    // constant, so the next rate change reaches the assertion instead of outliving it.
    const costNotice = await screen.findByTestId("episode-script-cost-notice");
    expect(costNotice.textContent).toContain("비용이 발생합니다");
    expect(costNotice.textContent).toContain(`$${STORY_ESTIMATED_COST_USD.toFixed(2)}`);
    expect(costNotice.textContent).not.toContain("비용이 들지 않습니다");
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

  it("still loads a script written before narration existed, which has no such key at all", async () => {
    // The field list this screen validates against is derived from the shared scene definition, so adding
    // narration there silently made it required here — and every Episode script saved before narration existed
    // has no narration key. Requiring it would have answered "대본을 해석하지 못했습니다" for all of them and
    // locked people out of Episodes they already wrote. The fixture deliberately omits the key entirely
    // (not an empty string): absent and empty are different things to a validator.
    expect(script.scenes[0]).not.toHaveProperty("narration");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { episode: episode("script_review") })));
    render(<LongEpisodeScriptScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    await waitFor(() => expect(screen.getByTestId("episode-script-field-description")).toHaveValue("Description"));
    expect(screen.queryByText(/해석하지 못했습니다/)).toBeNull();
    // The field is offered even though the stored script has no value for it — that is how one gets added.
    expect(screen.getByTestId("episode-script-field-narration")).toHaveValue("");
  });

  it("edits the narration sentence like any other field, in its own group with its own consequence", async () => {
    // Narration is grouped apart from composition and motion because editing it costs differently: it makes
    // that scene's audio need remaking, and leaves the image and the video alone.
    const withNarration = {
      ...episode("script_review"),
      script: { ...script, scenes: script.scenes.map((scene) => ({ ...scene, narration: "읽어줄 문장입니다." })) },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: withNarration }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: withNarration }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeScriptScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const narration = await screen.findByTestId("episode-script-field-narration");
    expect(narration).toHaveValue("읽어줄 문장입니다.");
    const group = screen.getByTestId("episode-script-group-내레이션 문장");
    expect(group.textContent).toContain("고치면 이 장면의 음성을 다시 만들어야 합니다");

    fireEvent.change(narration, { target: { value: "고친 문장입니다." } });
    fireEvent.click(screen.getByTestId("episode-script-save"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as { script: { scenes: Record<string, unknown>[] } };
    expect(body.script.scenes[0]?.narration).toBe("고친 문장입니다.");
    // Only the edited scene changed; the rest of the script goes back exactly as it came.
    expect(body.script.scenes[1]?.narration).toBe("읽어줄 문장입니다.");
    expect(body.script.scenes[0]?.shotSize).toBe("Medium");
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
    // narration is now on both sides (see sceneFields.ts) — its group renders here too, with the same
    // "regenerate audio" impact text the short project's scene editor shows.
    expect(screen.getByTestId("episode-script-group-내레이션 문장").textContent).toContain("음성을 다시 만들어야");
  });

  it("shows an approved Episode read-only instead of pretending it can be edited", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { episode: episode("script_approved") })));
    render(<LongEpisodeScriptScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect((await screen.findByTestId("episode-script-readonly")).textContent).toContain("지금은 고칠 수 없습니다");
    expect(screen.queryByTestId("episode-script-save")).toBeNull();
    expect((screen.getByTestId("episode-script-field-description") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
