import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GenerateNovelCharacterImageResponse, NovelCharacterImagePreviewResponse } from "@ai-animation-studio/shared";
import { stubFetchByRoute } from "../api/testUtils.js";
import { CharacterImageControl } from "./CharacterImageControl.js";

const PREVIEW = "POST /story-analysis/character-image/preview";
const GENERATE = "POST /story-analysis/character-image";

function previewResponse(overrides: Partial<NovelCharacterImagePreviewResponse["preview"]> = {}, budget: NovelCharacterImagePreviewResponse["budget"] | null = { monthlyLimitUsd: 20, spentUsd: 2, remainingUsd: 18, estimatedRequestCostUsd: 0.1, canSpend: true }): NovelCharacterImagePreviewResponse {
  return {
    preview: { inputSha256: "c".repeat(64), promptSha256: "d".repeat(64), prompt: "정면 전신 캐릭터 시트 — 새봄: 짧은 머리의 직장인", model: "gpt-image-2", size: "1024x1536", estimatedCostUsd: 0.1, providerAvailable: true, ...overrides },
    ...(budget ? { budget } : {}),
  };
}

const GENERATED: GenerateNovelCharacterImageResponse = { folderAssetId: "ASSET-CHAR-NEW", imageAssetId: "ASSET-IMG-NEW", reused: false };

const base = {
  storyInputSha256: "a".repeat(64),
  characterId: "c1",
  name: "새봄",
  appearance: "짧은 머리의 직장인",
  personality: "조용하고 호기심 많다",
};

