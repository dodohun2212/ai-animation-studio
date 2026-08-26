import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { StoryPromptScreen } from "./StoryPromptScreen.js";

const PREVIEW = {
  projectId: "sample_project",
  originalPrompt: "우주를 여행하는 고양이 이야기",
  originalPromptSha256: "a".repeat(64),
  characterCount: 14,
  sceneCount: 6 as const,
};

const APPROVAL_RESPONSE = {
  project: makeProject(),
  originalPrompt: PREVIEW.originalPrompt,
  prompt: "수정된 프롬프트",
  promptSha256: "b".repeat(64),
  modified: true,
  approvedAt: "2026-08-22T00:00:00.000Z",
};

function sixScenes(): Scene[] {
  return scenesOf(6);
}

function scenesOf(count: number): Scene[] {
  return Array.from({ length: count }, (_, index) => {
    const number = (index + 1) as Scene["number"];
    return {
      number,
      script: `Scene ${number}`,
      imagePrompt: `Image ${number}`,
      motionPrompt: `Motion ${number}`,
      imageReview: "pending",
      videoReview: "pending",
    };
  });
}

const GENERATED_APPROVAL_RESPONSE = {
  ...APPROVAL_RESPONSE,
  project: makeProject({
    workflowState: WorkflowState.WaitingForAssetMappingReview,
    scenes: sixScenes(),
  }),
};

function renderScreen(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return render(<StoryPromptScreen projectId="sample_project" onBack={() => {}} />);
}

