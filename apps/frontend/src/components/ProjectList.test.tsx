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

  /**
   * 2026-09-19 — 목록이 줄에서 **9:16 프레임 시트**로 바뀌었고, 상태를 칩이 아니라 프레임이 말합니다.
   *
   * 🔴 이 네 짝이 지키는 건 모양 취향이 아니라 **정보가 실린 자리**입니다. 전에는 끝난 프로젝트에도 100% 로
   * 꽉 찬 보라 막대가 붙었고, 그게 화면에서 제일 진한 색이면서 아무 말도 하지 않았습니다. 지금 「어디까지
   * 왔나」는 수면선의 높이가 말하고, 끝난 프레임에는 그 선이 없습니다 — **없는 것이 상태입니다.**
   */
  describe("프레임 시트", () => {
    function renderWith(projects: ReturnType<typeof makeProject>[]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects })));
      return render(<ProjectList refreshToken={0} onOpenProject={() => {}} onCreateNew={() => {}} />);
    }

    it("만드는 것과 같은 9:16 비율로 그린다", async () => {
      renderWith([makeProject({ id: "a", workflowState: WorkflowState.Ready })]);
      const frame = await screen.findByTestId("project-frame");
      // 🔴 64px 정사각 썸네일이었습니다. 이 앱이 내놓는 건 전부 세로 릴인데, 목록만 결과물과 다른 모양을
      // 하고 있으면 목록을 봐서는 무엇을 만들고 있는지 알 수 없습니다.
      expect(frame.querySelector(".aspect-\\[9\\/16\\]")).toBeTruthy();
    });

    it("끝난 프로젝트에는 진행 막대도 수면선도 없다", async () => {
      renderWith([makeProject({ id: "done", workflowState: WorkflowState.Completed })]);
      const frame = await screen.findByTestId("project-frame");

      expect(frame.getAttribute("data-shape")).toBe("done");
      // 🔴 이 목록에서 role=progressbar 가 하나라도 나오면 그건 되살아난 100% 막대입니다.
      expect(screen.queryByRole("progressbar")).toBeNull();
      expect(within(frame).queryByTestId("project-frame-waterline")).toBeNull();
      // 🟠 그래도 상태는 반드시 글자로 한 번 말합니다 — 색·모양만으로 상태를 말하지 않는다는 §6.
      expect(within(frame).getByText(workflowStateLabel(WorkflowState.Completed))).toBeTruthy();
    });

    it("진행 중인 것에만 수면선이 있고, 그 높이가 어디까지 왔는지 말한다", async () => {
      renderWith([
        makeProject({ id: "early", workflowState: WorkflowState.GeneratingStory }),
        makeProject({ id: "late", workflowState: WorkflowState.Rendering }),
      ]);
      const [early, late] = await screen.findAllByTestId("project-frame");

      expect(early?.getAttribute("data-shape")).toBe("developing");
      expect(late?.getAttribute("data-shape")).toBe("developing");

      const earlyLine = within(early as HTMLElement).getByTestId("project-frame-waterline") as HTMLElement;
      const lateLine = within(late as HTMLElement).getByTestId("project-frame-waterline") as HTMLElement;
      /*
       * 🔴 「선이 있다」만으로는 부족합니다 — 두 프레임 다 선이 있어도 같은 높이면 그 선은 막대가 100% 를
       * 그리던 것과 똑같이 **아무 말도 하지 않습니다.** 늦게 온 쪽이 더 위에 있어야(= 안 현상된 부분이 더
       * 적어야) 이 선이 진행을 말하는 것입니다.
       */
      expect(Number.parseFloat(lateLine.style.bottom)).toBeLessThan(Number.parseFloat(earlyLine.style.bottom));
    });

    it("멈춘 것은 색이 빠지고 가로지르는 선이 생긴다 — 진행 중과 다른 모양", async () => {
      renderWith([makeProject({ id: "x", workflowState: WorkflowState.Failed })]);
      const frame = await screen.findByTestId("project-frame");

      expect(frame.getAttribute("data-shape")).toBe("stopped");
      expect(within(frame).getByTestId("project-frame-cut")).toBeTruthy();
      // 멈춘 것에 수면선을 그리면 「아직 돌아가는 중」으로 읽힙니다. 둘은 서로 배타적입니다.
      expect(within(frame).queryByTestId("project-frame-waterline")).toBeNull();
      expect(within(frame).getByText(workflowStateLabel(WorkflowState.Failed))).toBeTruthy();
    });
  });
});
