import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeLongEpisodeOutline, makeLongProject } from "../api/testUtils.js";
import { LONG_OUTLINE_ESTIMATED_COST_USD } from "@ai-animation-studio/shared";
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

/**
 * Answers on the route that was asked for, rather than on call order.
 *
 * These tests used to queue responses positionally, which held only while the screen made exactly the requests
 * they expected in exactly that order. Adding the mount-time project read shifted every queue by one and nine
 * tests failed at once — each request quietly receiving the answer meant for another. Routing removes the
 * coupling: a test states what each endpoint answers, and stays true when the screen asks for something else.
 */
type Answer = Response | Promise<Response>;
function routedFetch(routes: { project?: Answer[]; preview?: Answer[]; approval?: Answer[] }) {
  const queues: Record<string, Answer[]> = { project: [...(routes.project ?? [])], preview: [...(routes.preview ?? [])], approval: [...(routes.approval ?? [])] };
  return vi.fn((url: string) => {
    const key = url.endsWith("/outline/preview") ? "preview" : url.endsWith("/outline/approval") ? "approval" : "project";
    const queue = queues[key]!;
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    if (!next) throw new Error(`No response configured for ${key} (${url})`);
    return Promise.resolve(next);
  });
}

/** The mount-time read, for the ordinary case where the outline has not been generated yet. */
function plannedProject() {
  return jsonResponse(200, { project: makeLongProject({ id: "long_test", outlineStatus: "planned" }) });
}

