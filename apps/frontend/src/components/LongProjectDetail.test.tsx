import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LongEpisodeStatus } from "@ai-animation-studio/shared";

import { jsonResponse, makeLongEpisodeOutline, makeLongProject, makeLongProjectSettings } from "../api/testUtils.js";
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

  // Regression: an episode whose generation was interrupted gets put back a step so it can be retried. Without
  // the sentence explaining that, the person finds the episode somewhere they did not leave it and assumes they
  // broke something — short projects already learned this once.
  it("shows an interrupted episode's explanation on its own row, and leaves untouched episodes unmarked", async () => {
    const project = makeLongProject({
      id: "long_test",
      episodes: [
        makeLongEpisodeOutline({
          episodeNumber: 1,
          status: "planned",
          warnings: ["이전에 영상을 만들다가 서버가 꺼져서 중간에 멈췄습니다. 이미 만들어진 것은 그대로 있고, 이어서 다시 만들 수 있습니다."],
        }),
        makeLongEpisodeOutline({ episodeNumber: 2, status: "planned" }),
      ],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} />);

    const warning = await screen.findByTestId("episode-warning-1");
    expect(warning.textContent).toContain("서버가 꺼져서");
    // Plain language only — a state name here would tell the reader nothing they can act on.
    expect(warning.textContent).not.toContain("_");
    expect(screen.queryByTestId("episode-warning-2")).toBeNull();
  });

  it("says why archiving is unavailable instead of leaving a dead button", async () => {
    // Only the last Episode can be archived. Before this, picking Episode 1 of 3 just disabled the button with
    // no explanation — the user clicks, nothing happens, and reports that archiving is broken. The reason has
    // to be on screen, and it has to name which Episode is actually selected.
    const project = makeLongProject({
      id: "long_test",
      episodes: [
        makeLongEpisodeOutline({ episodeNumber: 1, status: "planned" }),
        makeLongEpisodeOutline({ episodeNumber: 2, status: "planned" }),
        makeLongEpisodeOutline({ episodeNumber: 3, status: "planned" }),
      ],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} />);

    // Nothing selected yet: the hint says to select one, not that archiving is impossible.
    expect((await screen.findByTestId("episode-archive-hint")).textContent).toContain("먼저 선택해");

    fireEvent.click(within(screen.getByTestId("episode-1")).getByRole("button", { name: /1\./ }));
    const hint = screen.getByTestId("episode-archive-hint");
    expect(hint.textContent).toContain("마지막 회차(3화)만");
    expect(hint.textContent).toContain("1화입니다");

    fireEvent.click(within(screen.getByTestId("episode-3")).getByRole("button", { name: /3\./ }));
    // Last Episode selected — the obstacle is gone, so the hint goes away rather than staying as noise.
    expect(screen.queryByTestId("episode-archive-hint")).toBeNull();
  });

  it("names the duplicate button by what it does, since it adds an Episode", async () => {
    // Reported as "I pressed delete and it added an episode". There is no delete button — the three are
    // create / duplicate / archive — and 복제 adds one. The label now says so on its face.
    const project = makeLongProject({ id: "long_test", episodes: [makeLongEpisodeOutline({ episodeNumber: 1, status: "planned" })] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} />);

    expect(await screen.findByRole("button", { name: "선택한 에피소드 복제(하나 더 만들기)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /삭제/ })).toBeNull();
  });

  it("counts Episodes per stage cumulatively, so the numbers never go backwards as work progresses", async () => {
    // Python kept this panel permanently on the long-project screen. The counts are cumulative on purpose: an
    // Episode whose videos are approved has also finished its script, so it counts toward 대본 완료 too.
    // Counting only the current stage would make 대본 완료 drop from 3 to 1 as Episodes move on, which reads
    // as regression. With twenty Episodes this panel replaces scrolling the list and counting by eye.
    const project = makeLongProject({
      id: "long_test",
      episodes: [
        makeLongEpisodeOutline({ episodeNumber: 1, status: "videos_approved" }),
        makeLongEpisodeOutline({ episodeNumber: 2, status: "waiting_for_video_confirmation" }),
        makeLongEpisodeOutline({ episodeNumber: 3, status: "script_review" }),
        makeLongEpisodeOutline({ episodeNumber: 4, status: "planned" }),
      ],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} />);

    const panel = await screen.findByTestId("episode-stage-summary");
    const row = (label: string) => within(panel).getByTestId(`episode-stage-${label}`).textContent ?? "";
    expect(row("전체 에피소드")).toContain("4");
    // 1·2·3 are past the outline; only the planned one is not.
    expect(row("개요 완료")).toContain("3");
    // script_review is still being written, so it does not count as finished.
    expect(row("대본 완료")).toContain("2");
    expect(row("이미지 완료")).toContain("2");
    expect(row("영상 생성 확인 대기")).toContain("1");
    expect(row("프로젝트 완료")).toContain("0");
  });

  it("offers narration only for Episodes that have a script, and only when the project uses the sentences", async () => {
    // Narration is a side channel, not a step in the fixed flow, so it sits next to the resume link instead of
    // replacing it. An Episode with no script has nothing to narrate — the backend answers
    // LONG_EPISODE_NARRATION_NOT_ALLOWED there, so offering the link would be offering a guaranteed failure.
    const open = vi.fn();
    const project = makeLongProject({
      id: "long_test",
      settings: makeLongProjectSettings({ narrationEnabled: true, subtitlesEnabled: false }),
      episodes: [
        makeLongEpisodeOutline({ episodeNumber: 1, title: "1화", status: "script_review" }),
        makeLongEpisodeOutline({ episodeNumber: 2, title: "2화", status: "planned" }),
        makeLongEpisodeOutline({ episodeNumber: 3, title: "3화", status: "outline_ready" }),
      ],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} onOpenNarrationReview={open} />);

    fireEvent.click(await screen.findByTestId("open-episode-narration-1"));
    expect(open).toHaveBeenCalledWith("long_test", 1);
    expect(screen.queryByTestId("open-episode-narration-2")).toBeNull();
    expect(screen.queryByTestId("open-episode-narration-3")).toBeNull();
    // The short project's link to the same screen says this, and one destination should not have two names.
    // Asserted on the text rather than the testid because the testid is not what a person reads.
    expect(screen.getByTestId("open-episode-narration-1").textContent).toBe("내레이션 확인");
  });

  it("hides narration entirely while both voice and subtitles are off", async () => {
    // With both off the sentences are stored but never reach the video, so a link to them would invite
    // someone to review something that will not be used. Turning either on in settings brings it back.
    const project = makeLongProject({
      id: "long_test",
      settings: makeLongProjectSettings({ narrationEnabled: false, subtitlesEnabled: false }),
      episodes: [makeLongEpisodeOutline({ episodeNumber: 1, title: "1화", status: "script_review" })],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    // onOpenEpisodeScript is passed because the resume link for a script-stage Episode is only offered when a
    // handler exists — without it this test would "pass" against a screen that rendered nothing at all.
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} onOpenEpisodeScript={() => {}} onOpenNarrationReview={() => {}} />);

    await screen.findByTestId("episode-1");
    expect(screen.queryByTestId("open-episode-narration-1")).toBeNull();
    // The Episode itself is still reachable — only the narration link is gone.
    expect(screen.getByText("대본 작성/편집")).toBeTruthy();
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

  it("gives a planned Episode somewhere to go — its plan — instead of no link at all", async () => {
    const onOpenEpisodeOutline = vi.fn();
    const project = makeLongProject({ id: "long_test", episodes: [makeLongEpisodeOutline({ episodeNumber: 1, title: "1화", status: "planned" })] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} onOpenEpisodeOutline={onOpenEpisodeOutline} />);

    fireEvent.click(await screen.findByRole("button", { name: "이 회차 내용 적기" }));
    expect(onOpenEpisodeOutline).toHaveBeenCalledWith("long_test", 1);
  });

  it("keeps the plan reachable once an Episode is outline_ready, alongside the link on to the script", async () => {
    const onOpenEpisodeOutline = vi.fn();
    const project = makeLongProject({ id: "long_test", episodes: [makeLongEpisodeOutline({ episodeNumber: 1, title: "1화", status: "outline_ready" })] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} onOpenEpisodeOutline={onOpenEpisodeOutline} onOpenEpisodeScript={() => {}} />);

    fireEvent.click(await screen.findByTestId("open-episode-outline-1"));
    expect(onOpenEpisodeOutline).toHaveBeenCalledWith("long_test", 1);
    // The script link is still the forward step; the plan link sits next to it, not instead of it.
    expect(screen.getByRole("button", { name: "대본 작성/편집" })).toBeTruthy();
  });

  it("stops offering the plan once the Episode has moved past the editable window", async () => {
    const project = makeLongProject({ id: "long_test", episodes: [makeLongEpisodeOutline({ episodeNumber: 1, title: "1화", status: "script_approved" })] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project })));
    render(<LongProjectDetail projectId="long_test" onBack={() => {}} onOpenSettings={() => {}} onOpenOutline={() => {}} onOpenEpisodeOutline={() => {}} onOpenMappingReview={() => {}} />);

    await screen.findByTestId("episode-1");
    expect(screen.queryByTestId("open-episode-outline-1")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "스토리 개요 확인" }));

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
    fireEvent.change(screen.getByLabelText("에피소드 검색"), { target: { value: "Beta" } });
    expect(screen.queryByRole("button", { name: "1. Alpha" })).toBeNull();
    fireEvent.change(screen.getByLabelText("에피소드 검색"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "2. Beta" }));
    fireEvent.click(screen.getByRole("button", { name: "선택한 에피소드 복제(하나 더 만들기)" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/long-projects/long_test/episodes/2/duplicate");

    fireEvent.click(screen.getByRole("button", { name: "3. Beta copy" }));
    fireEvent.click(screen.getByRole("button", { name: "선택한 에피소드 보관하기" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText(/회차 번호/), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "보관함으로 옮기기" }));
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
      { status: "script_approved", label: "참고 이미지 연결 검토", handler: "onOpenMappingReview" },
      { status: "waiting_for_asset_mapping_review", label: "참고 이미지 연결 검토", handler: "onOpenMappingReview" },
      { status: "asset_mapping_approved", label: "이미지 생성/검토", handler: "onOpenImageGeneration" },
      { status: "images_review", label: "이미지 생성/검토", handler: "onOpenImageGeneration" },
      { status: "waiting_for_video_confirmation", label: "영상 생성/검토", handler: "onOpenVideoWorkflow" },
      { status: "interrupted", label: "영상 생성/검토", handler: "onOpenVideoWorkflow" },
      { status: "videos_approved", label: "최종 영상 병합", handler: "onOpenVideoMerge" },
      { status: "failed", label: "최종 영상 병합", handler: "onOpenVideoMerge" },
      { status: "completed", label: "이어쓰기 메모", handler: "onOpenContinuity" },
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
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 보관하기" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("위 내용 그대로 입력"), { target: { value: "wrong" } });
    expect(screen.getByRole("button", { name: "보관하기" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("위 내용 그대로 입력"), { target: { value: project.title } });
    fireEvent.click(screen.getByRole("button", { name: "보관하기" }));
    await waitFor(() => expect(onArchived).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenLastCalledWith("/long-projects/long_test/archive", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: project.title }),
    });
  });
});
