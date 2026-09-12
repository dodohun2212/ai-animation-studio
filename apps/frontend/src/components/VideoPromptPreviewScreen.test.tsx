import type { GetVideoPromptPreviewResponse, StartVideoGenerationResponse, VideoPromptPreview } from "@ai-animation-studio/shared";
import { RUNWAY_PROMPT_AUTHORING_LIMIT } from "@ai-animation-studio/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { VideoSubmissionApiError, toVideoSubmissionDisplayError } from "../api/videoSubmissionApi.js";
import { VideoPromptPreviewScreen } from "./VideoPromptPreviewScreen.js";

function makePreviews(count = 6): VideoPromptPreview[] {
  return Array.from({ length: count }, (_, index) => index + 1).map((sceneNumber): VideoPromptPreview => ({
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

/** The room an author actually has: the server appends a no-legible-text rule to every prompt on its way out. */
const LIMIT = RUNWAY_PROMPT_AUTHORING_LIMIT;

describe("VideoPromptPreviewScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Regression: the Backend trims sections to fit Runway's prompt limit. It used to do that silently, so a scene
  // could lose its continuity or performance direction with the wrong finished video as the only symptom.
  /**
   * 🔴 돈이 걸린 확인 화면의 일은 「지금 무엇을 사는지」를 남김없이 보여주는 것입니다. 끝 프레임이 들어가면서
   * 유료 요청의 **내용**이 달라졌는데(클립 N 이 그림 N 에서 그림 N+1 로 갑니다), 화면이 그걸 말하지 않으면
   * 사람은 확인 해시에는 들어 있는 값을 모른 채 누릅니다.
   *
   * 없을 때 아무 말도 안 하는 것도 같이 봅니다 — 「없음」은 세 가지(체인 꺼짐 · 못 받는 모델 · 마지막 장면)이고,
   * 그 셋을 구분하는 건 이 화면의 일이 아닙니다. 있지도 않은 걸 설명하려 들면 그 자체가 틀린 말이 됩니다.
   */
  it("names the picture each clip ends on, and says nothing where there is none", async () => {
    const previews = makePreviews(3).map((preview, index) => (
      index < 2 ? { ...preview, lastFrameSceneNumber: (preview.sceneNumber + 1) as VideoPromptPreview["sceneNumber"] } : preview
    ));
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { previews, confirmationId: "c1" })));

    expect((await screen.findByTestId("last-frame-1")).textContent).toContain("2번 장면 그림");
    expect(screen.getByTestId("last-frame-2").textContent).toContain("3번 장면 그림");
    // 마지막 장면은 다음 그림이 없습니다.
    expect(screen.queryByTestId("last-frame-3")).toBeNull();
  });

  it("says nothing about end frames when none of the clips carry one", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { previews: makePreviews(3), confirmationId: "c1" })));

    await screen.findByTestId("preview-list");
    for (const sceneNumber of [1, 2, 3]) {
      expect(screen.queryByTestId(`last-frame-${sceneNumber}`), String(sceneNumber)).toBeNull();
    }
    expect(document.body.textContent).not.toContain("으로 끝납니다");
  });

  /**
   * 🔴 돈이 나가기 직전 화면이 모델에 대해 제일 적게 말하고 있었습니다: `모델: h3_max_768p` 한 마디. 슬러그는
   * 사람이 고른 이름이 아니고, 그 모델이 릴에 무엇을 하는지는 한 글자도 없었습니다 — 고르는 화면은 다 말해
   * 주는데 누르는 화면이 침묵한 것입니다. 이름과 능력이 여기 없으면, 사람은 「내가 고른 그 모델이 맞나」를
   * 확인할 방법 없이 유료 버튼을 누릅니다.
   *
   * 슬러그도 같이 남깁니다 — 우편함·로그·Runway 계정은 그 이름으로 부릅니다.
   */
  it("names the model instead of showing its slug alone, and says what it does to the reel", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, makePreviewResponse())));

    await screen.findByTestId("preview-list");
    expect(screen.getByTestId("preview-model-label").textContent).toBe("Runway Gen-4 Turbo");
    expect(screen.getByTestId("preview-model-id").textContent).toBe("gen4_turbo");
    const facts = screen.getByTestId("preview-model-facts").textContent ?? "";
    // gen4_turbo 는 끝 그림을 못 받습니다 — 이어지는 릴에서 컷이 뒤로 돌아가는 바로 그 조건입니다.
    expect(facts).toContain("앞 클립이 끝난 장면을 이어받지 못합니다");
    expect(facts).toContain("한 장면 최대 10초");
  });

  /**
   * 🔴 유료 모델 중에는 소리까지 만드는 것이 있는데, 이 앱은 그 소리를 **한 번도 쓰지 않습니다**:
   * `ffmpeg-merge.service.ts` 는 클립에서 `0:v:0` 만 가져오고, 소리는 내레이션 파일 아니면 `anullsrc`(무음)로
   * 새로 붙입니다. 화면이 그걸 안 말하면, 소리 되는 모델을 일부러 골라 돈을 더 내고 그 소리를 버리게 됩니다.
   *
   * 모델마다 같은지 같이 봅니다 — 이건 모델의 성질이 아니라 이 앱이 합치는 방식입니다. (카탈로그에 없는 이름은
   * 화면까지 오지 못합니다: 응답 가드가 먼저 거절합니다 — videoPreviewApi.test.ts.)
   */
  it("says the clip's own sound is never used, whichever model the request uses", async () => {
    const first = renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, makePreviewResponse())));
    expect((await screen.findByTestId("preview-model-audio")).textContent).toContain("소리는 내레이션과 배경 음악으로만");
    // Taken down first: with both mounted, the search can return the first screen's line before the second loads.
    first.unmount();

    const other = makePreviews(2).map((preview) => ({ ...preview, model: "h3_max_480p" as VideoPromptPreview["model"] }));
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { previews: other, confirmationId: "c1" })));
    expect((await screen.findByTestId("preview-model-audio")).textContent).toContain("소리는 내레이션과 배경 음악으로만");
  });

  /**
   * 🔴 카탈로그의 요율은 $0.05/s 부터 $0.68/s 까지 13.6 배로 벌어져 있습니다. 이 줄이 모델을 따라 움직이지
   * 않으면(= 어딘가에 박힌 숫자면), 제일 비싼 모델을 고른 사람이 제일 싼 값을 읽고 누릅니다. 두 모델로 한
   * 번씩 그려 보는 것이 그 확인의 유일한 방법입니다.
   */
  it("prices from the model this preview was actually built with", async () => {
    const cheap = renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, makePreviewResponse())));
    expect((await screen.findByTestId("preview-model-price")).textContent).toContain("1초당 $0.05");
    // Taken down first: with both mounted, the search can return the first screen's line before the second loads.
    cheap.unmount();

    const dear = makePreviews(2).map((preview) => ({ ...preview, model: "seedance2_5_1080p" as VideoPromptPreview["model"] }));
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { previews: dear, confirmationId: "c1" })));
    const line = (await screen.findByTestId("preview-model-price")).textContent ?? "";
    expect(line).toContain("1초당 $0.68");
    expect(line).toContain("짧아도 최소 $0.80");
  });

  /**
   * 🔴 이 요청에 들어가는 것은 글과 그림 둘인데, 화면에는 글만 있었습니다. 클립이 어디서 시작해 어디서 끝나는지는
   * 전적으로 그림이 정하고, 그림 둘이 사실상 같으면 5초짜리 정지 화면을 사게 됩니다(꽃말_버즘나무 3·4번).
   * 누르기 **전에** 그걸 볼 수 있는 화면은 여기뿐입니다.
   */
  it("shows the pictures that go with each request — the first frame always, the last when there is one", async () => {
    const previews = makePreviews(2).map((preview, index) => (
      index === 0 ? { ...preview, lastFrameSceneNumber: 2 as VideoPromptPreview["sceneNumber"] } : preview
    ));
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { previews, confirmationId: "c1" })));

    const first = await screen.findByTestId("frames-1");
    const pictures = first.querySelectorAll("img");
    expect(pictures.length, "시작 그림과 끝 그림 둘").toBe(2);
    expect(pictures[0]!.getAttribute("src")).toContain("/projects/sample_project/images/1/content");
    expect(pictures[1]!.getAttribute("src")).toContain("/projects/sample_project/images/2/content");
    expect(first.textContent).toContain("시작");
    expect(first.textContent).toContain("끝");

    // 끝 그림이 없는 클립은 빈 자리를 남기지 않고 그렇다고 말합니다 — 빈 자리는 「아직 안 불러왔나」로 읽힙니다.
    const last = screen.getByTestId("frames-2");
    expect(last.querySelectorAll("img").length).toBe(1);
    expect(screen.getByTestId("frames-single-2").textContent).toContain("이 한 장만 보냅니다");
  });

  it("names the sections the server had to drop, and leaves untouched scenes unmarked", async () => {
    const previews = makePreviews(2);
    previews[0] = { ...previews[0]!, omittedSections: ["Continuity cue", "Pacing"] };
    const response: GetVideoPromptPreviewResponse = { previews, confirmationId: "confirmation_1" };
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, response)));

    const notice = await screen.findByTestId("prompt-omitted-1");
    expect(notice.textContent).toContain("장면 연결");
    expect(notice.textContent).toContain("움직임 속도");
    // A scene that lost nothing must stay quiet — a notice on every scene teaches people to ignore it.
    expect(screen.queryByTestId("prompt-omitted-2")).toBeNull();
  });

  it("passes through a dropped section it has no Korean name for, rather than hiding it", async () => {
    const previews = makePreviews(2);
    previews[0] = { ...previews[0]!, omittedSections: ["Some New Section"] };
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { previews, confirmationId: "c1" })));

    expect((await screen.findByTestId("prompt-omitted-1")).textContent).toContain("Some New Section");
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
    const summary = screen.getByTestId("preview-summary");
    expect(screen.getByTestId("preview-model-label").textContent).toBe("Runway Gen-4 Turbo");
    expect(screen.getByTestId("preview-model-id").textContent).toBe("gen4_turbo");
    expect(summary.textContent).toContain("비율 세로형 9:16 (720:1280)");
    expect(summary.textContent).toContain("장면당 5초");
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
    expect(screen.getByTestId("prompt-length-1").textContent).toBe(`${baseline} / ${LIMIT}`);

    fireEvent.change(textarea, { target: { value: "Scene 1 prompt😀" } });

    // "😀" is a surrogate pair — two UTF-16 code units for one visible emoji.
    expect(screen.getByTestId("prompt-length-1").textContent).toBe(`${baseline + 2} / ${LIMIT}`);
    expect(screen.queryByTestId("prompt-limit-error-1")).toBeNull();
  });

  it("flags a scene prompt that exceeds the authoring limit in UTF-16 code units", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await screen.findByTestId("preview-list");
    const textarea = screen.getByLabelText("Runway 프롬프트", { selector: "#prompt-1" }) as HTMLTextAreaElement;
    const overLong = "a".repeat(LIMIT + 1);
    fireEvent.change(textarea, { target: { value: overLong } });

    expect(screen.getByTestId("prompt-length-1").textContent).toBe(`${LIMIT + 1} / ${LIMIT}`);
    const alert = screen.getByTestId("prompt-limit-error-1");
    expect(alert).toBeTruthy();
    expect(alert.textContent).toBe(`프롬프트가 최대 글자 수(${LIMIT}자)를 초과했습니다.`);
  });

  it("does not flag a scene prompt exactly at the authoring limit", async () => {
    const response: GetVideoPromptPreviewResponse = { previews: makePreviews() };
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await screen.findByTestId("preview-list");
    const textarea = screen.getByLabelText("Runway 프롬프트", { selector: "#prompt-1" }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "a".repeat(LIMIT) } });

    expect(screen.getByTestId("prompt-length-1").textContent).toBe(`${LIMIT} / ${LIMIT}`);
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

    /*
     * 🔴 The expected sentence is asked of the same mapper the screen uses, not retyped here.
     *
     * These rows used to carry the message as a literal, and that copy cost us twice in one day: the budget
     * refusal was reworded to name Runway, `main` would have gone red on a row that has nothing to do with
     * which provider is named, and the comment sitting on that row claimed it only named the unchanging half —
     * which was not true of the line under it. A guard that has to be edited in step with the thing it guards
     * is a second copy, and this repository keeps paying for those (the guards in cc432e0, the flower preset's
     * 씨앗 ban, this).
     *
     * It does not weaken the case. What is being checked is that the backend's own `message` never reaches the
     * screen — "raw backend detail" is a different string from every mapped sentence, and a screen that printed
     * the code, the raw detail, or nothing still fails. Reword a sentence in SAFE_ERRORS now and this stays
     * green, which is correct: the wording is not what this case is about.
     */
    it.each([
      "VIDEO_CONFIRMATION_STALE",
      "VIDEO_BUDGET_EXCEEDED",
      "VIDEO_CALL_LIMIT_EXCEEDED",
      "VIDEO_REQUEST_ID_CONFLICT",
      "VIDEO_SUBMISSION_NOT_ALLOWED",
    ])("shows a safe fixed error message for %s instead of the raw backend detail", async (code) => {
      const expectedMessage = toVideoSubmissionDisplayError(new VideoSubmissionApiError(code, "raw backend detail")).message;
      // The mapper has to actually know this code — an unmapped one falls back to a generic sentence, and then
      // every assertion below would pass while proving nothing about the code named in the row.
      expect(expectedMessage).not.toBe(toVideoSubmissionDisplayError(new VideoSubmissionApiError("NOT_A_REAL_CODE", "x")).message);
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

      fireEvent.click(screen.getByRole("button", { name: "처음 내용으로 되돌리기" }));
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
