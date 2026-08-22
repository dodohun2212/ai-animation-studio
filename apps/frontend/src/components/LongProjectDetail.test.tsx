import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeLongEpisodeOutline, makeLongProject } from "../api/testUtils.js";
import { LongProjectDetail } from "./LongProjectDetail.js";

describe("LongProjectDetail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reopens a project via GET /long-projects/:projectId and shows its summary", async () => {
    const project = makeLongProject({ id: "long_test", title: "우주 방랑자", logline: "귀환 이야기" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} />);

    expect(await screen.findByText("우주 방랑자")).toBeTruthy();
    expect(screen.getByText("귀환 이야기")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/long-projects/long_test");
  });

  it("shows planned and outline_ready episodes distinctly", async () => {
    const project = makeLongProject({
      id: "long_test",
      episodes: [
        makeLongEpisodeOutline({ episodeNumber: 1, title: "1화", status: "outline_ready" }),
        makeLongEpisodeOutline({ episodeNumber: 2, title: "2화", status: "planned" }),
      ],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} />);

    const first = await screen.findByTestId("episode-1");
    expect(first).toHaveAttribute("data-status", "outline_ready");
    const second = screen.getByTestId("episode-2");
    expect(second).toHaveAttribute("data-status", "planned");
  });

  it("shows a safe error instead of the raw backend message when reopening fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(404, { code: "LONG_PROJECT_NOT_FOUND", message: "raw backend detail" })),
    );
    render(<LongProjectDetail projectId="missing" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("raw backend detail");
    expect(alert).toHaveAttribute("data-error-code", "LONG_PROJECT_NOT_FOUND");
  });

  it("calls onOpenSettings and onOpenOutline with the project ID", async () => {
    const project = makeLongProject({ id: "long_test" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    const onOpenSettings = vi.fn();
    const onOpenOutline = vi.fn();
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={onOpenSettings} onOpenOutline={onOpenOutline} />);

    fireEvent.click(await screen.findByRole("button", { name: "장기 프로젝트 설정" }));
    fireEvent.click(screen.getByRole("button", { name: "아웃라인 확인" }));

    expect(onOpenSettings).toHaveBeenCalledWith("long_test");
    expect(onOpenOutline).toHaveBeenCalledWith("long_test");
  });

  it("calls onBack when the list button is clicked", async () => {
    const project = makeLongProject({ id: "long_test" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    const onBack = vi.fn();
    render(<LongProjectDetail projectId="long_test" onBack={onBack} onOpenSettings={() => {}} onOpenOutline={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "목록으로" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
