import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeLongEpisodeOutline, makeLongProject } from "../api/testUtils.js";
import { LongProjectOutlineScreen } from "./LongProjectOutlineScreen.js";

const PREVIEW = {
  projectId: "long_test",
  prompt: "장기 프로젝트 아웃라인 초안",
  promptSha256: "a".repeat(64),
  episodeCount: 3,
};

const APPROVAL_RESPONSE = {
  project: makeLongProject({ id: "long_test", outlineStatus: "outline_ready" }),
  approvedAt: "2026-08-23T00:00:00.000Z",
  promptSha256: "b".repeat(64),
  modified: true,
};

function outlineReadyEpisodes() {
  return [1, 2, 3].map((number) => makeLongEpisodeOutline({ episodeNumber: number, title: `${number}화`, status: "outline_ready" }));
}

const GENERATED_APPROVAL_RESPONSE = {
  ...APPROVAL_RESPONSE,
  project: makeLongProject({ id: "long_test", outlineStatus: "outline_ready", episodes: outlineReadyEpisodes() }),
};

function renderScreen(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return render(<LongProjectOutlineScreen projectId="long_test" onBack={() => {}} />);
}

function textarea(): HTMLTextAreaElement {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

describe("LongProjectOutlineScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state, then loads the preview via POST /long-projects/:projectId/outline/preview", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { preview: PREVIEW }));
    renderScreen(fetchMock);

    expect(screen.getByText("미리보기를 불러오는 중...")).toBeTruthy();
    await screen.findByDisplayValue(PREVIEW.prompt);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/long-projects/long_test/outline/preview");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("shows a safe error instead of the raw backend message when the preview request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { code: "LONG_PROJECT_NOT_FOUND", message: "raw backend detail" }));
    renderScreen(fetchMock);

    const alert = await screen.findByTestId("preview-error");
    expect(alert.textContent).not.toContain("raw backend detail");
    expect(alert).toHaveAttribute("data-error-code", "LONG_PROJECT_NOT_FOUND");
  });

  it("lets the user edit the textarea and restore the original prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { preview: PREVIEW }));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.change(textarea(), { target: { value: "수정된 아웃라인 프롬프트" } });
    expect(textarea().value).toBe("수정된 아웃라인 프롬프트");

    fireEvent.click(screen.getByRole("button", { name: "원본으로 복원" }));
    expect(textarea().value).toBe(PREVIEW.prompt);
  });

  it("blocks approval of an empty prompt without calling the approval endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { preview: PREVIEW }));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.change(textarea(), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));

    const alert = await screen.findByTestId("validation-error");
    expect(alert.textContent).toBe("스토리 개요 프롬프트를 입력해야 합니다.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not call the approval endpoint on the first click — it only opens an explicit confirmation panel", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { preview: PREVIEW }));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.change(textarea(), { target: { value: "수정된 아웃라인 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));

    const panel = await screen.findByTestId("approve-confirm-panel");
    expect(panel).toBeTruthy();
    expect(screen.getByRole("button", { name: "네, 승인합니다" })).toBeTruthy();
    // The short project's story-prompt approval spends money at this exact step; this one cannot
    // (LongProjectsService is built with no provider or budget), so the panel has to say so.
    expect(panel.textContent).toContain("비용이 들지 않습니다");
    // Only the preview POST has happened — the first click never sent an approval request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns to editing without sending anything when the confirmation panel is cancelled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { preview: PREVIEW }));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.change(textarea(), { target: { value: "수정된 아웃라인 프롬프트" } });
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

    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.change(textarea(), { target: { value: "수정된 아웃라인 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "네, 승인합니다" }));

    await screen.findByTestId("approved-message");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/long-projects/long_test/outline/approval");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      promptSha256: PREVIEW.promptSha256,
      prompt: "수정된 아웃라인 프롬프트",
      approved: true,
    });
  });

  it("shows the outline_ready episodes after final approval", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { preview: PREVIEW }))
      .mockResolvedValueOnce(jsonResponse(200, GENERATED_APPROVAL_RESPONSE));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.change(textarea(), { target: { value: "수정된 아웃라인 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");
    fireEvent.click(screen.getByRole("button", { name: "네, 승인합니다" }));

    await screen.findByTestId("approved-message");
    const episodesPanel = await screen.findByTestId("episode-outline-list");
    expect(episodesPanel).toBeTruthy();
    for (const number of [1, 2, 3]) {
      const item = screen.getByTestId(`episode-outline-${number}`);
      expect(item).toHaveAttribute("data-status", "outline_ready");
    }
  });

  it("shows a stale-hash error with a refresh action and never leaks the raw backend message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { preview: PREVIEW }))
      .mockResolvedValueOnce(jsonResponse(409, { code: "LONG_OUTLINE_STALE", message: "raw backend detail" }));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.change(textarea(), { target: { value: "수정된 아웃라인 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");
    fireEvent.click(screen.getByRole("button", { name: "네, 승인합니다" }));

    const alert = await screen.findByTestId("approve-error");
    expect(alert).toHaveAttribute("data-error-code", "LONG_OUTLINE_STALE");
    expect(alert.textContent).not.toContain("raw backend detail");
    expect(screen.getByRole("button", { name: "새로고침" })).toBeTruthy();
  });

  it("shows a safe error for LONG_OUTLINE_NOT_ALLOWED without leaking the raw backend message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { preview: PREVIEW }))
      .mockResolvedValueOnce(jsonResponse(409, { code: "LONG_OUTLINE_NOT_ALLOWED", message: "raw backend detail" }));
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.change(textarea(), { target: { value: "수정된 아웃라인 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");
    fireEvent.click(screen.getByRole("button", { name: "네, 승인합니다" }));

    const alert = await screen.findByTestId("approve-error");
    expect(alert).toHaveAttribute("data-error-code", "LONG_OUTLINE_NOT_ALLOWED");
    expect(alert.textContent).not.toContain("raw backend detail");
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

    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.change(textarea(), { target: { value: "수정된 아웃라인 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");

    const confirmButton = screen.getByRole("button", { name: "네, 승인합니다" });
    fireEvent.click(confirmButton);
    expect(confirmButton).toBeDisabled();
    fireEvent.click(confirmButton);

    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 preview POST + exactly one approval POST
    resolveApproval(jsonResponse(200, APPROVAL_RESPONSE));
    await waitFor(() => expect(screen.queryByTestId("approve-confirm-panel")).toBeNull());
  });
});
