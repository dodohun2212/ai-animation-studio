import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, makeLongEpisodeOutline, makeLongProject } from "../api/testUtils.js";
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
    // The count is of this Episode's own drafts, and it renders beside a notice about the memo carried from
    // earlier Episodes. A bare "이전 기록" was readable as either, so the label has to name 대본.
    expect(status.textContent).toContain("이전 대본 초안");
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

  /**
   * A later Episode's prompt reads every earlier memo and silently skips the missing ones. So an Episode with
   * no memo contributes nothing to any script written after it, and the only way to find that out today is to
   * read the finished script — after it has been paid for. This says it before the button.
   */
  describe("이어쓰기 메모가 빠진 앞 회차", () => {
    const laterEpisode = { ...episode("outline_ready", false), episodeNumber: 3 };
    const routed = (episodes: ReturnType<typeof makeLongEpisodeOutline>[]) => vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/long-projects/long"
        ? jsonResponse(200, { project: makeLongProject({ id: "long", episodes }) })
        : jsonResponse(200, { episode: laterEpisode }));

    it("names the earlier Episodes this script will be written without", async () => {
      vi.stubGlobal("fetch", routed([
        makeLongEpisodeOutline({ episodeNumber: 1, title: "1화", status: "completed", continuitySaved: false }),
        makeLongEpisodeOutline({ episodeNumber: 2, title: "2화", status: "completed", continuitySaved: true }),
      ]));
      render(<LongEpisodeScriptScreen projectId="long" episodeNumber={3} onBack={() => {}} />);

      const notice = await screen.findByTestId("episode-script-missing-continuity");
      expect(notice.textContent).toContain("1화");
      // The one that has a memo must not be named — it is going into the prompt.
      expect(notice.textContent).not.toContain("2화");
      // A statement with a way out, not a blocker: skipping a memo is allowed.
      expect(notice.textContent).toContain("그대로 진행하셔도 됩니다");
      expect(screen.getByRole("button", { name: "대본 초안 만들기" })).not.toBeDisabled();
    });

    it("says nothing when every earlier Episode has one", async () => {
      vi.stubGlobal("fetch", routed([
        makeLongEpisodeOutline({ episodeNumber: 1, title: "1화", status: "completed", continuitySaved: true }),
        makeLongEpisodeOutline({ episodeNumber: 2, title: "2화", status: "completed", continuitySaved: true }),
      ]));
      render(<LongEpisodeScriptScreen projectId="long" episodeNumber={3} onBack={() => {}} />);

      await screen.findByRole("button", { name: "대본 초안 만들기" });
      expect(screen.queryByTestId("episode-script-missing-continuity")).toBeNull();
    });

    /**
     * `continuitySaved` is optional and absent means "not determined here". Rendering that as 메모 없음 would
     * state something the screen never checked — the exact shape this project has spent the week removing.
     */
    it("says nothing when the field is absent rather than false", async () => {
      vi.stubGlobal("fetch", routed([
        makeLongEpisodeOutline({ episodeNumber: 1, title: "1화", status: "completed" }),
        makeLongEpisodeOutline({ episodeNumber: 2, title: "2화", status: "completed" }),
      ]));
      render(<LongEpisodeScriptScreen projectId="long" episodeNumber={3} onBack={() => {}} />);

      await screen.findByRole("button", { name: "대본 초안 만들기" });
      expect(screen.queryByTestId("episode-script-missing-continuity")).toBeNull();
    });

    /**
     * The gap the two "says nothing" tests above could not see. Both of them are the screen having checked and
     * found nothing to warn about; a failed project read produced the identical silence, so the paid button was
     * offered with a clean bill of health the screen had never actually obtained.
     *
     * The button stays enabled on purpose — blocking a purchase because an advisory read failed trades one
     * wrong answer for a worse one — so the whole fix is the sentence, and that is what this asserts.
     */
    it("says the check failed rather than falling silent when the project cannot be read", async () => {
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/long-projects/long"
          ? jsonResponse(500, { code: "LONG_PROJECT_STORAGE_ERROR", message: "raw backend detail" })
          : jsonResponse(200, { episode: laterEpisode })));
      render(<LongEpisodeScriptScreen projectId="long" episodeNumber={3} onBack={() => {}} />);

      const notice = await screen.findByTestId("episode-script-continuity-unknown");
      expect(notice.textContent).toContain("확인하지 못했습니다");
      expect(notice.textContent).not.toContain("raw backend detail");
      // Not turned into a false positive either: it must not name an Episode it never read.
      expect(screen.queryByTestId("episode-script-missing-continuity")).toBeNull();
      expect(screen.getByRole("button", { name: "대본 초안 만들기" })).not.toBeDisabled();
    });

    it("never asks about earlier Episodes on the first one", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { episode: episode("outline_ready", false) }));
      vi.stubGlobal("fetch", fetchMock);
      render(<LongEpisodeScriptScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

      await screen.findByRole("button", { name: "대본 초안 만들기" });
      // Episode 1 has nothing before it, so the project list is not worth a request.
      expect(fetchMock.mock.calls.some(([url]) => String(url) === "/long-projects/long")).toBe(false);
      expect(screen.queryByTestId("episode-script-missing-continuity")).toBeNull();
    });
  });
});
