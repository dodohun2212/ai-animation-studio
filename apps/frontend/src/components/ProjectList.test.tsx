import { WorkflowState } from "@ai-animation-studio/shared";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { workflowStateLabel } from "../utils/workflowStateLabels.js";
import { ProjectList } from "./ProjectList.js";

describe("ProjectList", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state, then an empty-store message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects: [] })));
    render(<ProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={() => {}} />);

    expect(screen.getByText("불러오는 중...")).toBeTruthy();
    expect(await screen.findByText("아직 생성된 프로젝트가 없습니다.")).toBeTruthy();
  });

  it("shows id, topic, workflowState and updatedAt for each project", async () => {
    const project = makeProject({
      id: "sample_project",
      topic: "우주를 여행하는 고양이",
      workflowState: WorkflowState.Ready,
      updatedAt: "2026-08-21T05:00:00.000Z",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects: [project] })));
    render(<ProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={() => {}} />);

    const card = await screen.findByRole("button", { name: /sample_project/ });
    expect(within(card).getByText("sample_project")).toBeTruthy();
    expect(within(card).getByText("우주를 여행하는 고양이")).toBeTruthy();
    expect(within(card).getByText(workflowStateLabel(WorkflowState.Ready))).toBeTruthy();
    // Shown as local date+time; the stored ISO string stays available as the title attribute.
    expect(within(card).getByTitle("2026-08-21T05:00:00.000Z").textContent).toBe(formatDateTime("2026-08-21T05:00:00.000Z"));
  });

  it("keeps the Backend's response order", async () => {
    const projects = [
      makeProject({ id: "third", topic: "third topic" }),
      makeProject({ id: "first", topic: "first topic" }),
      makeProject({ id: "second", topic: "second topic" }),
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects })));
    render(<ProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={() => {}} />);

    const buttons = await screen.findAllByRole("button", { name: /third|first|second/ });
    expect(buttons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("third"),
      expect.stringContaining("first"),
      expect.stringContaining("second"),
    ]);
  });

  it("shows a fixed safe error message (never the backend's own text) with its code identifiable via data-error-code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "internal: failed to list projects directory" })),
    );
    render(<ProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    expect(alert).toHaveAttribute("data-error-code", "PROJECT_STORAGE_ERROR");
  });

  it("does not clear a previously successful list when a refresh fails, and shows the error alongside it", async () => {
    const project = makeProject({ id: "sample_project" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { projects: [project] }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "PROJECT_STORAGE_ERROR", message: "internal: failed to list projects directory" }));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<ProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={() => {}} />);
    await screen.findByRole("button", { name: /sample_project/ });

    rerender(<ProjectList refreshToken={1} onOpenProject={() => {}} onCreateNew={() => {}} />);

    await screen.findByRole("alert");
    // The previously displayed project must still be visible alongside the error.
    expect(screen.getByRole("button", { name: /sample_project/ })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
  });

  it("shows a safe error instead of crashing when the network fails or the response is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<ProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBeTruthy();
  });

  it("calls onOpenProject with the clicked project's ID", async () => {
    const project = makeProject({ id: "sample_project" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects: [project] })));
    const onOpenProject = vi.fn();
    render(<ProjectList refreshToken={0} onOpenProject={onOpenProject} onCreateNew={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: /sample_project/ }));

    expect(onOpenProject).toHaveBeenCalledWith("sample_project");
  });

  it("calls onCreateNew when the new-project button is clicked", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects: [] })));
    const onCreateNew = vi.fn();
    render(<ProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={onCreateNew} />);

    fireEvent.click(screen.getByRole("button", { name: "새 프로젝트" }));

    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });
});
