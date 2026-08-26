import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeLongProjectSummary } from "../api/testUtils.js";
import { LongProjectList } from "./LongProjectList.js";

describe("LongProjectList", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state, then an empty-store message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects: [] })));
    render(<LongProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={() => {}} />);

    expect(screen.getByText("불러오는 중...")).toBeTruthy();
    expect(await screen.findByText("아직 생성된 장기 프로젝트가 없습니다.")).toBeTruthy();
  });

  it("shows title, logline, outlineStatus and episodeCount for each project (GET /long-projects)", async () => {
    const project = makeLongProjectSummary({
      id: "long_sample",
      title: "우주 방랑자",
      logline: "떠도는 항해사가 고향 별을 되찾는다.",
      episodeCount: 5,
      outlineStatus: "planned",
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { projects: [project] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={() => {}} />);

    const card = await screen.findByRole("button", { name: /우주 방랑자/ });
    expect(within(card).getByText("우주 방랑자")).toBeTruthy();
    expect(within(card).getByText("떠도는 항해사가 고향 별을 되찾는다.")).toBeTruthy();
    // The card shows the Korean label now, not the stored enum — that was the point of the change.
    expect(within(card).getByText(/계획됨/)).toBeTruthy();
    expect(within(card).queryByText(/planned/)).toBeNull();
    expect(within(card).getByText(/5화/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/long-projects");
  });

  it("shows a backend error message with its code identifiable via data-error-code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(500, { code: "LONG_PROJECT_STORAGE_ERROR", message: "raw backend detail" })),
    );
    render(<LongProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("raw backend detail");
    expect(alert).toHaveAttribute("data-error-code", "LONG_PROJECT_STORAGE_ERROR");
  });

  it("reopens a project by calling onOpenProject with the clicked project's ID", async () => {
    const project = makeLongProjectSummary({ id: "reopen_me", title: "재열기 대상" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects: [project] })));
    const onOpenProject = vi.fn();
    render(<LongProjectList refreshToken={0} onOpenProject={onOpenProject} onCreateNew={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: /재열기 대상/ }));

    expect(onOpenProject).toHaveBeenCalledWith("reopen_me");
  });

  it("calls onCreateNew when the new-project button is clicked", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects: [] })));
    const onCreateNew = vi.fn();
    render(<LongProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={onCreateNew} />);

    fireEvent.click(screen.getByRole("button", { name: "새 장기 프로젝트" }));

    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });
});
