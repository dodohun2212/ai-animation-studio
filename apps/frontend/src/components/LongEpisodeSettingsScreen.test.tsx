import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { LongEpisodeSettingsScreen } from "./LongEpisodeSettingsScreen.js";

const DEFAULTS = { sceneCount: 6, clipDurationSeconds: 5, episodeDurationSeconds: 30 };
const body = (overrides: Record<string, unknown> = {}) => ({
  settings: DEFAULTS,
  projectDefaults: DEFAULTS,
  changeable: true,
  ...overrides,
});

function renderScreen(response: Record<string, unknown>, save?: Record<string, unknown>) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    init?.method === "PUT" ? jsonResponse(200, save ?? { settings: DEFAULTS }) : jsonResponse(200, response));
  vi.stubGlobal("fetch", fetchMock);
  render(<LongEpisodeSettingsScreen projectId="long" episodeNumber={2} onBack={() => {}} />);
  return fetchMock;
}

describe("LongEpisodeSettingsScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens on this Episode's own values, not the project's", async () => {
    renderScreen(body({ settings: { sceneCount: 9, clipDurationSeconds: 10, episodeDurationSeconds: 90 } }));

    expect(await screen.findByTestId("episode-scene-count")).toHaveValue(9);
    expect(screen.getByTestId("episode-clip-duration")).toHaveValue("10");
    expect(screen.getByTestId("episode-settings-total").textContent).toContain("90초");
  });

  // The point of showing the default at all: "8 scenes" means nothing without "the rest of the work is 6".
  it("says when this Episode differs from the project default, and when it does not", async () => {
    renderScreen(body({ settings: { sceneCount: 9, clipDurationSeconds: 5, episodeDurationSeconds: 45 } }));

    const line = await screen.findByTestId("episode-settings-default");
    expect(line.textContent).toContain("6장면 × 5초");
    expect(line.textContent).toContain("기본값과 다릅니다");

    // Typing the default back is not a difference — otherwise the mark would be about having edited, not about
    // the values, and it would stay on after the difference was undone.
    fireEvent.change(screen.getByTestId("episode-scene-count"), { target: { value: "6" } });
    expect(screen.getByTestId("episode-settings-default").textContent).not.toContain("기본값과 다릅니다");
  });

  // The refusal is right — a script is written *for* these numbers — but it has to arrive before the form is
  // filled in, not as a rejected save. Both halves are asserted: the reason is stated AND the controls are
  // actually unusable, because a notice above a working form is just a form with a notice on it.
  it("says why the values are locked and takes the controls away, before anything is typed", async () => {
    renderScreen(body({ changeable: false }));

    const notice = await screen.findByTestId("episode-settings-locked");
    expect(notice.textContent).toContain("대본을 다시 만들어야");
    expect(screen.getByTestId("episode-scene-count")).toBeDisabled();
    expect(screen.getByTestId("episode-clip-duration")).toBeDisabled();
    expect(screen.getByTestId("episode-settings-save")).toBeDisabled();
    expect(screen.getByTestId("episode-settings-restore")).toBeDisabled();
  });

  // The counterpart the rule above needs: without it, a change that locked the form unconditionally would still
  // pass the locked test on its own.
  it("leaves the form usable when the values can still be changed", async () => {
    renderScreen(body());

    await screen.findByTestId("episode-scene-count");
    expect(screen.queryByTestId("episode-settings-locked")).toBeNull();
    expect(screen.getByTestId("episode-scene-count")).not.toBeDisabled();
    expect(screen.getByTestId("episode-clip-duration")).not.toBeDisabled();
  });

  it("sends only the two editable fields, and shows the values the server sends back", async () => {
    const fetchMock = renderScreen(body(), { settings: { sceneCount: 4, clipDurationSeconds: 10, episodeDurationSeconds: 40 } });

    await screen.findByTestId("episode-scene-count");
    fireEvent.change(screen.getByTestId("episode-scene-count"), { target: { value: "4" } });
    fireEvent.change(screen.getByTestId("episode-clip-duration"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("episode-settings-save"));

    await screen.findByTestId("episode-settings-saved");
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT")!;
    expect(String(put[0])).toBe("/long-projects/long/episodes/2/settings");
    // episodeDurationSeconds is derived server-side and rejected outright if sent.
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({ sceneCount: 4, clipDurationSeconds: 10 });
    expect(screen.getByTestId("episode-settings-total").textContent).toContain("40초");
  });

  it("keeps save unavailable until something actually changes", async () => {
    renderScreen(body());

    await screen.findByTestId("episode-scene-count");
    expect(screen.getByTestId("episode-settings-save")).toBeDisabled();

    fireEvent.change(screen.getByTestId("episode-scene-count"), { target: { value: "8" } });
    expect(screen.getByTestId("episode-settings-save")).not.toBeDisabled();

    fireEvent.change(screen.getByTestId("episode-scene-count"), { target: { value: "6" } });
    expect(screen.getByTestId("episode-settings-save")).toBeDisabled();
  });

  // Both bounds are the same on the server, so a value outside them is a round trip that tells the person
  // something the field could have told them while they were still looking at it.
  it("holds the scene count inside the allowed range while it is being typed", async () => {
    renderScreen(body());

    const input = await screen.findByTestId("episode-scene-count");
    fireEvent.change(input, { target: { value: "20" } });
    expect(input).toHaveValue(12);
    fireEvent.change(input, { target: { value: "1" } });
    expect(input).toHaveValue(2);
  });

  it("shows a safe message instead of the backend's own text when a save is refused", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      init?.method === "PUT"
        ? jsonResponse(409, { code: "LONG_EPISODE_SETTINGS_NOT_ALLOWED", message: "raw backend detail" })
        : jsonResponse(200, body()));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeSettingsScreen projectId="long" episodeNumber={2} onBack={() => {}} />);

    await screen.findByTestId("episode-scene-count");
    fireEvent.change(screen.getByTestId("episode-scene-count"), { target: { value: "8" } });
    fireEvent.click(screen.getByTestId("episode-settings-save"));

    const error = await screen.findByTestId("episode-settings-save-error");
    expect(error).toHaveAttribute("data-error-code", "LONG_EPISODE_SETTINGS_NOT_ALLOWED");
    expect(error.textContent).not.toContain("raw backend detail");
    expect(error.textContent).toContain("대본을 다시 만들어야");
  });

  it("shows a malformed load response as a safe error rather than an empty form", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { settings: DEFAULTS, projectDefaults: DEFAULTS })));
    render(<LongEpisodeSettingsScreen projectId="long" episodeNumber={2} onBack={() => {}} />);

    const error = await screen.findByTestId("episode-settings-load-error");
    expect(error).toHaveAttribute("data-error-code", "CLIENT_MALFORMED_RESPONSE");
    expect(screen.queryByTestId("episode-scene-count")).toBeNull();
  });

  // The one value that is not per-Episode. Said on the screen rather than left to be noticed as an absence,
  // because "I cannot find it" and "it is deliberately elsewhere" look identical otherwise.
  it("says the aspect ratio is not per-Episode", async () => {
    renderScreen(body());
    await screen.findByTestId("episode-scene-count");
    await waitFor(() => expect(document.body.textContent).toContain("화면 비율은 작품 전체에 하나"));
  });
});
