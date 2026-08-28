import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { workflowStateLabel } from "../utils/workflowStateLabels.js";
import { ProjectDetail } from "./ProjectDetail.js";

describe("ProjectDetail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state, then reopens id/topic/projectType/workflowState/createdAt/updatedAt via GET /projects/:projectId", async () => {
    const project = makeProject({
      id: "sample_project",
      topic: "우주를 여행하는 고양이",
      projectType: "short_project",
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T05:00:00.000Z",
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectDetail projectId="sample_project" onBack={() => {}} onOpenMappingReview={() => {}} />);

    expect(screen.getByText("불러오는 중...")).toBeTruthy();
    expect(await screen.findByText("sample_project")).toBeTruthy();
    expect(screen.getByText("우주를 여행하는 고양이")).toBeTruthy();
    expect(screen.getByText("단편 프로젝트")).toBeTruthy();
    // Topic, project type and workflow state each appear exactly once — the heading owns them, the
    // detail list below carries only the id and timestamps.
    expect(screen.getByText(workflowStateLabel(project.workflowState))).toBeTruthy();
    // Timestamps are rendered as local date+time; the exact stored ISO string stays available as the title.
    expect(screen.getByTitle("2026-08-21T00:00:00.000Z").textContent).toBe(formatDateTime("2026-08-21T00:00:00.000Z"));
    expect(screen.getByTitle("2026-08-21T05:00:00.000Z").textContent).toBe(formatDateTime("2026-08-21T05:00:00.000Z"));
    expect(fetchMock).toHaveBeenCalledWith("/projects/sample_project");
  });

  it("lists the actual warning and error messages, not only their counts", async () => {
    const project = makeProject({ warnings: ["장면 3 프롬프트가 길어 잘렸습니다", "b"], errors: ["Runway 인증 실패"] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    render(<ProjectDetail projectId={project.id} onBack={() => {}} onOpenMappingReview={() => {}} />);

    const errors = await screen.findByTestId("project-errors");
    expect(errors.textContent).toContain("오류 1건");
    expect(errors.textContent).toContain("Runway 인증 실패");
    const warnings = screen.getByTestId("project-warnings");
    expect(warnings.textContent).toContain("경고 2건");
    expect(warnings.textContent).toContain("장면 3 프롬프트가 길어 잘렸습니다");
  });

  it("omits the warning and error sections entirely when there are none", async () => {
    const project = makeProject({ warnings: [], errors: [] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    render(<ProjectDetail projectId={project.id} onBack={() => {}} onOpenMappingReview={() => {}} />);

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByTestId("project-errors")).toBeNull();
    expect(screen.queryByTestId("project-warnings")).toBeNull();
  });

  it("shows a not-found error with its code identifiable via data-error-code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(404, { code: "PROJECT_NOT_FOUND", message: "프로젝트를 찾을 수 없습니다." })),
    );
    render(<ProjectDetail projectId="missing" onBack={() => {}} onOpenMappingReview={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("프로젝트를 찾을 수 없습니다.");
    expect(alert).toHaveAttribute("data-error-code", "PROJECT_NOT_FOUND");
  });

  it("shows a safe error instead of crashing on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<ProjectDetail projectId="sample_project" onBack={() => {}} onOpenMappingReview={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBeTruthy();
  });

  it("calls onBack when the back button is clicked", async () => {
    const project = makeProject();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    const onBack = vi.fn();
    render(<ProjectDetail projectId={project.id} onBack={onBack} onOpenMappingReview={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "목록으로" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("hides the narration link when the project uses neither voice nor subtitles", async () => {
    const project = makeProject({
      id: "sample_project",
      scenes: [{ number: 1, prompt: "", motionPrompt: "", narration: "읽어줄 문장" } as never],
    });
    const settings = {
      projectName: "sample", topic: "주제", genre: "판타지", mood: "따뜻함", character: "", lore: "", fullStory: "",
      durationSeconds: 30, sceneCount: 6, clipDurationSeconds: 5, additionalNotes: "",
      styleNotes: { aspect: "16:9", lighting: "달빛" },
      narrationEnabled: false, subtitlesEnabled: false,
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/settings")) return jsonResponse(200, { settings, sceneCountChangeable: true, aspectRatioChangeable: true });
      return jsonResponse(200, { project });
    }));
    render(<ProjectDetail projectId="sample_project" onBack={() => {}} onOpenMappingReview={() => {}} />);

    await screen.findByText("sample_project");
    // The sentences are stored but never spoken and never burned in — reviewing them changes nothing.
    await waitFor(() => expect(screen.queryByTestId("open-narration-review")).toBeNull());
  });

  it("does not repeat pipeline steps as standalone buttons — the progress bar and the resume button own those", async () => {
    const project = makeProject({ id: "sample_project" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    render(<ProjectDetail projectId={project.id} onBack={() => {}} onOpenMappingReview={() => {}} onOpenStoryPrompt={() => {}} />);

    await screen.findByText("sample_project");
    // Both were also the pipeline bar's step 1 and step 2, and one of them was the resume button's
    // destination too — the same step named three times on one screen.
    expect(screen.queryByRole("button", { name: "참고 이미지 연결 검토" })).toBeNull();
    expect(screen.queryByRole("button", { name: "대본 지시문 확인" })).toBeNull();
    // What stays is what is not a step at all.
    expect(screen.getByRole("button", { name: "프로젝트 설정" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "생성 이미지 모음" })).toBeTruthy();
  });

  it("calls onOpenGallery with the project ID when the 생성 이미지 모음 button is clicked", async () => {
    const project = makeProject({ id: "sample_project" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    const onOpenGallery = vi.fn();
    render(<ProjectDetail projectId={project.id} onBack={() => {}} onOpenMappingReview={() => {}} onOpenGallery={onOpenGallery} />);

    await screen.findByText("sample_project");
    fireEvent.click(screen.getByRole("button", { name: "생성 이미지 모음" }));

    expect(onOpenGallery).toHaveBeenCalledWith("sample_project");
  });

  it("offers exactly one way forward from an Asset-Mapping-approved project, not a duplicate pair", async () => {
    const project = makeProject({ id: "sample_project", workflowState: WorkflowState.AssetMappingApproved });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    const onOpenImageGeneration = vi.fn();
    render(
      <ProjectDetail
        projectId={project.id}
        onBack={() => {}}
        onOpenMappingReview={() => {}}
        onOpenImageGeneration={onOpenImageGeneration}
      />,
    );

    await screen.findByText("sample_project");
    // The standalone shortcut is gone; the resume button is the one forward step.
    expect(screen.queryByRole("button", { name: "장면 이미지 생성" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "이어서 진행하기 · 장면 이미지 생성/검토" }));

    expect(onOpenImageGeneration).toHaveBeenCalledWith("sample_project");
  });

  it("resumes into the screen matching each workflow state, and shows no resume button once the project is terminal", async () => {
    const cases: Array<{ workflowState: WorkflowState; currentVideoJobId?: string; label: string; button: "onOpenStoryPrompt" | "onOpenMappingReview" | "onOpenImageGeneration" | "onOpenVideoPreview" | "onOpenVideoWorkflow" | "onOpenVideoMerge"; args: unknown[] }> = [
      { workflowState: WorkflowState.Ready, label: "이어서 진행하기 · 대본 지시문 확인", button: "onOpenStoryPrompt", args: ["sample_project"] },
      { workflowState: WorkflowState.GeneratingStory, label: "이어서 진행하기 · 대본 지시문 확인", button: "onOpenStoryPrompt", args: ["sample_project"] },
      { workflowState: WorkflowState.WaitingForAssetMappingReview, label: "이어서 진행하기 · 참고 이미지 연결 검토", button: "onOpenMappingReview", args: ["sample_project"] },
      { workflowState: WorkflowState.AssetMappingApproved, label: "이어서 진행하기 · 장면 이미지 생성/검토", button: "onOpenImageGeneration", args: ["sample_project"] },
      { workflowState: WorkflowState.ImagesReview, label: "이어서 진행하기 · 장면 이미지 생성/검토", button: "onOpenImageGeneration", args: ["sample_project"] },
      { workflowState: WorkflowState.WaitingForVideoConfirmation, label: "이어서 진행하기 · 영상 프롬프트 및 비용 확인", button: "onOpenVideoPreview", args: ["sample_project"] },
      { workflowState: WorkflowState.GeneratingVideos, currentVideoJobId: "job-123", label: "이어서 진행하기 · 영상 생성/검토", button: "onOpenVideoWorkflow", args: ["sample_project", "job-123"] },
      { workflowState: WorkflowState.GeneratingVideos, label: "이어서 진행하기 · 영상 프롬프트 및 비용 확인", button: "onOpenVideoPreview", args: ["sample_project"] },
      { workflowState: WorkflowState.VideosApproved, label: "이어서 진행하기 · 최종 영상 병합", button: "onOpenVideoMerge", args: ["sample_project"] },
      { workflowState: WorkflowState.Completed, label: "최종 영상 결과 보기", button: "onOpenVideoMerge", args: ["sample_project"] },
    ];
    for (const testCase of cases) {
      const project = makeProject({ id: "sample_project", workflowState: testCase.workflowState, ...(testCase.currentVideoJobId ? { currentVideoJobId: testCase.currentVideoJobId } : {}) });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
      const handlers = { onOpenStoryPrompt: vi.fn(), onOpenMappingReview: vi.fn(), onOpenImageGeneration: vi.fn(), onOpenVideoPreview: vi.fn(), onOpenVideoWorkflow: vi.fn(), onOpenVideoMerge: vi.fn() };
      render(<ProjectDetail projectId={project.id} onBack={() => {}} {...handlers} />);
      await screen.findByText("sample_project");
      fireEvent.click(screen.getByRole("button", { name: testCase.label }));
      expect(handlers[testCase.button]).toHaveBeenCalledWith(...testCase.args);
      cleanup();
      vi.unstubAllGlobals();
    }

    for (const terminal of [WorkflowState.Failed, WorkflowState.Cancelled]) {
      const project = makeProject({ id: "sample_project", workflowState: terminal });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
      render(<ProjectDetail projectId={project.id} onBack={() => {}} onOpenMappingReview={() => {}} />);
      await screen.findByText("sample_project");
      expect(screen.queryByText(/^이어서 진행하기/)).toBeNull();
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("archives only after the exact topic is entered, then returns to the list", async () => {
    const project = makeProject({ id: "sample_project", topic: "Exact project topic" });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/archive")) return jsonResponse(200, { archivedProjectId: project.id });
      if (url.endsWith("/settings")) return jsonResponse(500, { code: "PROJECT_NOT_FOUND", message: "" });
      return jsonResponse(200, { project });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onArchived = vi.fn();
    render(<ProjectDetail projectId={project.id} onBack={() => {}} onOpenMappingReview={() => {}} onArchived={onArchived} />);

    await screen.findByText(project.id);
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 보관하기" }));
    const archiveCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/archive")).length;
    expect(archiveCalls()).toBe(0);
    const input = screen.getByLabelText("위 내용 그대로 입력");
    fireEvent.change(input, { target: { value: "wrong" } });
    expect(screen.getByRole("button", { name: "보관하기" })).toBeDisabled();
    expect(archiveCalls()).toBe(0);
    fireEvent.change(input, { target: { value: project.topic } });
    fireEvent.click(screen.getByRole("button", { name: "보관하기" }));
    await waitFor(() => expect(onArchived).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenLastCalledWith("/projects/sample_project/archive", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: project.topic }),
    });
  });

  it("keeps the archive dialog open with a safe error when archiving fails", async () => {
    const project = makeProject({ id: "sample_project", topic: "Exact project topic" });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/archive")) return jsonResponse(409, { code: "PROJECT_ARCHIVE_NOT_ALLOWED", message: "raw local path C:\\private" });
      if (url.endsWith("/settings")) return jsonResponse(500, { code: "PROJECT_NOT_FOUND", message: "" });
      return jsonResponse(200, { project });
    }));
    render(<ProjectDetail projectId={project.id} onBack={() => {}} onOpenMappingReview={() => {}} />);
    await screen.findByText(project.id);
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 보관하기" }));
    fireEvent.change(screen.getByLabelText("위 내용 그대로 입력"), { target: { value: project.topic } });
    fireEvent.click(screen.getByRole("button", { name: "보관하기" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", "PROJECT_ARCHIVE_NOT_ALLOWED");
    expect(alert.textContent).not.toContain("private");
  });
});
