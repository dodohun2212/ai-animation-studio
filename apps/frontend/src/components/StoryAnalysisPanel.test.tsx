import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApproveNovelStoryAnalysisResponse, NovelStoryAnalysisInput, NovelStoryAnalysisPreviewResponse } from "@ai-animation-studio/shared";
import { stubFetchByRoute } from "../api/testUtils.js";
import { StoryAnalysisPanel } from "./StoryAnalysisPanel.js";

const INPUT: NovelStoryAnalysisInput = {
  sourceText: "어느 날 밤, 하나는 같은 꿈을 꾸었다. 낯선 문이 열렸다.",
  title: "달빛 문",
  logline: "평범한 직장인이 낯선 문을 발견한다",
  rightsConfirmed: true,
  episodeCount: 3,
  sceneCount: 6,
};

function previewResponse(overrides: Partial<NovelStoryAnalysisPreviewResponse["preview"]> = {}, budget: NovelStoryAnalysisPreviewResponse["budget"] | null = { monthlyLimitUsd: 20, spentUsd: 1.5, remainingUsd: 18.5, estimatedRequestCostUsd: 0.05, canSpend: true }): NovelStoryAnalysisPreviewResponse {
  return {
    preview: { inputSha256: "a".repeat(64), promptSha256: "b".repeat(64), prompt: "【이야기 분석】 원문: 어느 날 밤…", model: "gpt-5.6-luna", sourceCharacterCount: 31, estimatedCostUsd: 0.05, providerAvailable: true, ...overrides },
    ...(budget ? { budget } : {}),
  };
}

function approveResponse(overrides: Partial<ApproveNovelStoryAnalysisResponse> = {}): ApproveNovelStoryAnalysisResponse {
  return {
    analysis: {
      title: "달빛 문",
      logline: "낯선 문 뒤의 세계",
      genre: "판타지",
      tone: "몽환적",
      theme: "용기",
      characters: [
        { id: "c1", name: "새봄", role: "protagonist", appearance: "짧은 머리의 직장인", personality: "조용하고 호기심 많다" },
        { id: "c2", name: "문지기", role: "supporting", appearance: "회색 망토", personality: "수수께끼 같다" },
      ],
      episodes: [
        { episodeNumber: 1, title: "첫 번째 꿈", summary: "새봄이 문을 본다.", mainEvent: "문 발견", conflict: "두려움", cliffhanger: "문이 열린다", nextEpisodeHook: "안에서 목소리가 난다" },
        { episodeNumber: 2, title: "문 너머", summary: "새봄이 들어간다.", mainEvent: "입장", conflict: "길을 잃음", cliffhanger: "문지기 등장", nextEpisodeHook: "문지기의 제안" },
      ],
      warnings: ["실존 인물로 보이는 이름이 있어 새 이름으로 바꾸었습니다."],
    },
    source: { inputSha256: "a".repeat(64), promptSha256: "b".repeat(64), title: "달빛 문", rightsConfirmedAt: "2026-10-10T01:00:00.000Z", analyzedAt: "2026-10-10T01:00:05.000Z", model: "gpt-5.6-luna", episodeCount: 3, sceneCount: 6 },
    reused: false,
    saved: true,
    ...overrides,
  };
}

const PREVIEW = "POST /story-analysis/preview";
const APPROVE = "POST /story-analysis";

