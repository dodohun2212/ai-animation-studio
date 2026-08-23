import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LongEpisodeStatus } from "@ai-animation-studio/shared";

import { jsonResponse, makeLongEpisodeOutline, makeLongProject } from "../api/testUtils.js";
import { LongProjectDetail } from "./LongProjectDetail.js";

describe("LongProjectDetail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reopens a project via GET /long-projects/:projectId and shows its summary", async () => {
    const project = makeLongProject({ id: "long_test", title: "우주 방랑자", logline: "귀환 이야기" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} />);

    expect(await screen.findByText("우주 방랑자")).toBeTruthy();
    expect(screen.getByText("귀환 이야기")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/long-projects/long_test");
  });

  it("shows planned and outline_ready episodes distinctly", async () => {
    const project = makeLongProject({
      id: "long_test",
      episodes: [
        makeLongEpisodeOutline({ episodeNumber: 1, title: "1화", status: "outline_ready" }),
        makeLongEpisodeOutline({ episodeNumber: 2, title: "2화", status: "planned" }),
      ],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} />);

    const first = await screen.findByTestId("episode-1");
    expect(first).toHaveAttribute("data-status", "outline_ready");
    const second = screen.getByTestId("episode-2");
    expect(second).toHaveAttribute("data-status", "planned");
  });

  it("shows a safe error instead of the raw backend message when reopening fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(404, { code: "LONG_PROJECT_NOT_FOUND", message: "raw backend detail" })),
    );
    render(<LongProjectDetail projectId="missing" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("raw backend detail");
    expect(alert).toHaveAttribute("data-error-code", "LONG_PROJECT_NOT_FOUND");
  });

  it("calls onOpenSettings and onOpenOutline with the project ID", async () => {
    const project = makeLongProject({ id: "long_test" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    const onOpenSettings = vi.fn();
    const onOpenOutline = vi.fn();
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={onOpenSettings} onOpenOutline={onOpenOutline} />);

    fireEvent.click(await screen.findByRole("button", { name: "장기 프로젝트 설정" }));
    fireEvent.click(screen.getByRole("button", { name: "아웃라인 확인" }));

    expect(onOpenSettings).toHaveBeenCalledWith("long_test");
    expect(onOpenOutline).toHaveBeenCalledWith("long_test");
  });

  it("calls onOpenGallery with the project ID when the 생성 이미지 모음 button is clicked", async () => {
    const project = makeLongProject({ id: "long_test" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    const onOpenGallery = vi.fn();
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} onOpenGallery={onOpenGallery} />);

    fireEvent.click(await screen.findByRole("button", { name: "생성 이미지 모음" }));

    expect(onOpenGallery).toHaveBeenCalledWith("long_test");
  });

  it("calls onBack when the list button is clicked", async () => {
    const project = makeLongProject({ id: "long_test" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    const onBack = vi.fn();
    render(<LongProjectDetail projectId="long_test" onBack={onBack} onOpenSettings={() => {}} onOpenOutline={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "목록으로" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("filters, selects, duplicates, and archives only after exact Episode confirmation", async () => {
    const project = makeLongProject({ id: "long_test", episodeCount: 2, episodes: [
      makeLongEpisodeOutline({ episodeNumber: 1, title: "Alpha", status: "planned" }),
      makeLongEpisodeOutline({ episodeNumber: 2, title: "Beta", status: "outline_ready" }),
    ] });
    const duplicated = makeLongProject({ ...project, episodeCount: 3, episodes: [...project.episodes, makeLongEpisodeOutline({ episodeNumber: 3, title: "Beta copy" })] });
    const archived = makeLongProject({ ...project, episodeCount: 1, episodes: [project.episodes[0]!] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { project: duplicated, episode: duplicated.episodes[2] }))
      .mockResolvedValueOnce(jsonResponse(200, { project: archived, archivedEpisodeNumber: 3, archiveId: "episode-archive" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} />);

    await screen.findByRole("button", { name: "1. Alpha" });
    fireEvent.change(screen.getByLabelText("Search episodes"), { target: { value: "Beta" } });
    expect(screen.queryByRole("button", { name: "1. Alpha" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search episodes"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "2. Beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate selected" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/long-projects/long_test/episodes/2/duplicate");

    fireEvent.click(screen.getByRole("button", { name: "3. Beta copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive selected" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText("Exact confirmation"), { target: { value: "ARCHIVE EPISODE 3" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).method).toBe("DELETE");
  });

  it("shows no resume button for a planned Episode with no script yet", async () => {
    const project = makeLongProject({ id: "long_test", episodes: [makeLongEpisodeOutline({ episodeNumber: 1, title: "Alpha", status: "planned" })] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} />);
    await screen.findByTestId("episode-1");
    expect(screen.queryByRole("button", { name: "대본 작성/편집" })).toBeNull();
  });

  it("resumes each Episode into the screen matching its current status", async () => {
    const cases: Array<{ status: LongEpisodeStatus; label: string; handler: "onOpenEpisodeScript" | "onOpenMappingReview" | "onOpenImageGeneration" | "onOpenVideoWorkflow" | "onOpenVideoMerge" | "onOpenContinuity" }> = [
      { status: "outline_ready", label: "대본 작성/편집", handler: "onOpenEpisodeScript" },
      { status: "script_review", label: "대본 작성/편집", handler: "onOpenEpisodeScript" },
      { status: "script_approved", label: "Asset Mapping 검토", handler: "onOpenMappingReview" },
      { status: "waiting_for_asset_mapping_review", label: "Asset Mapping 검토", handler: "onOpenMappingReview" },
      { status: "asset_mapping_approved", label: "이미지 생성/검토", handler: "onOpenImageGeneration" },
      { status: "images_review", label: "이미지 생성/검토", handler: "onOpenImageGeneration" },
      { status: "waiting_for_video_confirmation", label: "영상 생성/검토", handler: "onOpenVideoWorkflow" },
      { status: "interrupted", label: "영상 생성/검토", handler: "onOpenVideoWorkflow" },
      { status: "videos_approved", label: "최종 영상 병합", handler: "onOpenVideoMerge" },
      { status: "failed", label: "최종 영상 병합", handler: "onOpenVideoMerge" },
      { status: "completed", label: "Continuity Memory", handler: "onOpenContinuity" },
    ];
    for (const testCase of cases) {
      const project = makeLongProject({ id: "long_test", episodes: [makeLongEpisodeOutline({ episodeNumber: 1, title: "Alpha", status: testCase.status })] });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
      const handlers = { onOpenEpisodeScript: vi.fn(), onOpenMappingReview: vi.fn(), onOpenImageGeneration: vi.fn(), onOpenVideoWorkflow: vi.fn(), onOpenVideoMerge: vi.fn(), onOpenContinuity: vi.fn() };
      render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} {...handlers} />);
      await screen.findByTestId("episode-1");
      fireEvent.click(screen.getByRole("button", { name: testCase.label }));
      expect(handlers[testCase.handler]).toHaveBeenCalledWith("long_test", 1);
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("archives only after the exact title is entered, then returns to the long-project list", async () => {
    const project = makeLongProject({ id: "long_test", title: "Exact long title" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { project }))
      .mockResolvedValueOnce(jsonResponse(200, { archivedProjectId: project.id }));
    vi.stubGlobal("fetch", fetchMock);
    const onArchived = vi.fn();
    render(<LongProjectDetail projectId={project.id} onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} onArchived={onArchived} />);

    await screen.findByText(project.title);
    fireEvent.click(screen.getByRole("button", { name: "Archive project" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Exact confirmation"), { target: { value: "wrong" } });
    expect(screen.getByRole("button", { name: "Confirm archive" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Exact confirmation"), { target: { value: project.title } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
    await waitFor(() => expect(onArchived).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenLastCalledWith("/long-projects/long_test/archive", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: project.title }),
    });
  });
});
