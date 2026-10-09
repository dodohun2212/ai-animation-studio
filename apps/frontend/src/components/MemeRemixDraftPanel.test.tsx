import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemeObservationCard, MemeTrend } from "@ai-animation-studio/shared";

import { jsonResponse, makeProject } from "../api/testUtils.js";
import { MemeRemixDraftPanel } from "./MemeRemixDraftPanel.js";

const TREND: MemeTrend = {
  id: "trend", name: "관찰한 챌린지", evidence: [], videos: [], channelCount: 2,
  firstObservedAt: "2026-10-08T00:00:00.000Z", lastObservedAt: "2026-10-08T00:00:00.000Z",
};
const CARDS: MemeObservationCard[] = [
  { id: "card-1", kind: "gesture", text: "박자에 맞춰 양손을 든다", startSeconds: 1, endSeconds: 2, origin: "manual", sourceVideoId: null },
];

describe("MemeRemixDraftPanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates an editable scene plan as ordinary short-project settings without a Provider call", async () => {
    const project = makeProject({ id: "new_remix", topic: "정거장 로봇의 인사" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { project }));
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi.fn();
    render(<MemeRemixDraftPanel trend={TREND} cards={CARDS} onCreated={onCreated} />);

    expect(screen.getAllByLabelText(/장면$/)).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("프로젝트 폴더 이름"), { target: { value: "new_remix" } });
    fireEvent.change(screen.getByLabelText("새 영상 주제"), { target: { value: "정거장 로봇의 인사" } });
    fireEvent.change(screen.getByLabelText("내 캐릭터"), { target: { value: "로봇 토리" } });
    fireEvent.change(screen.getByLabelText("새로운 상황·배경"), { target: { value: "우주 정거장" } });
    fireEvent.change(screen.getByLabelText("2장면"), { target: { value: "로봇이 새로운 동작으로 동료에게 인사한다." } });
    fireEvent.click(screen.getByRole("button", { name: "이 계획으로 단기 프로젝트 만들기" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects");
    const request = JSON.parse(String(init.body));
    expect(request.initialStoryDraft).toMatchObject({ sceneCount: 3, character: "로봇 토리" });
    expect(request.initialStoryDraft.fullStory).toContain("2장면: 로봇이 새로운 동작");
    expect(request.initialStoryDraft.additionalNotes).toContain("박자에 맞춰 양손을 든다");
    expect(request.initialStoryDraft.additionalNotes).toContain("복제하지 마세요");
  });

  it("keeps an incomplete plan local and sends no request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<MemeRemixDraftPanel trend={TREND} cards={CARDS} onCreated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "이 계획으로 단기 프로젝트 만들기" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