function textarea(): HTMLTextAreaElement {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

describe("StoryPromptScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state, then loads the preview via POST /projects/:projectId/story/preview", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { preview: PREVIEW }));
    renderScreen(fetchMock);

    expect(screen.getByText("미리보기를 불러오는 중...")).toBeTruthy();
    await screen.findByDisplayValue(PREVIEW.originalPrompt);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/story/preview");
    expect(init.method).toBe("POST");
  });

  it("shows a safe error instead of the raw backend message when the preview request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { code: "PROJECT_NOT_FOUND", message: "raw backend detail" }));
    renderScreen(fetchMock);

    const alert = await screen.findByTestId("preview-error");
    expect(alert.textContent).toBe("프로젝트를 찾을 수 없습니다.");
    expect(alert).toHaveAttribute("data-error-code", "PROJECT_NOT_FOUND");
  });

  it("lets the user edit the textarea and restore the original prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { preview: PREVIEW }));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.change(textarea(), { target: { value: "수정된 프롬프트" } });
    expect(textarea().value).toBe("수정된 프롬프트");

    fireEvent.click(screen.getByRole("button", { name: "원본으로 복원" }));
    expect(textarea().value).toBe(PREVIEW.originalPrompt);
  });

  it("blocks approval of an empty prompt without calling the approval endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { preview: PREVIEW }));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.change(textarea(), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));

    const alert = await screen.findByTestId("validation-error");
    expect(alert.textContent).toBe("대본 지시문를 입력해야 합니다.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not call the approval endpoint on the first click — it only opens an explicit confirmation panel", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { preview: PREVIEW }));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.change(textarea(), { target: { value: "수정된 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));

    const panel = await screen.findByTestId("approve-confirm-panel");
    expect(panel).toBeTruthy();
    expect(screen.getByRole("button", { name: "네, 승인을 전송합니다" })).toBeTruthy();
    // Only the preview POST has happened — the first click never sent an approval request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns to editing without sending anything when the confirmation panel is cancelled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { preview: PREVIEW }));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.change(textarea(), { target: { value: "수정된 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");

    fireEvent.click(screen.getByRole("button", { name: "돌아가기" }));

    expect(screen.queryByTestId("approve-confirm-panel")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(textarea()).not.toBeDisabled();
  });

  it("submits an explicit approved:true POST only after the second, final confirmation click", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { preview: PREVIEW }))
      .mockResolvedValueOnce(jsonResponse(200, APPROVAL_RESPONSE));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.change(textarea(), { target: { value: "수정된 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "네, 승인을 전송합니다" }));

    await screen.findByTestId("approved-message");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/story/approval");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      originalPromptSha256: PREVIEW.originalPromptSha256,
      prompt: "수정된 프롬프트",
      approved: true,
    });
  });

  it("shows the generated six scene numbers after final approval produces WAITING_FOR_ASSET_MAPPING_REVIEW", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { preview: PREVIEW }))
      .mockResolvedValueOnce(jsonResponse(200, GENERATED_APPROVAL_RESPONSE));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.change(textarea(), { target: { value: "수정된 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");
    fireEvent.click(screen.getByRole("button", { name: "네, 승인을 전송합니다" }));

    await screen.findByTestId("approved-message");
    const scenesPanel = await screen.findByTestId("generated-scenes");
    expect(scenesPanel).toBeTruthy();
    for (const number of [1, 2, 3, 4, 5, 6]) {
      expect(screen.getByTestId(`generated-scene-${number}`)).toBeTruthy();
    }
  });

  it("shows the actual generated scene count (not a fixed six) for a four-scene project", async () => {
    const fourSceneResponse = {
      ...APPROVAL_RESPONSE,
      project: makeProject({ workflowState: WorkflowState.WaitingForAssetMappingReview, scenes: scenesOf(4) }),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { preview: PREVIEW }))
      .mockResolvedValueOnce(jsonResponse(200, fourSceneResponse));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.change(textarea(), { target: { value: "수정된 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");
    fireEvent.click(screen.getByRole("button", { name: "네, 승인을 전송합니다" }));

    await screen.findByTestId("approved-message");
    const scenesPanel = await screen.findByTestId("generated-scenes");
    expect(scenesPanel.textContent).toContain("대본에서 4개 장면이 생성되었습니다.");
    for (const number of [1, 2, 3, 4]) {
      expect(screen.getByTestId(`generated-scene-${number}`)).toBeTruthy();
    }
    expect(screen.queryByTestId("generated-scene-5")).toBeNull();
  });

  it("does not show a generated-scenes panel when the approval response has no six-scene workflow state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { preview: PREVIEW }))
      .mockResolvedValueOnce(jsonResponse(200, APPROVAL_RESPONSE));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.change(textarea(), { target: { value: "수정된 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");
    fireEvent.click(screen.getByRole("button", { name: "네, 승인을 전송합니다" }));

    await screen.findByTestId("approved-message");
    expect(screen.queryByTestId("generated-scenes")).toBeNull();
  });

  it("shows a stale-hash error with a refresh action and never leaks the raw backend message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { preview: PREVIEW }))
      .mockResolvedValueOnce(jsonResponse(409, { code: "STORY_PROMPT_STALE", message: "raw backend detail" }));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.change(textarea(), { target: { value: "수정된 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");
    fireEvent.click(screen.getByRole("button", { name: "네, 승인을 전송합니다" }));

    const alert = await screen.findByTestId("approve-error");
    expect(alert).toHaveAttribute("data-error-code", "STORY_PROMPT_STALE");
    expect(alert.textContent).not.toContain("raw backend detail");
    expect(screen.getByRole("button", { name: "처음 내용으로 되돌리기" })).toBeTruthy();
  });

  it("prevents a duplicate approval POST while one is already in flight", async () => {
    let resolveApproval: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { preview: PREVIEW }))
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveApproval = resolve;
        }),
      );
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.change(textarea(), { target: { value: "수정된 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");

    const confirmButton = screen.getByRole("button", { name: "네, 승인을 전송합니다" });
    fireEvent.click(confirmButton);
    expect(confirmButton).toBeDisabled();
    fireEvent.click(confirmButton);

    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 preview POST + exactly one approval POST
    resolveApproval(jsonResponse(200, APPROVAL_RESPONSE));
    await waitFor(() => expect(screen.queryByTestId("approve-confirm-panel")).toBeNull());
  });

  it("shows what the story call costs before it is approved", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { preview: PREVIEW }));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));

    const estimate = await screen.findByTestId("story-cost-estimate");
    expect(estimate.textContent).toContain("$0.05");
    // The story call is per project, not per scene — the copy has to say so.
    expect(estimate.textContent).toContain("프로젝트당 1회");
    // Opening the panel still sent nothing beyond the initial preview.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the remaining monthly budget alongside the estimate when a credential is connected", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        preview: PREVIEW,
        budget: { monthlyLimitUsd: 10, spentUsd: 3.2, remainingUsd: 6.8, estimatedRequestCostUsd: 0.05, canSpend: true },
      }),
    );
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));

    const budget = await screen.findByTestId("story-budget");
    expect(budget.textContent).toContain("$6.80");
    expect(budget.textContent).toContain("$3.20");
  });

  it("omits the budget line in the local fake mode, where nothing is charged", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { preview: PREVIEW }));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));

    // The estimate still shows — it is computable without a ledger — but the ledger line does not.
    await screen.findByTestId("story-cost-estimate");
    expect(screen.queryByTestId("story-budget")).toBeNull();
  });
});
