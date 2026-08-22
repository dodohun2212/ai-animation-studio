import type { CreateProjectRequest, Project } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import { jsonResponse } from "./api/testUtils.js";

type FakeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** A tiny in-memory fake of the local Backend's /projects contract — no real network call. */
function createFakeBackend(): ReturnType<typeof vi.fn<FakeFetch>> {
  const projects = new Map<string, Project>();
  return vi.fn<FakeFetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url === "/projects" && method === "POST") {
      const request = JSON.parse(String(init?.body)) as CreateProjectRequest;
      if (projects.has(request.projectId)) {
        return jsonResponse(409, { code: "PROJECT_ALREADY_EXISTS", message: "이미 존재하는 프로젝트입니다." });
      }
      const project: Project = {
        id: request.projectId,
        topic: request.topic,
        projectType: "short_project",
        workflowState: WorkflowState.Ready,
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
        scenes: [],
        warnings: [],
        errors: [],
      };
      projects.set(project.id, project);
      return jsonResponse(201, { project });
    }

    if (url === "/projects" && method === "GET") {
      return jsonResponse(200, { projects: Array.from(projects.values()) });
    }

    const match = /^\/projects\/([^/]+)$/.exec(url);
    if (match && method === "GET") {
      const project = projects.get(match[1] as string);
      if (!project) {
        return jsonResponse(404, { code: "PROJECT_NOT_FOUND", message: "프로젝트를 찾을 수 없습니다." });
      }
      return jsonResponse(200, { project });
    }

    throw new Error(`Unexpected fetch call in test: ${method} ${url}`);
  });
}

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the studio name", async () => {
    vi.stubGlobal("fetch", createFakeBackend());
    render(<App />);
    expect(screen.getByRole("heading", { name: "AI Animation Studio" })).toBeTruthy();
    await screen.findByText("아직 생성된 프로젝트가 없습니다.");
  });

  it("creates a project, refreshes the list, and reopens it — all through mocked fetch, no real network", async () => {
    const fetchMock = createFakeBackend();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await screen.findByText("아직 생성된 프로젝트가 없습니다.");

    fireEvent.click(screen.getByRole("button", { name: "새 프로젝트" }));
    fireEvent.change(screen.getByLabelText("프로젝트 ID"), { target: { value: "sample_project" } });
    fireEvent.change(screen.getByLabelText("영상 주제"), { target: { value: "우주를 여행하는 고양이" } });
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 생성" }));

    // Successful creation opens the reopened detail view immediately.
    await screen.findByText("sample_project");
    expect(screen.getByText("우주를 여행하는 고양이")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "목록으로" }));

    // The list must have refreshed to include the project just created.
    const projectButton = await screen.findByRole("button", { name: /sample_project/ });
    fireEvent.click(projectButton);

    // Reopening goes through GET /projects/:projectId again — once right
    // after creation, once more when explicitly reopened from the list.
    await screen.findByText("sample_project");
    expect(screen.getByText("우주를 여행하는 고양이")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/projects/sample_project")).toHaveLength(2);
  });

  it("re-fetches GET /projects on a freshly rendered App instance and shows a project the Backend already knows about", async () => {
    const fetchMock = createFakeBackend();
    vi.stubGlobal("fetch", fetchMock);

    // Seed the fake Backend directly, simulating a project created in an earlier session/process.
    await fetchMock("/projects", {
      method: "POST",
      body: JSON.stringify({ projectId: "existing_project", topic: "이전 세션 프로젝트" }),
    });
    fetchMock.mockClear();

    render(<App />);

    expect(fetchMock).toHaveBeenCalledWith("/projects");
    expect(await screen.findByRole("button", { name: /existing_project/ })).toBeTruthy();
  });

  it("navigates to API 설정 and back without breaking the project list screen", async () => {
    const fetchMock = vi.fn<FakeFetch>(async (input) => {
      const requestUrl = String(input);
      if (requestUrl === "/projects") {
        return jsonResponse(200, { projects: [] });
      }
      if (requestUrl === "/settings/providers") {
        return jsonResponse(200, {
          providers: [
            { provider: "openai", configured: false, connected: false, maskedValue: null },
            { provider: "runway", configured: false, connected: false, maskedValue: null },
          ],
        });
      }
      throw new Error(`Unexpected fetch call in test: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await screen.findByText("아직 생성된 프로젝트가 없습니다.");
    fireEvent.click(screen.getByRole("button", { name: "API 설정" }));

    expect(await screen.findByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("Runway")).toBeTruthy();
    expect(screen.queryByText("userId")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "목록으로" }));
    expect(await screen.findByText("아직 생성된 프로젝트가 없습니다.")).toBeTruthy();
  });

  it("entering Asset Library issues only /assets, and back restores the project list without any provider route call", async () => {
    const fetchMock = vi.fn<FakeFetch>(async (input) => {
      const requestUrl = String(input);
      if (requestUrl === "/projects") return jsonResponse(200, { projects: [] });
      if (requestUrl === "/assets") return jsonResponse(200, { assets: [] });
      throw new Error(`Unexpected fetch call in test: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await screen.findByText("아직 생성된 프로젝트가 없습니다.");
    fetchMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Asset Library" }));
    await screen.findByText("등록된 에셋이 없습니다.");

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/assets"]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/settings/providers"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "프로젝트 목록으로" }));
    expect(await screen.findByText("아직 생성된 프로젝트가 없습니다.")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/settings/providers"))).toBe(false);
  });

  it("opens Asset Mapping 검토 from a project's detail view and returns to that same detail on back", async () => {
    const project: Project = {
      id: "sample_project",
      topic: "우주를 여행하는 고양이",
      projectType: "short_project",
      workflowState: WorkflowState.Ready,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
      scenes: [],
      warnings: [],
      errors: [],
    };
    const fetchMock = vi.fn<FakeFetch>(async (input) => {
      const url = String(input);
      if (url === "/projects") return jsonResponse(200, { projects: [project] });
      if (url === "/projects/sample_project") return jsonResponse(200, { project });
      if (url === "/projects/sample_project/assets/mappings") return jsonResponse(200, { mappings: [] });
      if (url === "/projects/sample_project/assets/mapping-review") {
        return jsonResponse(200, {
          review: {
            projectId: "sample_project", mappingRevision: 0, scriptRevision: 0, scriptFingerprint: "",
            status: "waiting", approvedAt: null, approvedBy: null, textOnlyConfirmed: false, legacyConfirmed: false, reviewedScenes: [],
          },
        });
      }
      throw new Error(`Unexpected fetch call in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /sample_project/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Asset Mapping 검토" }));

    expect(await screen.findByText("등록된 Asset Mapping이 없습니다.")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/videos/"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/settings/providers"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "프로젝트로 돌아가기" }));
    expect(await screen.findByText("sample_project")).toBeTruthy();
    expect(screen.getByText("우주를 여행하는 고양이")).toBeTruthy();
  });
});
