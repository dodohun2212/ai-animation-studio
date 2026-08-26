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

const PROJECT_URL = "/projects/sample_project";
const APPROVAL_URL = "/projects/sample_project/story/approval";
const REGENERATE_URL = "/projects/sample_project/story/regenerate";

/**
 * Routes by URL instead of call order. The screen issues two independent requests on entry — the prompt
 * preview and `GET /projects/:id` (which decides whether this project already has a script) — and their
 * completion order is not fixed. An order-keyed `mockResolvedValueOnce` queue hands one caller the other's
 * response, which surfaces as a malformed-response error rather than as the thing under test.
 *
 * The project defaults to Ready with no scenes: the first-run state every test below is written for.
 */
function stubByRoute(options: {
  approval?: { status: number; body: unknown } | Promise<Response>;
  project?: { status: number; body: unknown };
  regenerate?: { status: number; body: unknown };
} = {}): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === REGENERATE_URL) {
      if (!options.regenerate) throw new Error("Unexpected regenerate fetch");
      return Promise.resolve(jsonResponse(options.regenerate.status, options.regenerate.body));
    }
    if (url === APPROVAL_URL) {
      if (!options.approval) throw new Error("Unexpected approval fetch");
      return options.approval instanceof Promise
        ? options.approval
        : Promise.resolve(jsonResponse(options.approval.status, options.approval.body));
    }
    if (url === PROJECT_URL) {
      const project = options.project ?? { status: 200, body: { project: makeProject() } };
      return Promise.resolve(jsonResponse(project.status, project.body));
    }
    return Promise.resolve(jsonResponse(200, { preview: PREVIEW }));
  });
}

