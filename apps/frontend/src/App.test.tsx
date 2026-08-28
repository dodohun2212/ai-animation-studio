import type { CreateLongProjectRequest, CreateProjectRequest, LongProject, Project } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
        aspectRatio: "9:16",
        narrationAvailable: false,
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

    // The settings screen shown right after creation loads its own settings/cast/asset-reference/
    // continuity state independently — empty-but-valid defaults are enough for navigation tests.
    const settingsMatch = /^\/projects\/([^/]+)\/settings$/.exec(url);
    if (settingsMatch && method === "GET") {
      const project = projects.get(settingsMatch[1] as string);
      if (!project) return jsonResponse(404, { code: "PROJECT_NOT_FOUND", message: "프로젝트를 찾을 수 없습니다." });
      return jsonResponse(200, {
        settings: {
          projectName: project.id, topic: project.topic, genre: "미스터리", mood: "시네마틱", character: "", lore: "",
          fullStory: "", durationSeconds: 30, sceneCount: 6, clipDurationSeconds: 5, additionalNotes: "", styleNotes: { aspect: "16:9" },
          narrationEnabled: false, subtitlesEnabled: false,
        },
        sceneCountChangeable: true,
        aspectRatioChangeable: true,
      });
    }
    if (/^\/projects\/[^/]+\/settings\/cast$/.exec(url) && method === "GET") {
      return jsonResponse(200, { cast: [] });
    }
    if (/^\/projects\/[^/]+\/settings\/asset-references$/.exec(url) && method === "GET") {
      return jsonResponse(200, { atmosphereAssetIds: [], sceneReferenceAssets: [] });
    }
    if (/^\/projects\/[^/]+\/settings\/continuity$/.exec(url) && method === "GET") {
      return jsonResponse(200, { link: null });
    }

    throw new Error(`Unexpected fetch call in test: ${method} ${url}`);
  });
}

