import type { LongEpisodeContinuityMemory, LongEpisodeDetail, LongEpisodeOutline } from "@ai-animation-studio/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubFetchByRoute } from "../api/testUtils.js";
import { LongEpisodeContinuityScreen } from "./LongEpisodeContinuityScreen.js";

const memory = (overrides: Partial<LongEpisodeContinuityMemory> = {}): LongEpisodeContinuityMemory => ({
  episodeNumber: 1, episodeSummary: "The hero enters the ruins.", events: ["map recovered"], appearedCharacterIds: ["hero"], characterChanges: [{ id: "hero", change: "injured" }], appearedLocationIds: ["ruins"], itemChanges: [{ id: "map", change: "recovered" }], resolvedConflicts: [], newConflicts: ["guard arrives"], revealedSecretIds: [], remainingSecretIds: ["secret-1"], newForeshadowingIds: ["foreshadow-1"], resolvedForeshadowingIds: [], nextActions: ["escape"], timeElapsed: "one hour", worldChanges: ["the gate is open"], userEdits: "Keep the injury in the next Episode.", updatedAt: "2026-08-23T00:00:00.000Z", ...overrides,
});
const CONTINUITY_URL = "/long-projects/long/episodes/1/continuity";
const EPISODE_URL = "/long-projects/long/episodes/1";
/**
 * The Episode's own outline, fetched only when no memo exists yet so the four carried-forward fields can be
 * prefilled. Blank by default: a test that says nothing about the outline gets no prefill and sees the blank
 * form it always saw.
 */
const outline = (overrides: Partial<LongEpisodeDetail> = {}): { episode: LongEpisodeDetail } => {
  const base: LongEpisodeDetail = {
    episodeNumber: 1, title: "Episode", summary: "", mainEvent: "", conflict: "", cliffhanger: "", nextEpisodeHook: "",
    status: "videos_approved", approved: true, scriptRevision: 1, scriptHistoryCount: 1, updatedAt: "2026-09-05T00:00:00.000Z",
  };
  return { episode: { ...base, ...overrides } };
};

// approved/scriptRevision/scriptHistoryCount used to be here. They are LongEpisodeDetail fields, and this is an
// outline — the server never sends them on it. Typing the fixture is what said so.
const nextEpisode: LongEpisodeOutline = { episodeNumber: 2, title: "Episode 2", summary: "", mainEvent: "", conflict: "", cliffhanger: "", nextEpisodeHook: "", status: "outline_ready" };

