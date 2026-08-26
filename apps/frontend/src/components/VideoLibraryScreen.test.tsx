import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { VideoLibraryScreen } from "./VideoLibraryScreen.js";

function libraryProject(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "1",
    topic: "이배드의 탄생",
    updatedAt: "2026-08-26T17:29:37.982Z",
    sceneCount: 6,
    videosReadyCount: 6,
    finalVideoAvailable: true,
    totalActualCostUsd: 1.5,
    aspectRatio: "9:16",
    ...overrides,
  };
}

function renderScreen(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return render(<VideoLibraryScreen onBack={() => {}} />);
}

describe("VideoLibraryScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists projects with their accumulated spend, and opens a scene's versions on expand", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { projects: [libraryProject()] }))
      .mockResolvedValueOnce(jsonResponse(200, { versions: [{ versionId: "v002", createdAt: "2026-08-26T17:18:30.000Z", bytes: 2103543, isCurrent: true }] }));
    renderScreen(fetchMock);

    expect((await screen.findByTestId("library-cost-1")).textContent).toContain("$1.50");
    fireEvent.click(screen.getByText("이배드의 탄생"));

    const current = await screen.findByTestId("version-v002");
    expect(current).toHaveAttribute("data-current", "true");
    // The one in use offers no restore button — restoring what is already current does nothing but confuse.
    expect(within(current).queryByTestId("version-restore-v002")).toBeNull();
  });

  it("offers the merged result as its own slot only when one exists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { projects: [libraryProject({ projectId: "2", topic: "미완성", finalVideoAvailable: false })] }))
      .mockResolvedValue(jsonResponse(200, { versions: [] }));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByText("미완성"));

    await screen.findByTestId("library-slot-2-1");
    expect(screen.queryByTestId("library-slot-2-final")).toBeNull();
  });

  // Restoring is free, but it changes which bytes the project serves from here on, so it must not happen on a
  // single click — and the panel has to say the two things a person would otherwise discover afterwards:
  // nothing is deleted, and an already-merged final video stops matching.
  it("asks before restoring, says nothing is deleted and that the merge goes stale, then re-reads the list", async () => {
    const before = [
      { versionId: "v001", createdAt: "2026-08-26T16:00:00.000Z", bytes: 1900000, isCurrent: false },
      { versionId: "v002", createdAt: "2026-08-26T17:18:30.000Z", bytes: 2103543, isCurrent: true },
    ];
    const after = [
      { versionId: "v001", createdAt: "2026-08-26T16:00:00.000Z", bytes: 1900000, isCurrent: true },
      { versionId: "v003", createdAt: "2026-08-26T18:00:00.000Z", bytes: 2103543, isCurrent: false },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { projects: [libraryProject()] }))
      .mockResolvedValueOnce(jsonResponse(200, { versions: before }))
      .mockResolvedValueOnce(jsonResponse(200, { project: { id: "1" } }))
      .mockResolvedValueOnce(jsonResponse(200, { versions: after }))
      .mockResolvedValueOnce(jsonResponse(200, { projects: [libraryProject()] }));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByText("이배드의 탄생"));
    fireEvent.click(await screen.findByTestId("version-restore-v001"));

    const panel = await screen.findByTestId("version-restore-confirm-v001");
    expect(panel.textContent).toContain("비용은 들지 않습니다");
    expect(panel.textContent).toContain("지워지지 않고");
    expect(panel.textContent).toContain("다시 합쳐야");

    fireEvent.click(within(panel).getByRole("button", { name: "예, 되돌립니다" }));

    // The displaced copy comes back as a new version — proof the server archived rather than overwrote, which is
    // only visible if the screen re-reads instead of patching isCurrent locally.
    await waitFor(() => expect(screen.getByTestId("version-v001")).toHaveAttribute("data-current", "true"));
    expect(screen.getByTestId("version-v003")).toBeTruthy();
  });

  it("does not warn about a stale merge when the merged result itself is what is being restored", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { projects: [libraryProject()] }))
      .mockResolvedValue(jsonResponse(200, {
        versions: [{ versionId: "f001", createdAt: "2026-08-26T17:29:00.000Z", bytes: 12989713, isCurrent: false }],
      }));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByText("이배드의 탄생"));
    fireEvent.click(await screen.findByTestId("library-slot-1-final"));
    fireEvent.click(await screen.findByTestId("version-restore-f001"));

    const panel = await screen.findByTestId("version-restore-confirm-f001");
    expect(panel.textContent).toContain("비용은 들지 않습니다");
    expect(panel.textContent).not.toContain("다시 합쳐야");
  });

  it("says the archive is empty rather than showing a bare page", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { projects: [] })));
    expect((await screen.findByTestId("library-empty")).textContent).toContain("아직 만들어진 영상이 없습니다");
  });

  it("distinguishes an empty archive from a search that matched nothing", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { projects: [libraryProject()] })));

    fireEvent.change(await screen.findByTestId("library-search"), { target: { value: "없는주제" } });

    expect(screen.getByTestId("library-no-match")).toBeTruthy();
    expect(screen.queryByTestId("library-empty")).toBeNull();
  });

  it("shows a load failure with its code and offers a retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { code: "VIDEO_STORAGE_ERROR", message: "raw backend detail" }))
      .mockResolvedValueOnce(jsonResponse(200, { projects: [libraryProject()] }));
    renderScreen(fetchMock);

    const error = await screen.findByTestId("library-error");
    expect(error).toHaveAttribute("data-error-code", "VIDEO_STORAGE_ERROR");
    expect(error.textContent).not.toContain("raw backend detail");

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByTestId("library-project-1")).toBeTruthy();
  });

  // The merge screen's reader made the video seconds ago; this list's reader is the one coming back months
  // later to finally publish it — the one who has forgotten what the licence asks for.
  it("shows the credit line a project's video owes, on the card itself", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, {
      projects: [libraryProject({ attributionRequired: true, attributionText: "Music by ○○○ (CC BY 4.0)" })],
    })));

    const credit = await screen.findByTestId("library-credit-1");
    expect(credit.textContent).toContain("Music by ○○○ (CC BY 4.0)");
  });

  it("says nothing about credit for a project that owes none", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { projects: [libraryProject()] })));
    await screen.findByTestId("library-cost-1");
    expect(screen.queryByTestId("library-credit-1")).toBeNull();
  });

  it("points at the audio library when credit is required but the sentence is blank", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { projects: [libraryProject({ attributionRequired: true })] })));
    expect((await screen.findByTestId("library-credit-1")).textContent).toContain("음원 보관함");
  });

  // Versions are per file, but which audio a merge used is stored once per project — so after a restore the app
  // cannot say what this older file carried. Showing the last merge's line would be worse than showing none,
  // so the warning goes where the person can still act on it: before they press restore.
  it("warns before restoring that the credit line will no longer be known", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        projects: [libraryProject({ attributionRequired: true, attributionText: "Music by ○○○" })],
      }))
      .mockResolvedValue(jsonResponse(200, {
        versions: [
          { versionId: "v002", createdAt: "2026-08-26T17:18:30.000Z", bytes: 2103543, isCurrent: true },
          { versionId: "v001", createdAt: "2026-08-26T16:02:10.000Z", bytes: 2011002, isCurrent: false },
        ],
      }));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByText("이배드의 탄생"));
    fireEvent.click(await screen.findByTestId("version-restore-v001"));

    const warning = await screen.findByTestId("version-restore-credit-warning-v001");
    expect(warning.textContent).toContain("더 이상 알 수 없습니다");
    expect(warning.textContent).toContain("Music by ○○○");
  });
});