describe("App", () => {
  // The screen now lives in the address bar, and jsdom keeps one window for the whole file — so without this
  // each test would start wherever the previous one navigated to. Resetting the hash is what keeps every test
  // starting from the project list, the way they were all written.
  beforeEach(() => {
    window.location.hash = "";
  });

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
    fireEvent.change(screen.getByLabelText("폴더 이름 (영문·숫자)"), { target: { value: "sample_project" } });
    fireEvent.change(screen.getByLabelText("영상 주제"), { target: { value: "우주를 여행하는 고양이" } });
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 생성" }));

    // Successful creation lands on setup (cast/atmosphere/continuity) first, not the bare detail view.
    await screen.findByTestId("just-created-notice");
    fireEvent.click(screen.getByRole("button", { name: "설정 완료 · 계속 진행하기" }));

    // That hands off to the detail view for the same project.
    await screen.findByText("sample_project");
    expect(screen.getByText("우주를 여행하는 고양이")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "목록으로" }));

    // The list must have refreshed to include the project just created.
    const projectButton = await screen.findByRole("button", { name: /sample_project/ });
    const callsBeforeReopen = fetchMock.mock.calls.length;
    fireEvent.click(projectButton);

    // Reopening reads the project again rather than showing whatever was on screen before.
    //
    // This used to assert an exact total of two GETs. That number was never the point — it was a stand-in for
    // "reopening refetches" — and it broke the moment anything else on the page also needed the project (the
    // pipeline sidebar now reads it to show how far the project has got). Counting only what happens after
    // the click keeps the guarantee and stops the assertion from failing for unrelated reasons.
    await screen.findByText("sample_project");
    expect(screen.getByText("우주를 여행하는 고양이")).toBeTruthy();
    const reopenReads = fetchMock.mock.calls
      .slice(callsBeforeReopen)
      .filter(([url]) => String(url) === "/projects/sample_project");
    expect(reopenReads.length).toBeGreaterThan(0);
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

  it("keeps the main nav (단기/장기 프로젝트, 이미지 보관함, API 설정) reachable from a deep screen, not just the dashboard", async () => {
    const fetchMock = vi.fn<FakeFetch>(async (input) => {
      const requestUrl = String(input);
      if (requestUrl === "/projects") return jsonResponse(200, { projects: [] });
      if (requestUrl === "/assets") return jsonResponse(200, { assets: [] });
      if (requestUrl === "/long-projects") return jsonResponse(200, { projects: [] });
      throw new Error(`Unexpected fetch call in test: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await screen.findByText("아직 생성된 프로젝트가 없습니다.");
    fireEvent.click(screen.getByRole("button", { name: "이미지 보관함" }));
    await screen.findByText("등록된 에셋이 없습니다.");

    // From inside a screen several hops away from the dashboard, the same nav is still there.
    fireEvent.click(screen.getByRole("button", { name: "장기 프로젝트" }));
    await screen.findByText("아직 생성된 장기 프로젝트가 없습니다.");
    expect(screen.getByRole("button", { name: "단기 프로젝트" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "이미지 보관함" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "API 설정" })).toBeTruthy();
  });

  it("entering 이미지 보관함 issues only /assets, and back restores the project list without any provider route call", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "이미지 보관함" }));
    await screen.findByText("등록된 에셋이 없습니다.");

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/assets"]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/settings/providers"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "프로젝트 목록으로" }));
    expect(await screen.findByText("아직 생성된 프로젝트가 없습니다.")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/settings/providers"))).toBe(false);
  });

  it("reaches 영상 보관함 from the nav and asks only the library route", async () => {
    // The results archive is a sibling of the image library in the nav, not a screen buried inside one project —
    // past versions belong to no single project's flow, which is why they had no home before this.
    const fetchMock = vi.fn<FakeFetch>(async (input) => {
      const requestUrl = String(input);
      if (requestUrl === "/projects") return jsonResponse(200, { projects: [] });
      if (requestUrl === "/videos/library") return jsonResponse(200, { projects: [] });
      throw new Error(`Unexpected fetch call in test: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await screen.findByText("아직 생성된 프로젝트가 없습니다.");
    fetchMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "영상 보관함" }));
    await screen.findByTestId("library-empty");

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/videos/library"]);
    // Opening an archive must never touch a provider route — nothing here costs anything.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/settings/providers"))).toBe(false);
  });

  it("reaches 음원 보관함 from the nav and asks only the audio library route", async () => {
    const fetchMock = vi.fn<FakeFetch>(async (input) => {
      const requestUrl = String(input);
      if (requestUrl === "/projects") return jsonResponse(200, { projects: [] });
      if (requestUrl === "/audio/library") return jsonResponse(200, { tracks: [] });
      throw new Error(`Unexpected fetch call in test: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await screen.findByText("아직 생성된 프로젝트가 없습니다.");
    fetchMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "음원 보관함" }));
    await screen.findByTestId("audio-library-empty");

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/audio/library"]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/settings/providers"))).toBe(false);
  });

  it("reaches 게시물 준비 from the nav and asks only the library and publish-target routes until a video is picked", async () => {
    const fetchMock = vi.fn<FakeFetch>(async (input) => {
      const requestUrl = String(input);
      if (requestUrl === "/projects") return jsonResponse(200, { projects: [] });
      if (requestUrl === "/videos/library") return jsonResponse(200, { projects: [] });
      throw new Error(`Unexpected fetch call in test: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await screen.findByText("아직 생성된 프로젝트가 없습니다.");
    fetchMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "게시물 준비" }));
    await screen.findByTestId("post-empty");

    // Sorted so the two independent mount reads cannot make this fail on ordering alone. Still an exact set:
    // the point is that opening this screen reads the video list and the publish destinations and nothing else.
    expect(fetchMock.mock.calls.map(([url]) => String(url)).sort())
      .toEqual(["/settings/instagram/targets", "/videos/library"]);
    // Nothing on this screen publishes or authenticates — it must not reach a provider route either.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/settings/providers"))).toBe(false);
  });

  it("lights the pipeline from the project's own progress, and navigating does not change it", async () => {
    // The filled dots used to come from the screen being viewed, so clicking a step visually "un-finished"
    // everything after it — the list looked like progress but answered a different question.
    const project: Project = {
      id: "sample_project",
      topic: "우주를 여행하는 고양이",
      projectType: "short_project",
      workflowState: WorkflowState.WaitingForVideoConfirmation,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
      aspectRatio: "9:16",
      narrationAvailable: false,
      scenes: [],
      warnings: [],
      errors: [],
    };
    const fetchMock = vi.fn<FakeFetch>(async (input) => {
      const url = String(input).split("?")[0]!;
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
      if (url === "/projects/sample_project/settings") return jsonResponse(404, { code: "PROJECT_NOT_FOUND", message: "" });
      return jsonResponse(404, { code: "PROJECT_NOT_FOUND", message: "" });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /sample_project/ }));

    const stepStates = async () => {
      const nav = await screen.findByRole("navigation", { name: "단기 프로젝트 진행 단계" });
      return [...nav.querySelectorAll("button")].map((button) => button.getAttribute("data-step-state"));
    };

    // WAITING_FOR_VIDEO_CONFIRMATION: 대본·참고 이미지 연결·장면 이미지 done, 영상 보내기 전 확인 current.
    await waitFor(async () =>
      expect(await stepStates()).toEqual(["done", "done", "done", "current", "upcoming", "upcoming"]));

    fireEvent.click(screen.getByRole("button", { name: "참고 이미지 연결" }));
    await screen.findByText("등록된 참고 이미지 연결이 없습니다.");
    // Same lights after moving backwards through the list.
    expect(await stepStates()).toEqual(["done", "done", "done", "current", "upcoming", "upcoming"]);
  });

  it("opens 참고 이미지 연결 검토 from a project's detail view and returns to that same detail on back", async () => {
    const project: Project = {
      id: "sample_project",
      topic: "우주를 여행하는 고양이",
      projectType: "short_project",
      workflowState: WorkflowState.Ready,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
      aspectRatio: "9:16",
      narrationAvailable: false,
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
    // The detail screen no longer repeats pipeline steps as its own buttons — the progress bar owns them.
    fireEvent.click(await screen.findByRole("button", { name: "참고 이미지 연결" }));

    expect(await screen.findByText("등록된 참고 이미지 연결이 없습니다.")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/videos/"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/settings/providers"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "프로젝트로 돌아가기" }));
    expect(await screen.findByText("sample_project")).toBeTruthy();
    expect(screen.getByText("우주를 여행하는 고양이")).toBeTruthy();
  });

  it("opens 이미지 보관함 pre-searched with the project ID from a project's 생성 이미지 모음 button", async () => {
    const project: Project = {
      id: "sample_project", topic: "우주를 여행하는 고양이", projectType: "short_project", workflowState: WorkflowState.Ready,
      createdAt: "2026-08-21T00:00:00.000Z", updatedAt: "2026-08-21T00:00:00.000Z", aspectRatio: "9:16", narrationAvailable: false, scenes: [], warnings: [], errors: [],
    };
    const fetchMock = vi.fn<FakeFetch>(async (input) => {
      const url = String(input);
      if (url === "/projects") return jsonResponse(200, { projects: [project] });
      if (url === "/projects/sample_project") return jsonResponse(200, { project });
      if (url.startsWith("/assets")) return jsonResponse(200, { assets: [] });
      throw new Error(`Unexpected fetch call in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /sample_project/ }));
    fireEvent.click(await screen.findByRole("button", { name: "생성 이미지 모음" }));

    await screen.findByText("등록된 에셋이 없습니다.");
    const assetsCall = fetchMock.mock.calls.map(([url]) => String(url)).find((url) => url.startsWith("/assets"));
    expect(new URL(assetsCall!, "http://localhost").searchParams.get("query")).toBe("sample_project");
    expect((screen.getByLabelText("검색") as HTMLInputElement).value).toBe("sample_project");
  });

  it("opens the video workflow screen from a successful local video submission and shows live local fake progress", async () => {
    const project: Project = {
      id: "sample_project",
      topic: "우주를 여행하는 고양이",
      projectType: "short_project",
      workflowState: WorkflowState.WaitingForVideoConfirmation,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
      aspectRatio: "9:16",
      narrationAvailable: false,
      scenes: [],
      warnings: [],
      errors: [],
    };
    const previews = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({
      sceneNumber,
      prompt: `Scene ${sceneNumber} prompt`,
      model: "gen4_turbo",
      ratio: "720:1280",
      durationSeconds: 5,
      estimatedCostUsd: 0.25,
    }));
    const fetchMock = vi.fn<FakeFetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/projects" && method === "GET") return jsonResponse(200, { projects: [project] });
      if (url === "/projects/sample_project" && method === "GET") return jsonResponse(200, { project });
      if (url === "/projects/sample_project/videos/preview" && method === "POST") {
        return jsonResponse(200, { previews, confirmationId: "confirmation_1" });
      }
      if (url === "/projects/sample_project/videos/generations" && method === "POST") {
        return jsonResponse(200, { jobId: "job_42", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6] });
      }
      if (url === "/projects/sample_project/videos/generations/job_42") {
        return jsonResponse(200, {
          jobId: "job_42",
          status: "succeeded",
          completedSceneNumbers: [1, 2, 3, 4, 5, 6],
          failedSceneNumbers: [],
          sceneNumbers: [1, 2, 3, 4, 5, 6],
        });
      }
      if (url === "/projects/sample_project/videos/generations/job_42/review") {
        return jsonResponse(200, {
          project,
          reviews: [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" })),
        });
      }
      throw new Error(`Unexpected fetch call in test: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /sample_project/ }));
    fireEvent.click(await screen.findByRole("button", { name: "이어서 진행하기 · 영상 프롬프트 및 비용 확인" }));
    await screen.findByTestId("preview-list");

    fireEvent.click(screen.getByTestId("open-confirm-button"));
    fireEvent.click(screen.getByTestId("confirm-submit-button"));
    fireEvent.click(await screen.findByTestId("view-progress-button"));

    expect(await screen.findByTestId("scene-progress-list")).toBeTruthy();
    expect(screen.getByTestId("workflow-status").textContent).toBe("상태: 완료");
    for (const number of [1, 2, 3, 4, 5, 6]) {
      expect(screen.getByTestId(`scene-progress-${number}`)).toHaveAttribute("data-status", "completed");
    }
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/ffmpeg"))).toBe(false);
  });

  it("reaches the final merge screen only after all six video reviews are approved, and completes it via POST .../videos/merge", async () => {
    let project: Project = {
      id: "sample_project",
      topic: "우주를 여행하는 고양이",
      projectType: "short_project",
      workflowState: WorkflowState.WaitingForVideoConfirmation,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
      aspectRatio: "9:16",
      narrationAvailable: false,
      scenes: [],
      warnings: [],
      errors: [],
    };
    const previews = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({
      sceneNumber,
      prompt: `Scene ${sceneNumber} prompt`,
      model: "gen4_turbo",
      ratio: "720:1280",
      durationSeconds: 5,
      estimatedCostUsd: 0.25,
    }));
    const reviews = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: "pending", updatedAt: "2026-08-23T00:00:00.000Z" }));
    const fetchMock = vi.fn<FakeFetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/projects" && method === "GET") return jsonResponse(200, { projects: [project] });
      if (url === "/projects/sample_project" && method === "GET") return jsonResponse(200, { project });
      if (url === "/projects/sample_project/videos/preview" && method === "POST") {
        return jsonResponse(200, { previews, confirmationId: "confirmation_1" });
      }
      if (url === "/projects/sample_project/videos/generations" && method === "POST") {
        return jsonResponse(200, { jobId: "job_42", acceptedSceneNumbers: [1, 2, 3, 4, 5, 6] });
      }
      if (url === "/projects/sample_project/videos/generations/job_42" && method === "GET") {
        return jsonResponse(200, { jobId: "job_42", status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6], failedSceneNumbers: [], sceneNumbers: [1, 2, 3, 4, 5, 6] });
      }
      if (url === "/projects/sample_project/videos/generations/job_42/review" && method === "GET") {
        return jsonResponse(200, { project, reviews });
      }
      const approveMatch = /^\/projects\/sample_project\/videos\/generations\/job_42\/review\/(\d)\/approve$/.exec(url);
      if (approveMatch && method === "POST") {
        const sceneNumber = Number(approveMatch[1]);
        const index = reviews.findIndex((review) => review.sceneNumber === sceneNumber);
        reviews[index] = { ...reviews[index]!, status: "approved" };
        if (reviews.every((review) => review.status === "approved")) project = { ...project, workflowState: WorkflowState.VideosApproved };
        return jsonResponse(200, { project, reviews: [...reviews] });
      }
      if (url === "/projects/sample_project/videos/merge" && method === "POST") {
        project = { ...project, workflowState: WorkflowState.Completed };
        return jsonResponse(200, { project, finalVideoPath: "videos/final/instagram_reel.mp4" });
      }
      throw new Error(`Unexpected fetch call in test: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /sample_project/ }));
    fireEvent.click(await screen.findByRole("button", { name: "이어서 진행하기 · 영상 프롬프트 및 비용 확인" }));
    await screen.findByTestId("preview-list");
    fireEvent.click(screen.getByTestId("open-confirm-button"));
    fireEvent.click(screen.getByTestId("confirm-submit-button"));
    fireEvent.click(await screen.findByTestId("view-progress-button"));

    await screen.findByTestId("video-review-list");
    expect(screen.queryByTestId("open-video-merge-button")).toBeNull();
    for (const sceneNumber of [1, 2, 3, 4, 5, 6]) {
      const row = screen.getByTestId(`video-review-${sceneNumber}`);
      fireEvent.click(within(row).getByRole("button", { name: "이 영상으로 확정" }));
      await vi.waitFor(() => expect(row).toHaveAttribute("data-status", "approved"));
    }

    fireEvent.click(await screen.findByTestId("open-video-merge-button"));
    fireEvent.click(await screen.findByTestId("open-merge-confirm-button"));
    fireEvent.click(screen.getByTestId("confirm-merge-button"));

    await screen.findByTestId("merge-success");
    expect(screen.getByTestId("final-video-path").textContent).toBe("저장 위치: videos/final/instagram_reel.mp4");
    const [url, mergeInit] = fetchMock.mock.calls.find(([callUrl]) => String(callUrl) === "/projects/sample_project/videos/merge") as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/videos/merge");
    expect(mergeInit.method).toBe("POST");
  });

  it("navigates to 장기 프로젝트, creates one, reopens it from the list, and completes the two-step outline approval", async () => {
    const longProjects = new Map<string, LongProject>();
    const seed = {
      title: "우주 방랑자",
      logline: "떠도는 항해사가 고향 별을 되찾는다.",
    };
    const fetchMock = vi.fn<FakeFetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/projects" && method === "GET") return jsonResponse(200, { projects: [] });

      if (url === "/long-projects" && method === "POST") {
        const request = JSON.parse(String(init?.body)) as CreateLongProjectRequest;
        if (longProjects.has(request.projectId)) {
          return jsonResponse(409, { code: "LONG_PROJECT_ALREADY_EXISTS", message: "이미 존재하는 프로젝트입니다." });
        }
        const project: LongProject = {
          id: request.projectId,
          title: request.settings.title,
          logline: request.settings.logline,
          episodeCount: request.settings.episodeCount,
          outlineStatus: "planned",
          createdAt: "2026-08-23T00:00:00.000Z",
          updatedAt: "2026-08-23T00:00:00.000Z",
          settings: { ...request.settings, episodeDurationSeconds: request.settings.sceneCount * request.settings.clipDurationSeconds },
          storyBible: { basic: {}, world: {} },
          episodes: Array.from({ length: request.settings.episodeCount }, (_, index) => ({
            episodeNumber: index + 1,
            title: `Episode ${index + 1}`,
            summary: "",
            mainEvent: "",
            conflict: "",
            cliffhanger: "",
            nextEpisodeHook: "",
            status: "planned" as const,
          })),
        };
        longProjects.set(project.id, project);
        return jsonResponse(201, { project });
      }

      if (url === "/long-projects" && method === "GET") {
        return jsonResponse(200, {
          projects: Array.from(longProjects.values()).map((project) => ({
            id: project.id,
            title: project.title,
            logline: project.logline,
            episodeCount: project.episodeCount,
            outlineStatus: project.outlineStatus,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
          })),
        });
      }

      const getMatch = /^\/long-projects\/([^/]+)$/.exec(url);
      if (getMatch && method === "GET") {
        const project = longProjects.get(getMatch[1] as string);
        if (!project) return jsonResponse(404, { code: "LONG_PROJECT_NOT_FOUND", message: "찾을 수 없습니다." });
        return jsonResponse(200, { project });
      }

      const previewMatch = /^\/long-projects\/([^/]+)\/outline\/preview$/.exec(url);
      if (previewMatch && method === "POST") {
        const project = longProjects.get(previewMatch[1] as string);
        if (!project) return jsonResponse(404, { code: "LONG_PROJECT_NOT_FOUND", message: "찾을 수 없습니다." });
        const prompt = `[Long project outline]\nTitle: ${project.title}`;
        return jsonResponse(200, {
          preview: { projectId: project.id, prompt, promptSha256: "a".repeat(64), episodeCount: project.episodeCount },
        });
      }

      const approveMatch = /^\/long-projects\/([^/]+)\/outline\/approval$/.exec(url);
      if (approveMatch && method === "POST") {
        const project = longProjects.get(approveMatch[1] as string);
        if (!project) return jsonResponse(404, { code: "LONG_PROJECT_NOT_FOUND", message: "찾을 수 없습니다." });
        const updated: LongProject = {
          ...project,
          outlineStatus: "outline_ready",
          episodes: project.episodes.map((episode) => ({ ...episode, status: "outline_ready" as const })),
        };
        longProjects.set(project.id, updated);
        return jsonResponse(200, {
          project: updated,
          approvedAt: "2026-08-23T01:00:00.000Z",
          promptSha256: "a".repeat(64),
          modified: false,
        });
      }

      throw new Error(`Unexpected fetch call in test: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await screen.findByText("아직 생성된 프로젝트가 없습니다.");
    fireEvent.click(screen.getByRole("button", { name: "장기 프로젝트" }));
    await screen.findByText("아직 생성된 장기 프로젝트가 없습니다.");

    fireEvent.click(screen.getByRole("button", { name: "새 장기 프로젝트" }));
    fireEvent.change(screen.getByLabelText("폴더 이름 (영문·숫자)"), { target: { value: "long_test" } });
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: seed.title } });
    fireEvent.change(screen.getByLabelText("한 줄 줄거리"), { target: { value: seed.logline } });
    fireEvent.click(screen.getByRole("button", { name: "장기 프로젝트 생성" }));

    await screen.findByText(seed.title);
    expect(screen.getByText(seed.logline)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "목록으로" }));
    const projectButton = await screen.findByRole("button", { name: new RegExp(seed.title) });
    fireEvent.click(projectButton);
    await screen.findByText(seed.title);
    expect(fetchMock.mock.calls.filter(([callUrl]) => String(callUrl) === "/long-projects/long_test")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "스토리 개요 확인" }));
    await screen.findByDisplayValue(/Title: 우주 방랑자/);

    fireEvent.click(screen.getByRole("button", { name: "이 프롬프트로 승인" }));
    await screen.findByTestId("approve-confirm-panel");
    fireEvent.click(screen.getByRole("button", { name: "네, 승인합니다" }));

    await screen.findByTestId("approved-message");
    for (const number of [1, 2, 3]) {
      expect(screen.getByTestId(`episode-outline-${number}`)).toHaveAttribute("data-status", "outline_ready");
    }

    // The workspace nav jumps straight back to the project overview from Outline —
    // no need to know which screen originally opened Outline to get back.
    const callsBeforeJump = fetchMock.mock.calls.filter(([callUrl]) => String(callUrl) === "/long-projects/long_test").length;
    fireEvent.click(screen.getByRole("button", { name: "작품 한눈에 보기" }));
    await screen.findByText(seed.title);
    expect(fetchMock.mock.calls.filter(([callUrl]) => String(callUrl) === "/long-projects/long_test").length).toBe(callsBeforeJump + 1);
  });

  // The whole point, end to end: land on a working screen, and a reload comes back to it. Rendering a second
  // <App/> from the address the first one wrote is what a refresh is — the state is gone, the address is not.
  it("comes back to the same screen after a reload", async () => {
    vi.stubGlobal("fetch", createFakeBackend());
    const first = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "장기 프로젝트" }));
    await screen.findByRole("button", { name: "새 장기 프로젝트" });
    expect(window.location.hash).toBe("#/longList");

    first.unmount();
    render(<App />);
    expect(await screen.findByRole("button", { name: "새 장기 프로젝트" })).toBeTruthy();
  });

  it("opens the project list when the address points at nothing", async () => {
    // Bookmarks outlive the projects they name. A screen that fetches by an id it does not have renders its own
    // storage error, which reads as a broken app rather than a stale link.
    window.location.hash = "#/longEpisodeScript?projectId=gone";
    vi.stubGlobal("fetch", createFakeBackend());
    render(<App />);

    await screen.findByText("아직 생성된 프로젝트가 없습니다.");
  });
});
