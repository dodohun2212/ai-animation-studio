import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { ShortProjectSettingsScreen } from "./ShortProjectSettingsScreen.js";

const settings = {
  projectName: "별의 지도", topic: "별을 찾는 아이", genre: "판타지", mood: "따뜻함", character: "아이",
  lore: "별의 세계", fullStory: "별을 찾는다.", durationSeconds: 30, sceneCount: 6,
  additionalNotes: "", styleNotes: { aspect: "16:9", lighting: "달빛" },
};

describe("ShortProjectSettingsScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reopens saved Wizard settings and saves an edited topic through PATCH", async () => {
    const project = makeProject({ topic: "새 주제" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { settings }))
      .mockResolvedValueOnce(jsonResponse(200, { project, settings: { ...settings, topic: "새 주제" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);

    expect(await screen.findByDisplayValue("별의 지도")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("별을 찾는 아이"), { target: { value: "새 주제" } });
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/settings");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toMatchObject({ settings: { topic: "새 주제", sceneCount: 6 } });
  });

  it("blocks empty project name before sending PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { settings }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ShortProjectSettingsScreen projectId="sample_project" onBack={() => {}} />);
    const name = await screen.findByDisplayValue("별의 지도");
    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));
    expect(await screen.findByRole("alert")).toHaveAttribute("data-error-code", "INVALID_REQUEST");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
