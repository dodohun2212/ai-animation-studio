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

  it("counts the projects waiting on the user, which is the whole point of the summary line", async () => {
    // Python kept this line pinned to the bottom of its window (ui.py's footer_status) and it answers one
    // question without scrolling: is anything waiting on me. Two of these three projects are mid-flight and
    // only one is actually waiting for a confirmation, so a naive "not finished" count would say two.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects: [
      makeProject({ id: "a", workflowState: WorkflowState.WaitingForVideoConfirmation }),
      makeProject({ id: "b", workflowState: WorkflowState.GeneratingImages }),
      makeProject({ id: "c", workflowState: WorkflowState.Completed }),
    ] })));
    render(<ProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={() => {}} />);

    const summary = await screen.findByTestId("dashboard-summary");
    expect(summary.textContent).toContain("단기 프로젝트 3개");
    expect(screen.getByTestId("dashboard-waiting-count").textContent).toContain("영상 생성 확인 대기 1개");
  });

  it("renders the summary without reading credential status", async () => {
    // Python's version of this line also showed the OpenAI key state. This one does not, on purpose:
    // App.test.tsx pins in two separate tests that browsing the project list never calls
    // /settings/providers, and reading credentials as a side effect of navigation is the wrong trade. The
    // stub throws on any other route, so a re-added fetch fails here instead of silently in App.test.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== "/projects") throw new Error(`Unexpected fetch: ${String(input)}`);
      return jsonResponse(200, { projects: [makeProject({ id: "a", workflowState: WorkflowState.Ready })] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={() => {}} />);

    expect((await screen.findByTestId("dashboard-summary")).textContent).toContain("단기 프로젝트 1개");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/projects"]);
  });

  /**
   * A photo card is a short project on disk and must not be one on screen.
   *
   * 🔴 This list showed five 명언 cards under 단기 프로젝트 with a progress bar counting steps their pipeline
   * skips. They have their own sidebar entry, their own front door, and now their own list there — so the only
   * honest thing this list can say about them is nothing.
   *
   * The summary count is asserted too: it reads the same filtered set, so "단기 프로젝트 N개" cannot drift
   * back to counting rows the person cannot see here.
   */
  it("leaves photo cards out — they are not short projects on screen", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects: [
      makeProject({ id: "sample_project", workflowState: WorkflowState.Ready }),
      makeProject({ id: "명언_불광불급", workflowState: WorkflowState.Completed, photoCard: true }),
      makeProject({ id: "명언_전인미답", workflowState: WorkflowState.Completed, photoCard: true }),
    ] })));
    render(<ProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={() => {}} />);

    expect(await screen.findByText("sample_project")).toBeTruthy();
    expect(screen.queryByText("명언_불광불급")).toBeNull();
    expect(screen.queryByText("명언_전인미답")).toBeNull();
    expect(screen.getByTestId("dashboard-summary").textContent).toContain("단기 프로젝트 1개");
  });

  // Cards filling the whole answer is not an empty store, but it is an empty list — and the sentence a person
  // reads has to match what they see, not what the response carried.
  it("shows the empty-store message when every project in the answer is a photo card", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects: [
      makeProject({ id: "명언_불광불급", workflowState: WorkflowState.Completed, photoCard: true }),
    ] })));
    render(<ProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={() => {}} />);

    expect(await screen.findByText("아직 생성된 프로젝트가 없습니다.")).toBeTruthy();
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