function approvalCalls(fetchMock: ReturnType<typeof vi.fn>): unknown[][] {
  return fetchMock.mock.calls.filter(([url]) => String(url) === APPROVAL_URL);
}

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

    const previewCall = fetchMock.mock.calls.find(([url]) => String(url) === "/projects/sample_project/story/preview");
    expect(previewCall).toBeTruthy();
    expect((previewCall![1] as RequestInit).method).toBe("POST");
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
    expect(approvalCalls(fetchMock)).toHaveLength(0);
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
    // The first click never sent an approval request — it only opened the panel.
    expect(approvalCalls(fetchMock)).toHaveLength(0);
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
    expect(approvalCalls(fetchMock)).toHaveLength(0);
    expect(textarea()).not.toBeDisabled();
  });

  it("submits an explicit approved:true POST only after the second, final confirmation click", async () => {
    const fetchMock = stubByRoute({ approval: { status: 200, body: APPROVAL_RESPONSE } });
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.change(textarea(), { target: { value: "수정된 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");
    expect(approvalCalls(fetchMock)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "네, 승인을 전송합니다" }));

    await screen.findByTestId("approved-message");
    expect(approvalCalls(fetchMock)).toHaveLength(1);
    const init = approvalCalls(fetchMock)[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      originalPromptSha256: PREVIEW.originalPromptSha256,
      prompt: "수정된 프롬프트",
      approved: true,
    });
  });

  it("shows the generated six scene numbers after final approval produces WAITING_FOR_ASSET_MAPPING_REVIEW", async () => {
    const fetchMock = stubByRoute({ approval: { status: 200, body: GENERATED_APPROVAL_RESPONSE } });
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
    const fetchMock = stubByRoute({ approval: { status: 200, body: fourSceneResponse } });
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
    const fetchMock = stubByRoute({ approval: { status: 200, body: APPROVAL_RESPONSE } });
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
    const fetchMock = stubByRoute({ approval: { status: 409, body: { code: "STORY_PROMPT_STALE", message: "raw backend detail" } } });
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
    const fetchMock = stubByRoute({
      approval: new Promise<Response>((resolve) => {
        resolveApproval = resolve;
      }),
    });
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.change(textarea(), { target: { value: "수정된 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");

    const confirmButton = screen.getByRole("button", { name: "네, 승인을 전송합니다" });
    fireEvent.click(confirmButton);
    expect(confirmButton).toBeDisabled();
    fireEvent.click(confirmButton);

    expect(approvalCalls(fetchMock)).toHaveLength(1); // the second click was swallowed, not queued
    resolveApproval(jsonResponse(200, APPROVAL_RESPONSE));
    await waitFor(() => expect(screen.queryByTestId("approve-confirm-panel")).toBeNull());
  });

  it("shows each scene's actual text and a way forward, not just the scene numbers", async () => {
    const fetchMock = stubByRoute({ approval: { status: 200, body: GENERATED_APPROVAL_RESPONSE } });
    const onOpenMappingReview = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<StoryPromptScreen projectId="sample_project" onBack={() => {}} onOpenMappingReview={onOpenMappingReview} />);

    await screen.findByDisplayValue(PREVIEW.originalPrompt);
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");
    fireEvent.click(screen.getByRole("button", { name: "네, 승인을 전송합니다" }));

    // The script itself — the one thing a person wants to see here — used to be dropped on the floor.
    const panel = await screen.findByTestId("generated-scenes");
    expect(panel.textContent).toContain("Scene 1");
    expect(panel.textContent).toContain("Scene 6");

    fireEvent.click(screen.getByTestId("continue-to-mapping-review"));
    expect(onOpenMappingReview).toHaveBeenCalledWith("sample_project");
  });

  it("replaces the prompt form with the existing script when this project's story already ran", async () => {
    // The backend refuses a second story run (workflow_state must be Ready), and nothing ever resets it —
    // so offering the prompt box again could only ever produce an error.
    const fetchMock = stubByRoute({
      project: { status: 200, body: { project: makeProject({ workflowState: WorkflowState.WaitingForAssetMappingReview, scenes: sixScenes() }) } },
    });
    const onOpenMappingReview = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<StoryPromptScreen projectId="sample_project" onBack={() => {}} onOpenMappingReview={onOpenMappingReview} />);

    const panel = await screen.findByTestId("story-already-generated");
    expect(panel.textContent).toContain("대본이 이미 만들어졌습니다");
    expect(panel.textContent).toContain("Scene 1");
    // No dead end and no dead button.
    expect(screen.queryByRole("button", { name: "이 프롬프트로 승인" })).toBeNull();
    fireEvent.click(screen.getByTestId("existing-continue-to-mapping-review"));
    expect(onOpenMappingReview).toHaveBeenCalledWith("sample_project");
  });

  it("renders a scene that is missing its script instead of crashing the whole screen", async () => {
    // `project.mapper.ts` casts stored scenes to `Scene[]` unchecked and `isProject` never validates an
    // element, so a scene with no `script` really does reach this component. It used to throw during render,
    // which unmounts the app and leaves a blank page — the worst possible failure for a missing string.
    const brokenScenes = [{ number: 1 }, { number: 2, script: "있는 문장" }] as unknown as Scene[];
    const fetchMock = stubByRoute({
      project: { status: 200, body: { project: makeProject({ workflowState: WorkflowState.WaitingForAssetMappingReview, scenes: brokenScenes }) } },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<StoryPromptScreen projectId="sample_project" onBack={() => {}} />);

    const panel = await screen.findByTestId("story-already-generated");
    expect(panel.textContent).toContain("이 장면에는 대본 문장이 비어 있습니다.");
    expect(panel.textContent).toContain("있는 문장");
  });

  it("offers a rewrite while no scene image exists, and only after an explicit confirmation", async () => {
    const withStory = makeProject({ workflowState: WorkflowState.WaitingForAssetMappingReview, scenes: sixScenes() });
    const cleared = makeProject({ workflowState: WorkflowState.Ready, scenes: [] });
    const fetchMock = stubByRoute({
      project: { status: 200, body: { project: withStory } },
      regenerate: { status: 200, body: { project: cleared } },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<StoryPromptScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByTestId("story-already-generated");
    // One click is not enough — this destroys the whole Story.
    fireEvent.click(screen.getByTestId("open-regenerate-confirm"));
    const panel = await screen.findByTestId("regenerate-confirm-panel");
    expect(panel.textContent).toContain("모두 지워집니다");
    expect(fetchMock.mock.calls.some(([url]) => String(url) === REGENERATE_URL)).toBe(false);

    fireEvent.click(screen.getByTestId("confirm-regenerate"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === REGENERATE_URL)).toBe(true));
    const init = fetchMock.mock.calls.find(([url]) => String(url) === REGENERATE_URL)![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ approved: true });
  });

  it("does not offer a rewrite once a scene image exists, and says why", async () => {
    // A paid image describes the current Story. Replacing the Story would orphan it, so the door is closed.
    const withImage = makeProject({
      workflowState: WorkflowState.ImagesReview,
      scenes: sixScenes().map((scene, index) => (index === 0 ? { ...scene, generatedImagePath: "images/scene1.png" } : scene)),
    });
    const fetchMock = stubByRoute({ project: { status: 200, body: { project: withImage } } });
    vi.stubGlobal("fetch", fetchMock);
    render(<StoryPromptScreen projectId="sample_project" onBack={() => {}} />);

    const panel = await screen.findByTestId("story-already-generated");
    expect(panel.textContent).toContain("장면 이미지를 이미 만들어서");
    expect(screen.queryByTestId("open-regenerate-confirm")).toBeNull();
  });

  it("keeps the screen usable and explains it when the server refuses the rewrite", async () => {
    const withStory = makeProject({ workflowState: WorkflowState.WaitingForAssetMappingReview, scenes: sixScenes() });
    const fetchMock = stubByRoute({
      project: { status: 200, body: { project: withStory } },
      regenerate: { status: 409, body: { code: "STORY_REGENERATION_NOT_ALLOWED", message: "internal detail" } },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<StoryPromptScreen projectId="sample_project" onBack={() => {}} />);

    await screen.findByTestId("story-already-generated");
    fireEvent.click(screen.getByTestId("open-regenerate-confirm"));
    fireEvent.click(await screen.findByTestId("confirm-regenerate"));

    const failure = await screen.findByTestId("regenerate-error");
    expect(failure).toHaveAttribute("data-error-code", "STORY_REGENERATION_NOT_ALLOWED");
    expect(failure.textContent).not.toContain("internal detail");
    expect(failure.textContent).toContain("장면 편집");
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
    // Opening the panel still sent no approval request.
    expect(approvalCalls(fetchMock)).toHaveLength(0);
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