function mockServer(routes: Record<string, unknown> = {}, errors: Record<string, { status: number; body: unknown }> = {}) {
  const fetchMock = stubFetchByRoute(routes, errors);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const posts = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .map(([url, init]) => ({ method: (init as RequestInit | undefined)?.method ?? "GET", url: String(url), body: (init as RequestInit | undefined)?.body ? JSON.parse(String((init as RequestInit).body)) : undefined }))
    .filter((call) => call.method === "POST");

function renderControl(props: Partial<Parameters<typeof CharacterImageControl>[0]> = {}) {
  const onOpenSettings = vi.fn();
  const onGenerated = vi.fn();
  const onUseAsProtagonist = vi.fn();
  const full = { ...base, isProtagonist: true, onOpenSettings, onGenerated, onUseAsProtagonist, usedAsProtagonistFolderId: "", ...props };
  const view = render(<CharacterImageControl {...full} />);
  return { onOpenSettings, onGenerated, onUseAsProtagonist, rerender: (next: Partial<typeof full>) => view.rerender(<CharacterImageControl {...full} {...next} />) };
}

async function makePreview() {
  fireEvent.click(screen.getByTestId("character-image-preview-c1"));
  await screen.findByTestId("character-image-card-c1");
}

describe("CharacterImageControl (M3)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /** 🔴 열기·미리보기만으로 이미지 요청이 나가지 않는다 — 돈이 나가는 건 승인 버튼 한 곳. */
  it("sends nothing on mount, and only the free preview before approval", async () => {
    const fetchMock = mockServer({ [PREVIEW]: previewResponse() });
    renderControl();
    expect(fetchMock).not.toHaveBeenCalled();
    await makePreview();
    expect(posts(fetchMock).map((call) => call.url)).toEqual(["/story-analysis/character-image/preview"]);
    expect(posts(fetchMock)[0]!.body).toEqual({ storyInputSha256: "a".repeat(64), characterId: "c1", name: "새봄", appearance: "짧은 머리의 직장인", personality: "조용하고 호기심 많다" });
    expect(screen.getByTestId("character-image-model-c1").textContent).toBe("gpt-image-2 · 1024x1536");
    expect(screen.getByTestId("character-image-cost-c1").textContent).toContain("$0.10");
    expect(screen.getByTestId("character-image-budget-c1").textContent).toContain("남은 돈 $18.00");
    expect((screen.getByTestId("character-image-prompt-c1") as HTMLTextAreaElement).value).toContain("새봄");
    expect((screen.getByTestId("character-image-approve-c1") as HTMLButtonElement).disabled).toBe(false);
  });

  it("will not preview until name, appearance and personality are all filled", () => {
    const fetchMock = mockServer();
    renderControl({ appearance: "   " });
    expect((screen.getByTestId("character-image-preview-c1") as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("approves with the five fields, both hashes and approved:true — one paid request — and shows the folder image", async () => {
    const fetchMock = mockServer({ [PREVIEW]: previewResponse(), [GENERATE]: GENERATED });
    const { onGenerated } = renderControl();
    await makePreview();
    fireEvent.click(screen.getByTestId("character-image-approve-c1"));

    const result = await screen.findByTestId("character-image-result-c1");
    expect(posts(fetchMock).map((call) => call.url)).toEqual(["/story-analysis/character-image/preview", "/story-analysis/character-image"]);
    expect(posts(fetchMock)[1]!.body).toEqual({ ...base, inputSha256: "c".repeat(64), promptSha256: "d".repeat(64), approved: true });
    expect(result.querySelector("img")!.getAttribute("src")).toBe("/assets/ASSET-CHAR-NEW/content");
    expect(result.textContent).toContain("캐릭터 폴더로 등록됐습니다");
    expect(onGenerated).toHaveBeenCalledWith(GENERATED);
  });

  /** 주인공 폴더 연결은 사람이 그림을 본 뒤 따로 누르는 선택이고, 조연은 연결을 주장하지 않는다. */
  it("offers the protagonist link only as a separate choice after the picture, and not for a supporting character", async () => {
    mockServer({ [PREVIEW]: previewResponse(), [GENERATE]: GENERATED });
    const lead = renderControl({ isProtagonist: true });
    await makePreview();
    fireEvent.click(screen.getByTestId("character-image-approve-c1"));
    await screen.findByTestId("character-image-result-c1");
    expect(lead.onUseAsProtagonist).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("character-image-use-c1"));
    expect(lead.onUseAsProtagonist).toHaveBeenCalledWith("ASSET-CHAR-NEW");
    lead.rerender({ usedAsProtagonistFolderId: "ASSET-CHAR-NEW" });
    expect(screen.getByTestId("character-image-linked-c1").textContent).toContain("프로젝트를 확정하면 연결됩니다");
    expect(screen.queryByTestId("character-image-use-c1")).toBeNull();
  });

  it("says a supporting character's picture is only kept in the library", async () => {
    mockServer({ [PREVIEW]: previewResponse(), [GENERATE]: GENERATED });
    renderControl({ isProtagonist: false });
    await makePreview();
    fireEvent.click(screen.getByTestId("character-image-approve-c1"));
    const result = await screen.findByTestId("character-image-result-c1");
    expect(screen.queryByTestId("character-image-use-c1")).toBeNull();
    expect(result.textContent).toContain("조연 연결은 아직 없어");
  });

  /** 🔴 미리보기 뒤 인물 칸이 바뀌면 승인할 수 없다(서버도 해시가 다르면 거절). */
  it("turns the approval off when the character changes after the preview", async () => {
    const fetchMock = mockServer({ [PREVIEW]: previewResponse(), [GENERATE]: GENERATED });
    const { rerender } = renderControl();
    await makePreview();
    rerender({ appearance: "긴 머리의 직장인" });
    expect(screen.getByTestId("character-image-stale-c1")).toBeTruthy();
    expect((screen.getByTestId("character-image-approve-c1") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("character-image-approve-c1"));
    expect(posts(fetchMock).map((call) => call.url)).toEqual(["/story-analysis/character-image/preview"]);
  });

  /** CLI 1322: 그림을 만든 뒤 설명을 바꾸면 옛 그림을 새 설명의 그림처럼 보이거나 연결하지 않고, 다시 미리보기→승인으로 새로 만들 수 있다. */
  it("does not pass an old picture off as the new description's, and allows making a new one", async () => {
    const fetchMock = mockServer({ [PREVIEW]: previewResponse(), [GENERATE]: GENERATED });
    const { rerender } = renderControl();
    await makePreview();
    fireEvent.click(screen.getByTestId("character-image-approve-c1"));
    await screen.findByTestId("character-image-result-c1");
    expect(screen.getByTestId("character-image-use-c1")).toBeTruthy();

    rerender({ appearance: "긴 머리에 안경을 쓴 직장인" });
    expect(screen.queryByTestId("character-image-result-c1")).toBeNull();
    expect(screen.queryByTestId("character-image-use-c1")).toBeNull();
    expect(screen.getByTestId("character-image-old-c1").textContent).toContain("바뀌기 전 인물 설명");

    fireEvent.click(screen.getByTestId("character-image-preview-c1"));
    await waitFor(() => expect(posts(fetchMock).filter((call) => call.url.endsWith("/preview"))).toHaveLength(2));
    const approve = (await screen.findByTestId("character-image-approve-c1")) as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    expect(posts(fetchMock)[2]!.body.appearance).toBe("긴 머리에 안경을 쓴 직장인");
    fireEvent.click(approve);
    await screen.findByTestId("character-image-result-c1");
    expect(posts(fetchMock).filter((call) => call.url === "/story-analysis/character-image")).toHaveLength(2);
    expect(posts(fetchMock)[3]!.body.appearance).toBe("긴 머리에 안경을 쓴 직장인");
    expect(screen.queryByTestId("character-image-old-c1")).toBeNull();
  });

  it("keeps a picture that arrives after the description changed from attaching to the new description", async () => {
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => { release = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/preview")) return { ok: true, status: 200, json: async () => previewResponse() } as Response;
      return gate;
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = renderControl();
    await makePreview();
    fireEvent.click(screen.getByTestId("character-image-approve-c1"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    rerender({ appearance: "다른 모습으로 바꾼 설명" });
    release({ ok: true, status: 200, json: async () => GENERATED } as Response);

    const old = await screen.findByTestId("character-image-old-c1");
    expect(old.textContent).toContain("바뀌기 전 인물 설명");
    expect(screen.queryByTestId("character-image-result-c1")).toBeNull();
    expect(screen.queryByTestId("character-image-use-c1")).toBeNull();
  });

  it("refuses to approve without a connected key or with too little budget, and goes to settings", async () => {
    mockServer({ [PREVIEW]: previewResponse({ providerAvailable: false }) });
    const { onOpenSettings } = renderControl();
    await makePreview();
    expect(screen.getByTestId("character-image-blocked-c1").textContent).toContain("키가 저장·연결되어 있지 않아");
    expect((screen.getByTestId("character-image-approve-c1") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("API 설정 열기"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("refuses to approve when the budget cannot cover it", async () => {
    mockServer({ [PREVIEW]: previewResponse({}, { monthlyLimitUsd: 1, spentUsd: 0.95, remainingUsd: 0.05, estimatedRequestCostUsd: 0.1, canSpend: false }) });
    renderControl();
    await makePreview();
    expect(screen.getByTestId("character-image-blocked-c1").textContent).toContain("예산이 부족");
    expect((screen.getByTestId("character-image-approve-c1") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says plainly when the picture is reused or its spend was not recorded", async () => {
    mockServer({ [PREVIEW]: previewResponse(), [GENERATE]: { ...GENERATED, reused: true, spendUnrecorded: true } });
    renderControl();
    await makePreview();
    fireEvent.click(screen.getByTestId("character-image-approve-c1"));
    const result = await screen.findByTestId("character-image-result-c1");
    expect(result.textContent).toContain("새로 청구되지 않았습니다");
    expect(screen.getByTestId("character-image-spend-c1").textContent).toContain("장부에 기록되지 않았을 수");
  });

  /** 요청이 나갔을 수 있는 실패는 자동으로 다시 보내지 않는다 — 한 번만 보내고, 고정 문장만 보여 준다. */
  it.each([
    ["NOVEL_CHARACTER_IMAGE_ALREADY_ATTEMPTED", 409, undefined, "다시 눌러도 보내지 않습니다"],
    ["NOVEL_CHARACTER_IMAGE_PROMPT_STALE", 409, undefined, "요청은 나가지 않았습니다"],
    ["NOVEL_CHARACTER_IMAGE_INVALID_REQUEST", 400, undefined, "500자까지"],
    ["BUDGET_LEDGER_UNREADABLE", 409, undefined, "사용 기록 파일을 읽지 못해"],
    ["NOVEL_CHARACTER_IMAGE_PROVIDER_ERROR", 502, { category: "safety", spendUnrecorded: true, providerMessage: "정책에 맞지 않는 요청", providerRequestId: "req_abc" }, "요청 ID req_abc"],
    ["NOVEL_CHARACTER_IMAGE_STORAGE_ERROR", 500, { requestSent: true, spendUnrecorded: false }, "새로 청구하지 않고 저장된 그림으로 등록만"],
    ["NOVEL_CHARACTER_IMAGE_STORAGE_ERROR", 500, { requestSent: false }, "요청을 보내지 않았습니다"],
  ] as const)("shows a fixed sentence for %s and does not retry on its own", async (code, status, details, text) => {
    const fetchMock = mockServer({ [PREVIEW]: previewResponse() }, { [GENERATE]: { status, body: { code, message: "raw server text", ...(details ? { details } : {}) } } });
    renderControl();
    await makePreview();
    fireEvent.click(screen.getByTestId("character-image-approve-c1"));

    const alert = await screen.findByTestId("character-image-error-c1");
    expect(alert.getAttribute("data-error-code")).toBe(code);
    expect(alert.textContent).toContain(text);
    expect(alert.textContent).not.toContain("raw server text");
    expect(posts(fetchMock).filter((call) => call.url === "/story-analysis/character-image")).toHaveLength(1);
    expect(screen.queryByTestId("character-image-result-c1")).toBeNull();
  });

  it("lets the person download the picture that was already paid for when it could not be written to disk", async () => {
    mockServer(
      { [PREVIEW]: previewResponse() },
      { [GENERATE]: { status: 500, body: { code: "NOVEL_CHARACTER_IMAGE_STORAGE_ERROR", message: "x", details: { requestSent: true, spendUnrecorded: false, recoveryImageBase64: "iVBORw0KGgo=" } } } },
    );
    renderControl();
    await makePreview();
    fireEvent.click(screen.getByTestId("character-image-approve-c1"));
    const link = (await screen.findByTestId("character-image-recovery-c1")) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(link.getAttribute("download")).toBe("새봄.png");
    expect(screen.getByTestId("character-image-error-c1").textContent).toContain("다시 보내지 않으니");
  });

  it.each([["NOVEL_CHARACTER_IMAGE_KEY_MISSING"], ["NOVEL_CHARACTER_IMAGE_BUDGET_EXCEEDED"]] as const)("offers the settings screen on %s", async (code) => {
    mockServer({ [PREVIEW]: previewResponse() }, { [GENERATE]: { status: 409, body: { code, message: "raw" } } });
    const { onOpenSettings } = renderControl();
    await makePreview();
    fireEvent.click(screen.getByTestId("character-image-approve-c1"));
    const alert = await screen.findByTestId("character-image-error-c1");
    fireEvent.click(alert.querySelector("button")!);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("names the shared budget sentence for a budget refusal", async () => {
    mockServer({ [PREVIEW]: previewResponse() }, { [GENERATE]: { status: 409, body: { code: "NOVEL_CHARACTER_IMAGE_BUDGET_EXCEEDED", message: "raw" } } });
    renderControl();
    await makePreview();
    fireEvent.click(screen.getByTestId("character-image-approve-c1"));
    expect((await screen.findByTestId("character-image-error-c1")).textContent).toContain("한도를 올릴 수 있습니다");
  });

  it("refuses a malformed preview or result instead of showing it", async () => {
    mockServer({ [PREVIEW]: { preview: { model: "x" } } });
    renderControl();
    fireEvent.click(screen.getByTestId("character-image-preview-c1"));
    expect((await screen.findByTestId("character-image-error-c1")).getAttribute("data-error-code")).toBe("CLIENT_MALFORMED_RESPONSE");
    await waitFor(() => expect(screen.queryByTestId("character-image-card-c1")).toBeNull());
  });
});