function mockServer(routes: Record<string, unknown>, errors: Record<string, { status: number; body: unknown }> = {}) {
  const fetchMock = stubFetchByRoute(routes, errors);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const posts = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .map(([url, init]) => ({ method: (init as RequestInit | undefined)?.method ?? "GET", url: String(url), body: (init as RequestInit | undefined)?.body ? JSON.parse(String((init as RequestInit).body)) : undefined }))
    .filter((call) => call.method === "POST");

function renderPanel(input: NovelStoryAnalysisInput | null = INPUT) {
  const onOpenSettings = vi.fn();
  const view = render(<StoryAnalysisPanel input={input} onOpenSettings={onOpenSettings} />);
  return { onOpenSettings, rerender: (next: NovelStoryAnalysisInput | null) => view.rerender(<StoryAnalysisPanel input={next} onOpenSettings={onOpenSettings} />) };
}

async function makePreview() {
  fireEvent.click(screen.getByTestId("story-preview-run"));
  await screen.findByTestId("story-preview");
}

describe("StoryAnalysisPanel", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("cannot preview until the form gives it a complete input", () => {
    const fetchMock = mockServer({});
    renderPanel(null);
    expect((screen.getByTestId("story-preview-run") as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** 🔴 미리보기는 무료·저장 없음 — 미리보기만으로 승인 요청이 나가지 않는다. */
  it("shows model, fixed estimate, budget and the exact prompt, and sends nothing paid yet", async () => {
    const fetchMock = mockServer({ [PREVIEW]: previewResponse() });
    renderPanel();
    await makePreview();

    expect(screen.getByTestId("story-preview-model").textContent).toBe("gpt-5.6-luna");
    expect(screen.getByTestId("story-preview-cost").textContent).toContain("$0.05");
    expect(screen.getByTestId("story-preview-budget").textContent).toContain("남은 돈 $18.50");
    expect((screen.getByTestId("story-preview-prompt") as HTMLTextAreaElement).value).toContain("원문: 어느 날 밤");
    expect((screen.getByTestId("story-approve") as HTMLButtonElement).disabled).toBe(false);
    expect(posts(fetchMock).map((call) => call.url)).toEqual(["/story-analysis/preview"]);
    expect(posts(fetchMock)[0]!.body).toEqual(INPUT);
    expect(screen.queryByTestId("story-result")).toBeNull();
  });

  it("approves with the input, both hashes and approved:true — one paid request — and shows the structure", async () => {
    const fetchMock = mockServer({ [PREVIEW]: previewResponse(), [APPROVE]: approveResponse() });
    renderPanel();
    await makePreview();
    fireEvent.click(screen.getByTestId("story-approve"));

    const result = await screen.findByTestId("story-result");
    expect(posts(fetchMock).map((call) => call.url)).toEqual(["/story-analysis/preview", "/story-analysis"]);
    expect(posts(fetchMock)[1]!.body).toEqual({ ...INPUT, inputSha256: "a".repeat(64), promptSha256: "b".repeat(64), approved: true });
    expect(screen.getByTestId("story-result-title").textContent).toBe("달빛 문");
    expect(screen.getByTestId("story-character-card-c1").textContent).toContain("주인공");
    expect(screen.getByTestId("story-character-card-c2").textContent).toContain("조연");
    expect(screen.getByTestId("story-episode-card-2").textContent).toContain("문지기의 제안");
    expect(screen.getByTestId("story-result-warnings").textContent).toContain("실존 인물");
    expect(result.textContent).toContain("보장은 하지 않습니다");
    expect(screen.queryByTestId("story-result-reused")).toBeNull();
    expect(screen.queryByTestId("story-result-unsaved")).toBeNull();
    expect(screen.queryByTestId("story-result-spend-unrecorded")).toBeNull();
  });

  /** 🔴 미리보기 뒤 한 글자라도 바뀌면 승인할 수 없다(서버도 해시가 다르면 거절한다). */
  it("turns the approval off when the input changes after the preview", async () => {
    const fetchMock = mockServer({ [PREVIEW]: previewResponse(), [APPROVE]: approveResponse() });
    const { rerender } = renderPanel();
    await makePreview();
    rerender({ ...INPUT, sourceText: `${INPUT.sourceText} 한 줄 더.` });

    expect(screen.getByTestId("story-preview-stale")).toBeTruthy();
    expect((screen.getByTestId("story-approve") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("story-approve"));
    expect(posts(fetchMock).map((call) => call.url)).toEqual(["/story-analysis/preview"]);

    fireEvent.click(screen.getByTestId("story-preview-run"));
    await waitFor(() => expect(screen.queryByTestId("story-preview-stale")).toBeNull());
    expect((screen.getByTestId("story-approve") as HTMLButtonElement).disabled).toBe(false);
  });

  it("refuses to approve without a connected OpenAI key and offers the settings screen", async () => {
    const fetchMock = mockServer({ [PREVIEW]: previewResponse({ providerAvailable: false }) });
    const { onOpenSettings } = renderPanel();
    await makePreview();
    expect(screen.getByTestId("story-preview-blocked").textContent).toContain("키가 저장·연결되어 있지 않아");
    expect((screen.getByTestId("story-approve") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("story-open-settings"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  it("refuses to approve when the monthly budget cannot cover it", async () => {
    mockServer({ [PREVIEW]: previewResponse({}, { monthlyLimitUsd: 1, spentUsd: 0.99, remainingUsd: 0.01, estimatedRequestCostUsd: 0.05, canSpend: false }) });
    renderPanel();
    await makePreview();
    expect(screen.getByTestId("story-preview-blocked").textContent).toContain("예산이 부족");
    expect((screen.getByTestId("story-approve") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says plainly when a result is reused, unsaved, or its spend was not recorded", async () => {
    mockServer({ [PREVIEW]: previewResponse(), [APPROVE]: approveResponse({ reused: true, saved: false, spendUnrecorded: true, source: { ...approveResponse().source, sourceNote: "Reddit 글" } }) });
    renderPanel();
    await makePreview();
    fireEvent.click(screen.getByTestId("story-approve"));
    await screen.findByTestId("story-result");
    expect(screen.getByTestId("story-result-reused").textContent).toContain("새로 청구되지 않았습니다");
    expect(screen.getByTestId("story-result-unsaved").textContent).toContain("저장되지 않았습니다");
    expect(screen.getByTestId("story-result-spend-unrecorded").textContent).toContain("장부에 기록되지 않았을 수");
    expect(screen.getByTestId("story-result-source").textContent).toContain("출처 메모: Reddit 글");
  });

  it("keeps the result visible but marks it as the old input's when the form changes afterwards", async () => {
    mockServer({ [PREVIEW]: previewResponse(), [APPROVE]: approveResponse() });
    const { rerender } = renderPanel();
    await makePreview();
    fireEvent.click(screen.getByTestId("story-approve"));
    await screen.findByTestId("story-result");
    rerender({ ...INPUT, title: "다른 제목" });
    expect(screen.getByTestId("story-result-stale").textContent).toContain("바뀌기 전 입력");
  });

  /** 요청이 나갔을 수 있는 실패는 자동으로 다시 보내지 않는다 — 한 번만 보내고 문장으로 말한다. */
  it.each([
    ["STORY_ANALYSIS_ALREADY_ATTEMPTED", 409, undefined, "다시 보내지 않았습니다"],
    ["STORY_ANALYSIS_PROMPT_STALE", 409, undefined, "요청은 나가지 않았습니다"],
    ["STORY_ANALYSIS_INVALID_REQUEST", 400, undefined, "6,000자"],
    ["BUDGET_LEDGER_UNREADABLE", 409, undefined, "사용 기록 파일을 읽지 못해"],
    ["STORY_ANALYSIS_PROVIDER_ERROR", 502, { category: "timeout", spendUnrecorded: true }, "OpenAI 사용량을 확인해 주세요"],
    ["STORY_ANALYSIS_STORAGE_ERROR", 500, { requestSent: true, spendUnrecorded: false }, "요청은 나갔지만 결과를 저장하지 못했습니다"],
    ["STORY_ANALYSIS_STORAGE_ERROR", 500, { requestSent: false }, "요청을 보내지 않았습니다"],
  ] as const)("shows a fixed sentence for %s and does not retry on its own", async (code, status, details, text) => {
    const fetchMock = mockServer({ [PREVIEW]: previewResponse() }, { [APPROVE]: { status, body: { code, message: "raw", ...(details ? { details } : {}) } } });
    renderPanel();
    await makePreview();
    fireEvent.click(screen.getByTestId("story-approve"));

    const alert = await screen.findByTestId("story-analysis-error");
    expect(alert.getAttribute("data-error-code")).toBe(code);
    expect(alert.textContent).toContain(text);
    expect(alert.textContent).not.toContain("raw");
    expect(posts(fetchMock).filter((call) => call.url === "/story-analysis")).toHaveLength(1);
    expect(screen.queryByTestId("story-result")).toBeNull();
  });

  it.each([["STORY_ANALYSIS_KEY_MISSING"], ["STORY_ANALYSIS_BUDGET_EXCEEDED"]] as const)("offers the settings screen on %s", async (code) => {
    mockServer({ [PREVIEW]: previewResponse() }, { [APPROVE]: { status: 409, body: { code, message: "raw" } } });
    const { onOpenSettings } = renderPanel();
    await makePreview();
    fireEvent.click(screen.getByTestId("story-approve"));
    await screen.findByTestId("story-analysis-error");
    fireEvent.click(screen.getByTestId("story-error-open-settings"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("names the shared budget sentence for a budget refusal", async () => {
    mockServer({ [PREVIEW]: previewResponse() }, { [APPROVE]: { status: 409, body: { code: "STORY_ANALYSIS_BUDGET_EXCEEDED", message: "raw" } } });
    renderPanel();
    await makePreview();
    fireEvent.click(screen.getByTestId("story-approve"));
    expect((await screen.findByTestId("story-analysis-error")).textContent).toContain("한도를 올릴 수 있습니다");
  });

  it("refuses a malformed preview or result instead of showing it", async () => {
    mockServer({ [PREVIEW]: { preview: { model: "x" } } });
    renderPanel();
    fireEvent.click(screen.getByTestId("story-preview-run"));
    expect((await screen.findByTestId("story-analysis-error")).getAttribute("data-error-code")).toBe("CLIENT_MALFORMED_RESPONSE");
    expect(screen.queryByTestId("story-preview")).toBeNull();
  });
});
