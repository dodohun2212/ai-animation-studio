import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { LongEpisodeContinuityScreen } from "./LongEpisodeContinuityScreen.js";

const memory = (overrides = {}) => ({
  episodeNumber: 1, episodeSummary: "The hero enters the ruins.", events: ["map recovered"], appearedCharacterIds: ["hero"], characterChanges: [{ id: "hero", change: "injured" }], appearedLocationIds: ["ruins"], itemChanges: [{ id: "map", change: "recovered" }], resolvedConflicts: [], newConflicts: ["guard arrives"], revealedSecretIds: [], remainingSecretIds: ["secret-1"], newForeshadowingIds: ["foreshadow-1"], resolvedForeshadowingIds: [], nextActions: ["escape"], timeElapsed: "one hour", worldChanges: ["the gate is open"], userEdits: "Keep the injury in the next Episode.", updatedAt: "2026-08-23T00:00:00.000Z", ...overrides,
});
const nextEpisode = { episodeNumber: 2, title: "Episode 2", summary: "", mainEvent: "", conflict: "", cliffhanger: "", nextEpisodeHook: "", status: "outline_ready" as const, approved: false, scriptRevision: 0, scriptHistoryCount: 0 };

describe("LongEpisodeContinuityScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads existing memory without an automatic save", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { memory: memory(), canSave: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect(await screen.findByDisplayValue("The hero enters the ruins.")).toBeTruthy();
    expect(screen.getByTestId("continuity-events")).toHaveValue("map recovered");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/long-projects/long/episodes/1/continuity");
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("saves only after the explicit save button with reviewed list and JSON fields", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { memory: null, canSave: true }))
      .mockResolvedValueOnce(jsonResponse(200, { memory: memory({ episodeSummary: "Reviewed summary", events: ["event one", "event two"], characterChanges: [{ id: "hero" }], itemChanges: [] }), nextEpisode }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} onOpenNextEpisode={() => {}} />);

    await screen.findByTestId("continuity-save");
    fireEvent.change(screen.getByTestId("continuity-summary"), { target: { value: "Reviewed summary" } });
    fireEvent.change(screen.getByTestId("continuity-events"), { target: { value: "event one\nevent two" } });
    fireEvent.change(screen.getByTestId("continuity-character-changes"), { target: { value: "[{\"id\":\"hero\"}]" } });
    fireEvent.click(screen.getByTestId("continuity-save"));

    expect(await screen.findByTestId("continuity-save-success")).toHaveTextContent("에피소드 2");
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/long-projects/long/episodes/1/continuity");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual(expect.objectContaining({ memory: expect.objectContaining({ episodeSummary: "Reviewed summary", events: ["event one", "event two"], characterChanges: [{ id: "hero" }], itemChanges: [] }) }));
  });

  it("rejects malformed change JSON locally without sending a save", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { memory: null, canSave: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    await screen.findByTestId("continuity-save");
    fireEvent.change(screen.getByTestId("continuity-summary"), { target: { value: "A reviewed summary" } });
    fireEvent.change(screen.getByTestId("continuity-character-changes"), { target: { value: "not json" } });
    fireEvent.click(screen.getByTestId("continuity-save"));

    expect(await screen.findByTestId("continuity-error")).toHaveAttribute("data-error-code", "INVALID_REQUEST");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows malformed load responses as a safe error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { memory: { episodeNumber: 1 }, canSave: true })));
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect((await screen.findByTestId("continuity-error")).getAttribute("data-error-code")).toBe("CLIENT_MALFORMED_RESPONSE");
  });

  it("says saving is not possible yet before anything is typed, and takes the fields away", async () => {
    // The refusal itself is right — these notes describe how an Episode ended, so they only mean something once
    // its video work has started. What was wrong was hearing it at the end: the screen used to open, accept a
    // whole form, and return 409 on save. The refusal is identical either way; only its timing could change.
    // Both halves are asserted — the reason is stated AND the inputs are actually unusable — because a notice
    // above a working form is just a form with a notice on it.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { memory: null, canSave: false })));
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    const notice = await screen.findByTestId("continuity-not-saveable");
    expect(notice.textContent).toContain("영상 작업이 시작된 뒤");
    expect(screen.getByTestId("continuity-summary")).toBeDisabled();
    expect(screen.getByTestId("continuity-save")).toBeDisabled();
  });

  it("leaves the form usable when saving is allowed", async () => {
    // The counterpart the rule above needs: without it, a change that disabled the form unconditionally would
    // still pass the test that only checks the disabled case.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { memory: null, canSave: true })));
    render(<LongEpisodeContinuityScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    await screen.findByTestId("continuity-summary");
    expect(screen.queryByTestId("continuity-not-saveable")).toBeNull();
    expect(screen.getByTestId("continuity-summary")).not.toBeDisabled();
    expect(screen.getByTestId("continuity-save")).not.toBeDisabled();
  });
});
