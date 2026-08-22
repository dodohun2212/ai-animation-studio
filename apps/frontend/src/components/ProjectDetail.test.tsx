import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeProject } from "../api/testUtils.js";
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
    expect(screen.getByText("short_project")).toBeTruthy();
    expect(screen.getByText(project.workflowState)).toBeTruthy();
    expect(screen.getByText("2026-08-21T00:00:00.000Z")).toBeTruthy();
    expect(screen.getByText("2026-08-21T05:00:00.000Z")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/projects/sample_project");
  });

  it("shows warnings and errors counts", async () => {
    const project = makeProject({ warnings: ["a", "b"], errors: ["c"] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    render(<ProjectDetail projectId={project.id} onBack={() => {}} onOpenMappingReview={() => {}} />);

    expect(await screen.findByText("2건")).toBeTruthy();
    expect(screen.getByText("1건")).toBeTruthy();
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

  it("calls onOpenMappingReview with the project ID when the Asset Mapping button is clicked", async () => {
    const project = makeProject({ id: "sample_project" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    const onOpenMappingReview = vi.fn();
    render(<ProjectDetail projectId={project.id} onBack={() => {}} onOpenMappingReview={onOpenMappingReview} />);

    await screen.findByText("sample_project");
    fireEvent.click(screen.getByRole("button", { name: "Asset Mapping 검토" }));

    expect(onOpenMappingReview).toHaveBeenCalledWith("sample_project");
  });

  it("calls onOpenStoryPrompt with the project ID when the Story 프롬프트 확인 button is clicked", async () => {
    const project = makeProject({ id: "sample_project" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    const onOpenStoryPrompt = vi.fn();
    render(<ProjectDetail projectId={project.id} onBack={() => {}} onOpenMappingReview={() => {}} onOpenStoryPrompt={onOpenStoryPrompt} />);

    await screen.findByText("sample_project");
    fireEvent.click(screen.getByRole("button", { name: "Story 프롬프트 확인" }));

    expect(onOpenStoryPrompt).toHaveBeenCalledWith("sample_project");
  });
});