describe("LongEpisodeContinuityScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads existing memory without an automatic save", async () => {
    const fetchMock = stubFetchByRoute({ [`GET ${CONTINUITY_URL}`]: { memory: memory(), canSave: true }, [`GET ${EPISODE_URL}`]: outline({ summary: "outline summary" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect(await screen.findByDisplayValue("The hero enters the ruins.")).toBeTruthy();
    expect(screen.getByTestId("continuity-events")).toHaveValue("map recovered");
    // A saved memo is a person's reviewed record: the outline is never read, so it cannot overwrite one.
    expect(screen.queryByTestId("continuity-prefilled")).toBeNull();
    expect(fetchMock.mock.calls.every((call) => (call[1] as RequestInit | undefined) === undefined)).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === EPISODE_URL)).toBe(false);
  });

  it("saves only after the explicit save button with reviewed list and JSON fields", async () => {
    const fetchMock = stubFetchByRoute({
      [`GET ${CONTINUITY_URL}`]: { memory: null, canSave: true },
      [`GET ${EPISODE_URL}`]: outline(),
      [`PUT ${CONTINUITY_URL}`]: { memory: memory({ episodeSummary: "Reviewed summary", events: ["event one", "event two"], characterChanges: [{ id: "hero" }], itemChanges: [] }), nextEpisode },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenNextEpisode={() => {}} />);

    await screen.findByTestId("continuity-save");
    fireEvent.change(screen.getByTestId("continuity-summary"), { target: { value: "Reviewed summary" } });
    fireEvent.change(screen.getByTestId("continuity-events"), { target: { value: "event one\nevent two" } });
    fireEvent.change(screen.getByTestId("continuity-character-changes"), { target: { value: "[{\"id\":\"hero\"}]" } });
    fireEvent.click(screen.getByTestId("continuity-save"));

    expect(await screen.findByTestId("continuity-save-success")).toHaveTextContent("에피소드 2");
    const put = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "PUT");
    const [url, init] = put as [string, RequestInit];
    expect(url).toBe(CONTINUITY_URL);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual(expect.objectContaining({ memory: expect.objectContaining({ episodeSummary: "Reviewed summary", events: ["event one", "event two"], characterChanges: [{ id: "hero" }], itemChanges: [] }) }));
  });

  /**
   * The next Episode usually has nothing but an outline, and the screen has to take it.
   *
   * These notes are written before the next Episode's script exists, and the directory holding an Episode's
   * record is created by that script save and by nothing else. So the ordinary payload here carries the outline
   * fields alone — no approved, no scriptRevision, no scriptHistoryCount. The response validator required all
   * three, and the server was sending null instead of the outline, which is how 캡틴D was told Episode 4 of ten
   * was the last one. Both halves have to hold, or the screen throws away a real answer as malformed.
   */
  it("names an unscripted next Episode from an outline-only response", async () => {
    const fetchMock = stubFetchByRoute({
      [`GET ${CONTINUITY_URL}`]: { memory: null, canSave: true },
      [`GET ${EPISODE_URL}`]: outline(),
      [`PUT ${CONTINUITY_URL}`]: { memory: memory({ episodeSummary: "Reviewed summary" }), nextEpisode: { episodeNumber: 5, title: "Episode 5", summary: "", mainEvent: "", conflict: "", cliffhanger: "", nextEpisodeHook: "", status: "outline_ready" as const } },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenNextEpisode={() => {}} />);

    await screen.findByTestId("continuity-save");
    fireEvent.change(screen.getByTestId("continuity-summary"), { target: { value: "Reviewed summary" } });
    fireEvent.click(screen.getByTestId("continuity-save"));

    const success = await screen.findByTestId("continuity-save-success");
    expect(success).toHaveTextContent("에피소드 5");
    expect(success).not.toHaveTextContent("마지막 에피소드");
    // Named, so it can be opened — the thing a null could never offer.
    expect(screen.getByTestId("continuity-open-next-episode")).toBeTruthy();
  });

  /**
   * The four boxes this fills were all written and approved earlier in this same Episode's flow, and the screen
   * was asking for them again from blank. Only these four: `continuityContext()` in episode-scripts.service.ts
   * carries summary/events/character_changes/next_actions into the next Episode's prompt and nothing else, so
   * padding the other fields would be typing the person did not ask for, into boxes nothing reads.
   */
  it("prefills the carried-forward fields from the Episode's own outline when no memo exists yet", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({
      [`GET ${CONTINUITY_URL}`]: { memory: null, canSave: true },
      [`GET ${EPISODE_URL}`]: outline({ summary: "폐허에 들어선다", mainEvent: "지도를 찾는다", conflict: "경비병이 온다", nextEpisodeHook: "탈출한다" }),
    }));
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect(await screen.findByDisplayValue("폐허에 들어선다")).toBeTruthy();
    expect(screen.getByTestId("continuity-events")).toHaveValue("지도를 찾는다");
    expect(screen.getByTestId("continuity-newConflicts")).toHaveValue("경비병이 온다");
    expect(screen.getByTestId("continuity-nextActions")).toHaveValue("탈출한다");
    // Nothing is saved by appearing — the header promises this and the prefill must not quietly break it.
    expect(screen.getByTestId("continuity-prefilled")).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method !== undefined)).toBe(false);
  });

  /**
   * Thirteen identical boxes made every blank one look like an unfinished job, which is why they were all
   * blank. Nine of them are written to disk and read back by this screen and nothing else — CLI's grep found no
   * consumer, in TypeScript or Python. They stay (an existing Episode's notes must not vanish) but they no
   * longer sit among the four that decide the next Episode's script.
   */
  it("separates the fields the next Episode reads from the ones only this screen ever reads back", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({
      [`GET ${CONTINUITY_URL}`]: { memory: memory(), canSave: true },
      [`GET ${EPISODE_URL}`]: outline(),
    }));
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const fold = await screen.findByTestId("continuity-record-only");
    expect(fold.textContent).toContain("다음 화 대본에는 들어가지 않습니다");
    // "그럼 어디서 바꾸냐" is the immediate next question, and it has a real answer: the prompt reads the
    // Story Bible item's status and reveal episode, never these ID boxes.
    expect(fold.textContent).toContain("설정집");

    // The four carried fields are outside the fold; the inert ones are inside it. Asserting containment rather
    // than mere presence — a fold that holds everything, or nothing, would pass a presence check.
    for (const carried of ["continuity-summary", "continuity-events", "continuity-nextActions", "continuity-character-changes"]) {
      expect(fold.contains(screen.getByTestId(carried))).toBe(false);
    }
    for (const inert of ["continuity-appearedCharacterIds", "continuity-revealedSecretIds", "continuity-worldChanges", "continuity-item-changes", "continuity-time-elapsed", "continuity-user-edits"]) {
      expect(fold.contains(screen.getByTestId(inert))).toBe(true);
    }
    // Still editable and still saved — this is a re-ordering, not a removal.
    expect(screen.getByTestId("continuity-appearedCharacterIds")).toHaveValue("hero");
  });

  it("leaves the form blank when the outline has nothing to offer, and says nothing about a prefill", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({
      [`GET ${CONTINUITY_URL}`]: { memory: null, canSave: true },
      [`GET ${EPISODE_URL}`]: outline(),
    }));
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    await screen.findByTestId("continuity-summary");
    expect(screen.getByTestId("continuity-summary")).toHaveValue("");
    expect(screen.queryByTestId("continuity-prefilled")).toBeNull();
  });

  it("rejects malformed change JSON locally without sending a save", async () => {
    const fetchMock = stubFetchByRoute({ [`GET ${CONTINUITY_URL}`]: { memory: null, canSave: true }, [`GET ${EPISODE_URL}`]: outline() });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    await screen.findByTestId("continuity-save");
    fireEvent.change(screen.getByTestId("continuity-summary"), { target: { value: "A reviewed summary" } });
    fireEvent.change(screen.getByTestId("continuity-character-changes"), { target: { value: "not json" } });
    fireEvent.click(screen.getByTestId("continuity-save"));

    expect(await screen.findByTestId("continuity-error")).toHaveAttribute("data-error-code", "INVALID_REQUEST");
    // The count is no longer the assertion — reads on mount are allowed to grow. Nothing may be written.
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method !== undefined)).toBe(false);
  });

  it("shows malformed load responses as a safe error", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ [`GET ${CONTINUITY_URL}`]: { memory: { episodeNumber: 1 }, canSave: true }, [`GET ${EPISODE_URL}`]: outline() }));
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect((await screen.findByTestId("continuity-error")).getAttribute("data-error-code")).toBe("CLIENT_MALFORMED_RESPONSE");
  });

  it("says saving is not possible yet before anything is typed, and takes the fields away", async () => {
    // The refusal itself is right — these notes describe how an Episode ended, so they only mean something once
    // its video work has started. What was wrong was hearing it at the end: the screen used to open, accept a
    // whole form, and return 409 on save. The refusal is identical either way; only its timing could change.
    // Both halves are asserted — the reason is stated AND the inputs are actually unusable — because a notice
    // above a working form is just a form with a notice on it.
    vi.stubGlobal("fetch", stubFetchByRoute({ [`GET ${CONTINUITY_URL}`]: { memory: null, canSave: false }, [`GET ${EPISODE_URL}`]: outline() }));
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const notice = await screen.findByTestId("continuity-not-saveable");
    expect(notice.textContent).toContain("영상 작업이 시작된 뒤");
    expect(screen.getByTestId("continuity-summary")).toBeDisabled();
    expect(screen.getByTestId("continuity-save")).toBeDisabled();
  });

  it("leaves the form usable when saving is allowed", async () => {
    // The counterpart the rule above needs: without it, a change that disabled the form unconditionally would
    // still pass the test that only checks the disabled case.
    vi.stubGlobal("fetch", stubFetchByRoute({ [`GET ${CONTINUITY_URL}`]: { memory: null, canSave: true }, [`GET ${EPISODE_URL}`]: outline() }));
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    await screen.findByTestId("continuity-summary");
    expect(screen.queryByTestId("continuity-not-saveable")).toBeNull();
    expect(screen.getByTestId("continuity-summary")).not.toBeDisabled();
    expect(screen.getByTestId("continuity-save")).not.toBeDisabled();
  });
});
