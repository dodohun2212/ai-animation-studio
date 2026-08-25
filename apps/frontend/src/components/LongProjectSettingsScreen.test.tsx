import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeLongProject, makeLongProjectSettings } from "../api/testUtils.js";
import { LongProjectSettingsScreen } from "./LongProjectSettingsScreen.js";

describe("LongProjectSettingsScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reopens saved settings via GET and saves an edited title through PATCH", async () => {
    const settings = makeLongProjectSettings({ title: "우주 방랑자", logline: "귀환 이야기" });
    const project = makeLongProject({ settings: { ...settings, title: "새 제목" } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { settings }))
      .mockResolvedValueOnce(jsonResponse(200, { project }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    expect(await screen.findByDisplayValue("우주 방랑자")).toBeTruthy();
    expect(fetchMock.mock.calls[0]).toEqual(["/long-projects/long_test/settings"]);
    fireEvent.change(screen.getByDisplayValue("우주 방랑자"), { target: { value: "새 제목" } });
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/long-projects/long_test/settings");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toMatchObject({ settings: { title: "새 제목", logline: "귀환 이야기" } });
  });

  it("blocks an empty title before sending PATCH", async () => {
    const settings = makeLongProjectSettings();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { settings })));
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    const title = await screen.findByDisplayValue(settings.title);
    fireEvent.change(title, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    expect(await screen.findByRole("alert")).toHaveAttribute("data-error-code", "INVALID_REQUEST");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("blocks a non-positive episode count before sending PATCH", async () => {
    const settings = makeLongProjectSettings();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { settings })));
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByDisplayValue(settings.title);
    fireEvent.change(screen.getByDisplayValue(String(settings.episodeCount)), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    expect(await screen.findByRole("alert")).toHaveAttribute("data-error-code", "INVALID_REQUEST");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("shows a safe error instead of the raw backend message when reopening fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(404, { code: "LONG_PROJECT_NOT_FOUND", message: "raw backend detail" })),
    );
    render(<LongProjectSettingsScreen projectId="missing" onBack={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("raw backend detail");
    expect(alert).toHaveAttribute("data-error-code", "LONG_PROJECT_NOT_FOUND");
  });

  it("says the Episode length field does not change the finished video", async () => {
    // Nothing downstream reads episodeDurationSeconds: scripts are always six scenes and the video step
    // submits a hardcoded 5 seconds per scene, so an Episode is always 30 seconds long. The field stays
    // editable (it is part of the stored settings contract) but must not read as if it shapes the output.
    const settings = makeLongProjectSettings({ episodeDurationSeconds: 90 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { settings })));
    render(<LongProjectSettingsScreen projectId="long_test" onBack={() => {}} />);

    const note = await screen.findByTestId("episode-duration-effect-note");
    expect(note.textContent).toContain("반영되지 않습니다");
    expect(note.textContent).toContain("30초");
  });
});
