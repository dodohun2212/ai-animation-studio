import type { GetVideoPromptPreviewResponse, StartVideoGenerationResponse, VideoPromptPreview } from "@ai-animation-studio/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { VideoPromptPreviewScreen } from "./VideoPromptPreviewScreen.js";

function makePreviews(count = 6): VideoPromptPreview[] {
  return Array.from({ length: count }, (_, index) => index + 1).map((sceneNumber) => ({
    sceneNumber: sceneNumber as VideoPromptPreview["sceneNumber"],
    prompt: `Scene ${sceneNumber} prompt`,
    model: "gen4_turbo",
    ratio: "720:1280",
    durationSeconds: 5,
    estimatedCostUsd: 0.25,
  }));
}

function makePreviewResponse(confirmationId = "confirmation_1"): GetVideoPromptPreviewResponse {
  return { previews: makePreviews(), confirmationId };
}

function renderScreen(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return render(<VideoPromptPreviewScreen projectId="sample_project" onBack={() => {}} />);
}

describe("VideoPromptPreviewScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the remaining monthly budget and maximum provider calls alongside the cost", async () => {
    const response: GetVideoPromptPreviewResponse = {
      ...makePreviewResponse(),
      maximumProviderCalls: 6,
      budget: { monthlyLimitUsd: 10, spentUsd: 4.25, remainingUsd: 5.75, estimatedRequestCostUsd: 1.5, canSpend: true },
    };
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await screen.findByTestId("preview-list");
    expect(screen.getByTestId("max-provider-calls").textContent).toContain("6회");
    const summary = screen.getByTestId("budget-summary").textContent ?? "";
    expect(summary).toContain("$5.75");
    expect(summary).toContain("$10.00");
    expect(summary).toContain("$4.25");
    expect(screen.queryByTestId("budget-exceeded-warning")).toBeNull();
  });

  it("warns when the request's estimated cost exceeds the remaining budget, and repeats the preflight in the confirmation panel", async () => {
    const response: GetVideoPromptPreviewResponse = {
      ...makePreviewResponse(),
      maximumProviderCalls: 6,
      // 6 scenes x $0.25 = $1.50 estimated, against only $0.40 left.
      budget: { monthlyLimitUsd: 10, spentUsd: 9.6, remainingUsd: 0.4, estimatedRequestCostUsd: 1.5, canSpend: false },
    };
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await screen.findByTestId("preview-list");
    expect(screen.getByTestId("budget-exceeded-warning")).toBeTruthy();

    fireEvent.click(screen.getByTestId("open-confirm-button"));
    const preflight = (await screen.findByTestId("confirm-preflight")).textContent ?? "";
    expect(preflight).toContain("gen4_turbo");
    expect(preflight).toContain("720:1280");
    expect(preflight).toContain("6회");
    expect(preflight).toContain("$1.50");
    expect(preflight).toContain("$0.40");
    expect(screen.getByTestId("confirm-budget-warning")).toBeTruthy();
  });

  it("still renders normally when the response carries no budget information", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, makePreviewResponse())));

    await screen.findByTestId("preview-list");
    expect(screen.getByTestId("total-cost").textContent).toContain("$1.50");
    expect(screen.queryByTestId("budget-summary")).toBeNull();
    expect(screen.queryByTestId("max-provider-calls")).toBeNull();
    expect(screen.queryByTestId("budget-exceeded-warning")).toBeNull();
  });

  it("rejects a malformed budget rather than displaying a wrong number", async () => {
    const response = {
      ...makePreviewResponse(),
      budget: { monthlyLimitUsd: 10, spentUsd: "네", remainingUsd: 5, estimatedRequestCostUsd: 1.5, canSpend: true },
    };
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, response)));

    const alert = await screen.findByTestId("preview-error");
    expect(alert).toHaveAttribute("data-error-code", "CLIENT_MALFORMED_RESPONSE");
    expect(screen.queryByTestId("budget-summary")).toBeNull();
  });

  it("shows a loading state, then loads via an explicit POST /projects/:id/videos/preview", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    renderScreen(fetchMock);

    expect(screen.getByText("미리보기를 불러오는 중...")).toBeTruthy();
    await screen.findByTestId("preview-list");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/videos/preview");
    expect(init.method).toBe("POST");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("displays all six scene prompts, model/ratio/duration, and per-scene plus total estimated cost", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await screen.findByTestId("preview-list");
    for (const sceneNumber of [1, 2, 3, 4, 5, 6]) {
      expect(screen.getByTestId(`preview-${sceneNumber}`)).toBeTruthy();
      expect(screen.getByDisplayValue(`Scene ${sceneNumber} prompt`)).toBeTruthy();
      expect(screen.getByTestId(`cost-${sceneNumber}`).textContent).toBe("예상 비용: $0.25");
    }
    // The provider's value stays visible, but the shape the user chose in settings leads — "720:1280" alone
    // gives them no way to notice an orientation that does not match the project.
    expect(screen.getByTestId("preview-summary").textContent).toBe("모델: gen4_turbo · 비율: 세로형 9:16 (720:1280) · 장면당 길이: 5초");
    expect(screen.getByTestId("total-cost").textContent).toBe("총 예상 비용: $1.50");
  });

  it("allows local-only per-scene editing without sending any additional request", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    renderScreen(fetchMock);

    await screen.findByTestId("preview-list");
    const textarea = screen.getByLabelText("Runway 프롬프트", { selector: "#prompt-1" }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "수정된 1번 장면 프롬프트" } });

    expect(textarea.value).toBe("수정된 1번 장면 프롬프트");
    // Only the initial preview fetch happened — editing never calls the network.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Editing one scene leaves the others untouched.
    expect(screen.getByDisplayValue("Scene 2 prompt")).toBeTruthy();
  });

  it("counts UTF-16 code units so a single emoji adds two to the counter", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await screen.findByTestId("preview-list");
    const textarea = screen.getByLabelText("Runway 프롬프트", { selector: "#prompt-1" }) as HTMLTextAreaElement;
    const baseline = "Scene 1 prompt".length;
    expect(screen.getByTestId("prompt-length-1").textContent).toBe(`${baseline} / 1000`);

    fireEvent.change(textarea, { target: { value: "Scene 1 prompt😀" } });

    // "😀" is a surrogate pair — two UTF-16 code units for one visible emoji.
    expect(screen.getByTestId("prompt-length-1").textContent).toBe(`${baseline + 2} / 1000`);
    expect(screen.queryByTestId("prompt-limit-error-1")).toBeNull();
  });

  it("flags a scene prompt that exceeds the 1000 UTF-16 code-unit limit", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await screen.findByTestId("preview-list");
    const textarea = screen.getByLabelText("Runway 프롬프트", { selector: "#prompt-1" }) as HTMLTextAreaElement;
    const overLong = "a".repeat(1001);
    fireEvent.change(textarea, { target: { value: overLong } });

    expect(screen.getByTestId("prompt-length-1").textContent).toBe("1001 / 1000");
    const alert = screen.getByTestId("prompt-limit-error-1");
    expect(alert).toBeTruthy();
    expect(alert.textContent).toBe("프롬프트가 최대 글자 수(1000자)를 초과했습니다.");
  });

  it("does not flag a scene prompt exactly at the 1000 UTF-16 code-unit limit", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await screen.findByTestId("preview-list");
    const textarea = screen.getByLabelText("Runway 프롬프트", { selector: "#prompt-1" }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "a".repeat(1000) } });

    expect(screen.getByTestId("prompt-length-1").textContent).toBe("1000 / 1000");
    expect(screen.queryByTestId("prompt-limit-error-1")).toBeNull();
  });

  it("shows a safe error with a retry action instead of the raw backend message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(409, { code: "VIDEO_PREVIEW_NOT_ALLOWED", message: "raw backend detail" }));
    renderScreen(fetchMock);

    const alert = await screen.findByTestId("preview-error");
    expect(alert.textContent).toBe("영상 미리보기는 모든 장면 이미지가 승인된 프로젝트에서만 가능합니다.");
    expect(alert).toHaveAttribute("data-error-code", "VIDEO_PREVIEW_NOT_ALLOWED");
    expect(alert.textContent).not.toContain("raw backend detail");

    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, response));
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await screen.findByTestId("preview-list");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps a network failure while loading to a safe network error", async () => {
    renderScreen(vi.fn().mockRejectedValue(new Error("network down")));

    const alert = await screen.findByTestId("preview-error");
    expect(alert).toHaveAttribute("data-error-code", "CLIENT_NETWORK_ERROR");
  });

  it("never issues a video-generation, provider, or FFmpeg request while previewing or editing", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    renderScreen(fetchMock);

    await screen.findByTestId("preview-list");
    const textarea = screen.getByLabelText("Runway 프롬프트", { selector: "#prompt-1" }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "수정된 프롬프트" } });

    const calledUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(calledUrls).toEqual(["/projects/sample_project/videos/preview"]);
    expect(calledUrls.some((url) => url.includes("/videos/generations"))).toBe(false);
  });

  describe("two-step explicit submission confirmation", () => {
    it("opens a confirmation panel without sending any request — only the final confirm button submits", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, makePreviewResponse()));
      renderScreen(fetchMock);
      await screen.findByTestId("preview-list");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("open-confirm-button"));
      expect(screen.getByTestId("submit-confirm-panel")).toBeTruthy();
      expect(screen.getByTestId("submit-confirm-panel").textContent).toContain("실제 유료 요청으로 전송됩니다");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("shows the actual prompt count (not a fixed six) for a four-scene project", async () => {
      const response: GetVideoPromptPreviewResponse = { previews: makePreviews(4), confirmationId: "confirmation_1" };
      const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, response));
      renderScreen(fetchMock);
      await screen.findByTestId("preview-list");

      fireEvent.click(screen.getByTestId("open-confirm-button"));
      expect(screen.getByTestId("submit-confirm-panel").textContent).toContain("위 4개 프롬프트가 실제 유료 요청으로 전송됩니다");
    });

    it("cancelling the confirmation panel closes it and never submits", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, makePreviewResponse()));
      renderScreen(fetchMock);
      await screen.findByTestId("preview-list");

      fireEvent.click(screen.getByTestId("open-confirm-button"));
      fireEvent.click(screen.getByTestId("cancel-submit-button"));

      expect(screen.queryByTestId("submit-confirm-panel")).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("sends the exact submission contract with the current edited prompts only on final confirmation", async () => {
      const submissionResponse: StartVideoGenerationResponse = { jobId: "job_1", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6] };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, makePreviewResponse("confirmation_1")))
        .mockResolvedValueOnce(jsonResponse(200, submissionResponse));
      renderScreen(fetchMock);
      await screen.findByTestId("preview-list");

      const textarea = screen.getByLabelText("Runway 프롬프트", { selector: "#prompt-1" }) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "수정된 1번 장면 프롬프트" } });

      fireEvent.click(screen.getByTestId("open-confirm-button"));
      fireEvent.click(screen.getByTestId("confirm-submit-button"));
      await screen.findByTestId("submit-success");

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(url).toBe("/projects/sample_project/videos/generations");
      expect(init.method).toBe("POST");

      const body = JSON.parse(String(init.body));
      expect(Object.keys(body).sort()).toEqual(["approved", "confirmationId", "prompts", "userRequestId"]);
      expect(body.approved).toBe(true);
      expect(body.confirmationId).toBe("confirmation_1");
      expect(typeof body.userRequestId).toBe("string");
      expect(body.userRequestId.length).toBeGreaterThan(0);
      expect(body.prompts).toEqual([
        { sceneNumber: 1, prompt: "수정된 1번 장면 프롬프트" },
        { sceneNumber: 2, prompt: "Scene 2 prompt" },
        { sceneNumber: 3, prompt: "Scene 3 prompt" },
        { sceneNumber: 4, prompt: "Scene 4 prompt" },
        { sceneNumber: 5, prompt: "Scene 5 prompt" },
        { sceneNumber: 6, prompt: "Scene 6 prompt" },
      ]);
    });

    it("prevents duplicate submissions from rapid repeated clicks on the confirm button", async () => {
      const submissionResponse: StartVideoGenerationResponse = { jobId: "job_1", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6] };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, makePreviewResponse()))
        .mockResolvedValueOnce(jsonResponse(200, submissionResponse));
      renderScreen(fetchMock);
      await screen.findByTestId("preview-list");

      fireEvent.click(screen.getByTestId("open-confirm-button"));
      const confirmButton = screen.getByTestId("confirm-submit-button");
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);

      await screen.findByTestId("submit-success");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("shows a local fake job status on success — framed as local-only, with no provider or video file claim", async () => {
      const submissionResponse: StartVideoGenerationResponse = { jobId: "job_42", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6] };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, makePreviewResponse()))
        .mockResolvedValueOnce(jsonResponse(200, submissionResponse));
      renderScreen(fetchMock);
      await screen.findByTestId("preview-list");

      fireEvent.click(screen.getByTestId("open-confirm-button"));
      fireEvent.click(screen.getByTestId("confirm-submit-button"));

      const success = await screen.findByTestId("submit-success");
      expect(success.textContent).toContain("영상 생성 작업이 접수되었습니다");
      expect(screen.getByTestId("job-id").textContent).toBe("작업 ID: job_42");
      expect(screen.getByTestId("accepted-scenes").textContent).toBe("접수된 장면: 1, 2, 3, 4, 5, 6");
      expect(screen.queryByTestId("open-confirm-button")).toBeNull();
      expect(screen.queryByTestId("submit-confirm-panel")).toBeNull();
    });

    it.each([
      ["VIDEO_CONFIRMATION_STALE", "미리보기 내용이 그 사이에 변경되었습니다. 새로고침 후 다시 확인해 주세요."],
      ["VIDEO_BUDGET_EXCEEDED", "설정된 예산을 초과하여 전송할 수 없습니다."],
      ["VIDEO_CALL_LIMIT_EXCEEDED", "허용된 Provider 호출 횟수를 초과했습니다."],
      ["VIDEO_REQUEST_ID_CONFLICT", "이전 요청과 내용이 달라 처리할 수 없습니다. 새로고침 후 다시 시도해 주세요."],
      ["VIDEO_SUBMISSION_NOT_ALLOWED", "영상 생성 요청은 모든 장면 이미지 승인과 영상 확인 대기 상태에서만 보낼 수 있습니다."],
    ])("shows a safe fixed error message for %s instead of the raw backend detail", async (code, expectedMessage) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, makePreviewResponse()))
        .mockResolvedValueOnce(jsonResponse(409, { code, message: "raw backend detail" }));
      renderScreen(fetchMock);
      await screen.findByTestId("preview-list");

      fireEvent.click(screen.getByTestId("open-confirm-button"));
      fireEvent.click(screen.getByTestId("confirm-submit-button"));

      const alert = await screen.findByTestId("submit-error");
      expect(alert.textContent).toBe(expectedMessage);
      expect(alert).toHaveAttribute("data-error-code", code);
      expect(alert.textContent).not.toContain("raw backend detail");
      expect(screen.queryByTestId("submit-success")).toBeNull();
    });

    it("offers a refresh action for a stale confirmation and reloads the preview to clear the error", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, makePreviewResponse("confirmation_1")))
        .mockResolvedValueOnce(jsonResponse(409, { code: "VIDEO_CONFIRMATION_STALE", message: "raw" }))
        .mockResolvedValueOnce(jsonResponse(200, makePreviewResponse("confirmation_2")));
      renderScreen(fetchMock);
      await screen.findByTestId("preview-list");

      fireEvent.click(screen.getByTestId("open-confirm-button"));
      fireEvent.click(screen.getByTestId("confirm-submit-button"));
      await screen.findByTestId("submit-error");

      fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
      await screen.findByTestId("preview-list");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(screen.queryByTestId("submit-error")).toBeNull();
    });

    it("maps a network failure during submission to a safe network error without submitting twice", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, makePreviewResponse()))
        .mockRejectedValueOnce(new Error("network down"));
      renderScreen(fetchMock);
      await screen.findByTestId("preview-list");

      fireEvent.click(screen.getByTestId("open-confirm-button"));
      fireEvent.click(screen.getByTestId("confirm-submit-button"));

      const alert = await screen.findByTestId("submit-error");
      expect(alert).toHaveAttribute("data-error-code", "CLIENT_NETWORK_ERROR");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("disables the confirm-open button while any prompt is empty or exceeds the length limit", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, makePreviewResponse()));
      renderScreen(fetchMock);
      await screen.findByTestId("preview-list");

      const textarea = screen.getByLabelText("Runway 프롬프트", { selector: "#prompt-1" }) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "" } });

      expect(screen.getByTestId("open-confirm-button")).toBeDisabled();
      fireEvent.click(screen.getByTestId("open-confirm-button"));
      expect(screen.queryByTestId("submit-confirm-panel")).toBeNull();
    });
  });
});
