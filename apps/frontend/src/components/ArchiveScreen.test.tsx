import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { ArchiveScreen } from "./ArchiveScreen.js";

const shortArchived = {
  id: "proj-1",
  topic: "판다 기사",
  projectType: "short_project",
  workflowState: "READY",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
  archivedAt: "2026-08-24T00:00:00.000Z",
};

const longArchived = {
  id: "long-1",
  title: "우주 방랑자",
  logline: "로그라인",
  episodeCount: 12,
  outlineStatus: "outline_ready",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
  archivedAt: "2026-08-24T12:00:00.000Z",
};

/** Routes each fetch call by "METHOD url"; an array value is consumed in order (last repeats). */
function stubFetchByRoute(routes: Record<string, unknown | unknown[]>, errorRoutes: Record<string, { status: number; body: unknown }> = {}): ReturnType<typeof vi.fn> {
  const queues = new Map<string, unknown[]>();
  for (const [key, value] of Object.entries(routes)) {
    queues.set(key, Array.isArray(value) ? [...value] : [value]);
  }
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const errorRoute = errorRoutes[key];
    if (errorRoute) return jsonResponse(errorRoute.status, errorRoute.body);
    const queue = queues.get(key);
    if (!queue || queue.length === 0) throw new Error(`Unexpected fetch call in test: ${key}`);
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return jsonResponse(200, body);
  });
}

describe("ArchiveScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists archived short and long projects with their archive timestamps", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({
      "GET /projects/archived": { projects: [shortArchived] },
      "GET /long-projects/archived": { projects: [longArchived] },
    }));
    render(<ArchiveScreen onBack={() => {}} />);

    const shortSection = await screen.findByRole("region", { name: "보관된 단편 프로젝트" });
    expect(within(shortSection).getByText("판다 기사")).toBeTruthy();
    expect(within(shortSection).getByTitle("2026-08-24T00:00:00.000Z").textContent).toContain(formatDateTime("2026-08-24T00:00:00.000Z"));
    const longSection = screen.getByRole("region", { name: "보관된 장기 프로젝트" });
    expect(within(longSection).getByText("우주 방랑자")).toBeTruthy();
    expect(within(longSection).getByText(/에피소드 12개/)).toBeTruthy();
  });

  it("restores a short project only after explicit confirmation, then refreshes and notifies", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/archived": [{ projects: [shortArchived] }, { projects: [] }],
      "GET /long-projects/archived": { projects: [] },
      "POST /projects/proj-1/restore": { restoredProjectId: "proj-1" },
    });
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    render(<ArchiveScreen onBack={() => {}} onChanged={onChanged} />);
    await screen.findByTestId("archived-short-proj-1");

    fireEvent.click(screen.getByTestId("archived-restore-proj-1"));
    // Opening the panel alone must not send anything.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/restore"))).toBe(false);
    const panel = await screen.findByTestId("archive-restore-confirm");
    expect(panel.textContent).toContain("판다 기사");
    fireEvent.click(within(panel).getByRole("button", { name: "복구하기" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/projects/proj-1/restore" && (init as RequestInit | undefined)?.method === "POST")).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("archived-short-proj-1")).toBeNull());
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("보관된 단편 프로젝트가 없습니다.")).toBeTruthy();
  });

  it("permanently deletes only after the exact confirmation text is typed, sending it in the DELETE body", async () => {
    const fetchMock = stubFetchByRoute({
      "GET /projects/archived": { projects: [] },
      "GET /long-projects/archived": [{ projects: [longArchived] }, { projects: [] }],
      "DELETE /long-projects/long-1/archive": { deletedProjectId: "long-1" },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ArchiveScreen onBack={() => {}} />);
    await screen.findByTestId("archived-long-long-1");

    fireEvent.click(screen.getByTestId("archived-delete-long-1"));
    const panel = await screen.findByTestId("archive-delete-confirm");
    const proceed = screen.getByTestId("archive-delete-proceed");
    expect(proceed).toBeDisabled();

    fireEvent.change(within(panel).getByLabelText("위 내용 그대로 입력"), { target: { value: "다른 텍스트" } });
    expect(proceed).toBeDisabled();
    fireEvent.change(within(panel).getByLabelText("위 내용 그대로 입력"), { target: { value: "우주 방랑자" } });
    expect(proceed).not.toBeDisabled();
    fireEvent.click(proceed);

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/long-projects/long-1/archive" && (init as RequestInit | undefined)?.method === "DELETE")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url, i]) => String(url) === "/long-projects/long-1/archive" && (i as RequestInit | undefined)?.method === "DELETE")! as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ confirmation: "우주 방랑자" });
    await waitFor(() => expect(screen.queryByTestId("archived-long-long-1")).toBeNull());
  });

  it("shows a fixed, safe message for a restore collision without leaking the raw backend text", async () => {
    const fetchMock = stubFetchByRoute(
      {
        "GET /projects/archived": { projects: [shortArchived] },
        "GET /long-projects/archived": { projects: [] },
      },
      { "POST /projects/proj-1/restore": { status: 409, body: { code: "PROJECT_RESTORE_COLLISION", message: "raw C:\\secret detail" } } },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ArchiveScreen onBack={() => {}} />);
    await screen.findByTestId("archived-short-proj-1");

    fireEvent.click(screen.getByTestId("archived-restore-proj-1"));
    const panel = await screen.findByTestId("archive-restore-confirm");
    fireEvent.click(within(panel).getByRole("button", { name: "복구하기" }));

    const alert = await screen.findByTestId("archive-action-error");
    expect(alert).toHaveAttribute("data-error-code", "PROJECT_RESTORE_COLLISION");
    expect(alert.textContent).not.toContain("raw C:\\secret detail");
    expect(alert.textContent).toContain("이미 있어 복구할 수 없습니다");
    // The archived entry is untouched on failure.
    expect(screen.getByTestId("archived-short-proj-1")).toBeTruthy();
  });

  it("calls onBack when the back button is clicked", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({
      "GET /projects/archived": { projects: [] },
      "GET /long-projects/archived": { projects: [] },
    }));
    const onBack = vi.fn();
    render(<ArchiveScreen onBack={onBack} />);
    await screen.findByText("보관된 단편 프로젝트가 없습니다.");

    fireEvent.click(screen.getByRole("button", { name: "프로젝트 목록으로" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