/** How many requests went to `suffix`. Counting every request instead says "and nothing else happened", which is a different and more brittle claim. */
function countTo(fetchMock: ReturnType<typeof vi.fn>, suffix: string): number {
  return (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(([url]) => url.endsWith(suffix)).length;
}

/** The one call made to `suffix`, so an assertion names the request it means instead of counting to it. */
function callTo(fetchMock: ReturnType<typeof vi.fn>, suffix: string): [string, RequestInit] {
  const call = (fetchMock.mock.calls as Array<[string, RequestInit]>).find(([url]) => url.endsWith(suffix));
  if (!call) throw new Error(`No request was made to ${suffix}`);
  return call;
}

describe("LongProjectOutlineScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state, then loads the preview via POST /long-projects/:projectId/outline/preview", async () => {
    const fetchMock = routedFetch({ project: [plannedProject()], preview: [jsonResponse(200, { preview: PREVIEW })] });
    renderScreen(fetchMock);

    expect(screen.getByText("미리보기를 불러오는 중...")).toBeTruthy();
    await screen.findByDisplayValue(PREVIEW.prompt);

    const [url, init] = callTo(fetchMock, "/outline/preview");
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
    const fetchMock = routedFetch({ project: [plannedProject()], preview: [jsonResponse(200, { preview: PREVIEW })] });
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.change(textarea(), { target: { value: "수정된 아웃라인 프롬프트" } });
    expect(textarea().value).toBe("수정된 아웃라인 프롬프트");

    fireEvent.click(screen.getByRole("button", { name: "원본으로 복원" }));
    expect(textarea().value).toBe(PREVIEW.prompt);
  });

  it("blocks approval of an empty prompt without calling the approval endpoint", async () => {
    const fetchMock = routedFetch({ project: [plannedProject()], preview: [jsonResponse(200, { preview: PREVIEW })] });
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.change(textarea(), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));

    const alert = await screen.findByTestId("validation-error");
    expect(alert.textContent).toBe("스토리 개요 프롬프트를 입력해야 합니다.");
    expect(countTo(fetchMock, "/outline/approval")).toBe(0);
  });

  it("does not call the approval endpoint on the first click — it only opens an explicit confirmation panel", async () => {
    const fetchMock = routedFetch({ project: [plannedProject()], preview: [jsonResponse(200, { preview: PREVIEW })] });
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.change(textarea(), { target: { value: "수정된 아웃라인 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));

    const panel = await screen.findByTestId("approve-confirm-panel");
    expect(panel).toBeTruthy();
    expect(screen.getByRole("button", { name: "네, 승인합니다" })).toBeTruthy();
    // This assertion used to read toContain("비용이 들지 않습니다") and was the reason the screen went on
    // saying a paid step was free long after it stopped being one: the claim was pinned by a test, so every
    // run went green while the sentence was false. The panel must name the charge, and the amount must come
    // from the shared constant rather than a literal — a test that hardcodes "$0.10" would silently outlive
    // the next rate change exactly the way its predecessor outlived the planner being wired up.
    expect(panel.textContent).toContain("비용이 발생합니다");
    expect(panel.textContent).toContain(`$${LONG_OUTLINE_ESTIMATED_COST_USD.toFixed(2)}`);
    expect(panel.textContent).not.toContain("비용이 들지 않습니다");
    // Only the preview POST has happened — the first click never sent an approval request.
    expect(countTo(fetchMock, "/outline/approval")).toBe(0);
  });

  it("returns to editing without sending anything when the confirmation panel is cancelled", async () => {
    const fetchMock = routedFetch({ project: [plannedProject()], preview: [jsonResponse(200, { preview: PREVIEW })] });
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.change(textarea(), { target: { value: "수정된 아웃라인 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");

    fireEvent.click(screen.getByRole("button", { name: "돌아가기" }));

    expect(screen.queryByTestId("approve-confirm-panel")).toBeNull();
    expect(countTo(fetchMock, "/outline/approval")).toBe(0);
    expect(textarea()).not.toBeDisabled();
  });

  it("submits an explicit approved:true POST only after the second, final confirmation click", async () => {
    const fetchMock = routedFetch({ project: [plannedProject()], preview: [jsonResponse(200, { preview: PREVIEW })], approval: [jsonResponse(200, APPROVAL_RESPONSE)] });
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.change(textarea(), { target: { value: "수정된 아웃라인 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");
    expect(countTo(fetchMock, "/outline/approval")).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "네, 승인합니다" }));

    await screen.findByTestId("approved-message");
    expect(countTo(fetchMock, "/outline/approval")).toBe(1);
    const [url, init] = callTo(fetchMock, "/outline/approval");
    expect(url).toBe("/long-projects/long_test/outline/approval");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      promptSha256: PREVIEW.promptSha256,
      prompt: "수정된 아웃라인 프롬프트",
      approved: true,
    });
  });

  it("shows the outline_ready episodes after final approval", async () => {
    const fetchMock = routedFetch({ project: [plannedProject()], preview: [jsonResponse(200, { preview: PREVIEW })], approval: [jsonResponse(200, GENERATED_APPROVAL_RESPONSE)] });
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
    const fetchMock = routedFetch({ project: [plannedProject()], preview: [jsonResponse(200, { preview: PREVIEW })], approval: [jsonResponse(409, { code: "LONG_OUTLINE_STALE", message: "raw backend detail" })] });
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
    const fetchMock = routedFetch({ project: [plannedProject()], preview: [jsonResponse(200, { preview: PREVIEW })], approval: [jsonResponse(409, { code: "LONG_OUTLINE_NOT_ALLOWED", message: "raw backend detail" })] });
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
    const fetchMock = routedFetch({
      project: [plannedProject()],
      preview: [jsonResponse(200, { preview: PREVIEW })],
      approval: [new Promise<Response>((resolve) => { resolveApproval = resolve; })],
    });
    renderScreen(fetchMock);

    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.change(textarea(), { target: { value: "수정된 아웃라인 프롬프트" } });
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");

    const confirmButton = screen.getByRole("button", { name: "네, 승인합니다" });
    fireEvent.click(confirmButton);
    expect(confirmButton).toBeDisabled();
    fireEvent.click(confirmButton);

    expect(countTo(fetchMock, "/outline/approval")).toBe(1);
    resolveApproval(jsonResponse(200, APPROVAL_RESPONSE));
    await waitFor(() => expect(screen.queryByTestId("approve-confirm-panel")).toBeNull());
  });

  it("does not offer approval again for an outline that is already approved", async () => {
    // A reload during the ~25-second approval used to bring this screen back with the button armed. Pressing it
    // again reached the server, and one project was billed twice for the same outline 22.9 seconds apart — the
    // budget ledger shows the two requests genuinely overlapped. The server refuses the second attempt now, but
    // a screen that invites a refused action is still wrong (D-023).
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: unknown) => Promise.resolve(
      String(url).endsWith("/outline/preview")
        ? jsonResponse(200, { preview: PREVIEW })
        : jsonResponse(200, { project: makeLongProject({ outlineStatus: "outline_ready" }) }),
    )));

    render(<LongProjectOutlineScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByTestId("outline-already-approved");
    expect(screen.queryByRole("button", { name: "이 프롬프트로 승인" })).toBeNull();
  });

  it("says how long the approval takes, and that pressing again will not help", async () => {
    // The 23 seconds of an unchanged screen is what actually produced the second press. A button reading
    // 전송 중… was the only sign it was working. Asserted on the specific promises the notice makes, so a
    // future edit that softens it into a generic spinner has to change this test deliberately.
    let resolveApproval: ((value: unknown) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: unknown) => {
      const target = String(url);
      if (target.endsWith("/outline/preview")) return Promise.resolve(jsonResponse(200, { preview: PREVIEW }));
      if (target.endsWith("/outline/approval")) return new Promise((resolve) => { resolveApproval = resolve; });
      return Promise.resolve(jsonResponse(200, { project: makeLongProject({ outlineStatus: "planned" }) }));
    }));

    render(<LongProjectOutlineScreen projectId="long_test" onBack={() => {}} />);
    await screen.findByDisplayValue(PREVIEW.prompt);
    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    fireEvent.click(await screen.findByRole("button", { name: "네, 승인합니다" }));

    const notice = await screen.findByTestId("approve-in-progress");
    expect(notice.textContent).toContain("20~30초");
    expect(notice.textContent).toContain("다시 눌러도");
    expect(resolveApproval).toBeDefined();
  });
});
