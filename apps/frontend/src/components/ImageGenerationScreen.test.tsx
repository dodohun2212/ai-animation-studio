import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { ImageGenerationScreen } from "./ImageGenerationScreen.js";

function sixScenes(withImages: readonly number[] = []): Scene[] {
  return [1, 2, 3, 4, 5, 6].map((number) => ({
    number: number as Scene["number"],
    script: `Scene ${number}`,
    imagePrompt: `Image ${number}`,
    motionPrompt: `Motion ${number}`,
    imageReview: "pending",
    videoReview: "pending",
    ...(withImages.includes(number) ? { generatedImagePath: `images/scene${number}.png` } : {}),
  }));
}

function renderScreen(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return render(<ImageGenerationScreen projectId="sample_project" onBack={() => {}} />);
}

describe("ImageGenerationScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state, then loads the project via GET /projects/:projectId", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project }));
    renderScreen(fetchMock);

    expect(screen.getByText("불러오는 중...")).toBeTruthy();
    await screen.findByTestId("no-paid-notice");

    expect(fetchMock).toHaveBeenCalledWith("/projects/sample_project");
  });

  it("shows the project-load error with its code identifiable via data-error-code", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { code: "PROJECT_NOT_FOUND", message: "프로젝트를 찾을 수 없습니다." }));
    renderScreen(fetchMock);

    const alert = await screen.findByTestId("load-error");
    expect(alert.textContent).toBe("프로젝트를 찾을 수 없습니다.");
    expect(alert).toHaveAttribute("data-error-code", "PROJECT_NOT_FOUND");
  });

  it("shows the explicit no-paid local fake generation notice and all six scenes as pending before generation", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { project })));

    const notice = await screen.findByTestId("no-paid-notice");
    expect(notice.textContent).toContain("실제 유료 OpenAI 이미지 API를 호출하지 않습니다");

    for (const number of [1, 2, 3, 4, 5, 6]) {
      const item = screen.getByTestId(`scene-${number}`);
      expect(item).toHaveAttribute("data-status", "pending");
    }
  });

  it("reflects previously completed scenes as completed before a fresh generation call", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes([1, 2]) });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { project })));

    await screen.findByTestId("no-paid-notice");
    expect(screen.getByTestId("scene-1")).toHaveAttribute("data-status", "completed");
    expect(screen.getByTestId("scene-2")).toHaveAttribute("data-status", "completed");
    expect(screen.getByTestId("scene-3")).toHaveAttribute("data-status", "pending");
  });

  it("blocks generation and hides the start button when the project is not Asset-Mapping-approved", async () => {
    const project = makeProject({ workflowState: WorkflowState.Ready, scenes: [] });
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { project })));

    const notAllowed = await screen.findByTestId("not-allowed");
    expect(notAllowed.textContent).toContain(WorkflowState.Ready);
    expect(screen.queryByRole("button", { name: "이미지 생성 시작" })).toBeNull();
  });

  it("does not call the generation endpoint on the first click — it only opens an explicit confirmation panel", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project }));
    renderScreen(fetchMock);

    await screen.findByTestId("no-paid-notice");
    fireEvent.click(screen.getByRole("button", { name: "이미지 생성 시작" }));

    const panel = await screen.findByTestId("generate-confirm-panel");
    expect(panel).toBeTruthy();
    expect(screen.getByRole("button", { name: "예, 로컬 이미지 생성을 시작합니다" })).toBeTruthy();
    // Only the initial GET happened — the first click never sent a generation request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns to the scene list without sending anything when the confirmation panel is cancelled", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project }));
    renderScreen(fetchMock);

    await screen.findByTestId("no-paid-notice");
    fireEvent.click(screen.getByRole("button", { name: "이미지 생성 시작" }));
    await screen.findByTestId("generate-confirm-panel");

    fireEvent.click(screen.getByRole("button", { name: "돌아가기" }));

    expect(screen.queryByTestId("generate-confirm-panel")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("calls POST /projects/:projectId/images/generations with { approved: true } only after the final confirmation click", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    const generatedProject = makeProject({
      workflowState: WorkflowState.ImagesReview,
      scenes: sixScenes([1, 2, 3, 4, 5, 6]),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(
        jsonResponse(200, { project: generatedProject, generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [] }),
      );
    renderScreen(fetchMock);

    await screen.findByTestId("no-paid-notice");
    fireEvent.click(screen.getByRole("button", { name: "이미지 생성 시작" }));
    await screen.findByTestId("generate-confirm-panel");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "예, 로컬 이미지 생성을 시작합니다" }));

    const summary = await screen.findByTestId("generation-summary");
    expect(summary.textContent).toContain("새로 생성 6장");
    expect(summary.textContent).toContain("기존 이미지 재사용 0장");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/images/generations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });

    for (const number of [1, 2, 3, 4, 5, 6]) {
      expect(screen.getByTestId(`scene-${number}`)).toHaveAttribute("data-status", "completed");
    }
    expect(screen.queryByRole("button", { name: "이미지 생성 시작" })).toBeNull();
  });

  it("shows a safe error and keeps the confirmation panel open for retry when generation fails", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "IMAGE_GENERATION_FAILED", message: "raw backend detail" }));
    renderScreen(fetchMock);

    await screen.findByTestId("no-paid-notice");
    fireEvent.click(screen.getByRole("button", { name: "이미지 생성 시작" }));
    await screen.findByTestId("generate-confirm-panel");
    fireEvent.click(screen.getByRole("button", { name: "예, 로컬 이미지 생성을 시작합니다" }));

    const alert = await screen.findByTestId("generate-error");
    expect(alert.textContent).not.toContain("raw backend detail");
    expect(alert).toHaveAttribute("data-error-code", "IMAGE_GENERATION_FAILED");
    expect(screen.getByTestId("generate-confirm-panel")).toBeTruthy();
    expect(screen.queryByTestId("generation-summary")).toBeNull();
  });

  it("prevents a duplicate generation POST while one is already in flight", async () => {
    const project = makeProject({ workflowState: WorkflowState.AssetMappingApproved, scenes: sixScenes() });
    let resolveGeneration: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveGeneration = resolve;
        }),
      );
    renderScreen(fetchMock);

    await screen.findByTestId("no-paid-notice");
    fireEvent.click(screen.getByRole("button", { name: "이미지 생성 시작" }));
    await screen.findByTestId("generate-confirm-panel");

    const confirmButton = screen.getByRole("button", { name: "예, 로컬 이미지 생성을 시작합니다" });
    fireEvent.click(confirmButton);
    expect(confirmButton).toBeDisabled();
    fireEvent.click(confirmButton);

    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 project GET + exactly one generation POST
    resolveGeneration(
      jsonResponse(200, {
        project: makeProject({ workflowState: WorkflowState.ImagesReview, scenes: sixScenes([1, 2, 3, 4, 5, 6]) }),
        generatedSceneNumbers: [1, 2, 3, 4, 5, 6],
        reusedSceneNumbers: [],
      }),
    );
    await waitFor(() => expect(screen.queryByTestId("generate-confirm-panel")).toBeNull());
  });
});
