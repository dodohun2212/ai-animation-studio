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
    fireEvent.click(await screen.findByRole("button", { name: "대본 초안 만들기" }));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(JSON.stringify(script, null, 2)));
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
});
