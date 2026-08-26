import type { ListProjectsResponse } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createProject, getProject, getProjectSettings, listProjects, ProjectsApiError, toDisplayError, updateProjectSettings } from "./projectsApi.js";
import { jsonResponse, makeProject, nonJsonResponse } from "./testUtils.js";

describe("projectsApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a project via POST /projects without calling a real network", async () => {
    const project = makeProject();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { project }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createProject({ projectId: project.id, topic: project.topic });

    expect(result).toEqual({ project });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ projectId: project.id, topic: project.topic });
    // The local single-user contract: no userId anywhere in the request body.
    expect(JSON.parse(String(init.body))).not.toHaveProperty("userId");
  });

  it("lists projects via GET /projects", async () => {
    const responseBody: ListProjectsResponse = { projects: [makeProject()] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responseBody));
    vi.stubGlobal("fetch", fetchMock);

    expect(await listProjects()).toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledWith("/projects");
  });

  it("reopens a project via GET /projects/:projectId", async () => {
    const project = makeProject({ id: "reopen_me" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getProject("reopen_me")).toEqual({ project });
    expect(fetchMock).toHaveBeenCalledWith("/projects/reopen_me");
  });

  it("gets and updates only the documented short-project Wizard settings routes", async () => {
    const settings = {
      projectName: "별의 지도", topic: "별을 찾는 아이", genre: "판타지", mood: "따뜻함", character: "아이",
      lore: "별의 세계", fullStory: "별을 찾는다.", durationSeconds: 30, sceneCount: 6 as const, clipDurationSeconds: 5 as const,
      additionalNotes: "", styleNotes: { aspect: "16:9" }, narrationEnabled: false, subtitlesEnabled: false,
    };
    const project = makeProject({ topic: settings.topic });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { settings }))
      .mockResolvedValueOnce(jsonResponse(200, { project, settings }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getProjectSettings("reopen_me")).resolves.toEqual({ settings });
    await expect(updateProjectSettings("reopen_me", { settings })).resolves.toEqual({ project, settings });
    expect(fetchMock.mock.calls[0]).toEqual(["/projects/reopen_me/settings"]);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/projects/reopen_me/settings");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ settings });
    expect(JSON.stringify(init.body)).not.toContain("userId");
  });

  it("rejects malformed Wizard settings responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { settings: { sceneCount: 5 } })));
    await expect(getProjectSettings("sample_project")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  describe.each([
    "INVALID_REQUEST",
    "UNSAFE_PROJECT_ID",
    "PROJECT_ALREADY_EXISTS",
    "PROJECT_NOT_FOUND",
    "PROJECT_JSON_MALFORMED",
    "PROJECT_DATA_INVALID",
    "PROJECT_STORAGE_ERROR",
  ])("Backend error code %s", (code) => {
    it("is preserved verbatim on the thrown ProjectsApiError", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code, message: `${code} 메시지` })));

      await expect(getProject("some_id")).rejects.toMatchObject({ code, message: `${code} 메시지` });
    });
  });

  it("converts a JSON-parse failure on a success response into a safe ProjectsApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(200)));

    const error = await listProjects().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProjectsApiError);
    expect((error as ProjectsApiError).code).toBe("CLIENT_MALFORMED_RESPONSE");
    expect((error as ProjectsApiError).message.length).toBeGreaterThan(0);
  });

  it("converts a success response with the wrong shape into a safe ProjectsApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { projects: "not-an-array" })));

    await expect(listProjects()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("converts a success response missing required project fields into a safe ProjectsApiError", async () => {
    const incompleteProject = { id: "sample_project" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { project: incompleteProject })));

    await expect(getProject("sample_project")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("reports a 5xx with no backend error shape as the server being unavailable, not as an unreadable response", async () => {
    // A restarting backend, a crashed one, or a dev proxy answering in its place. Calling that "서버 응답을
    // 해석하지 못했습니다" sent people looking for a data problem when the server simply was not there.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(500)));

    const error = await listProjects().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProjectsApiError);
    expect((error as ProjectsApiError).code).toBe("CLIENT_SERVER_UNAVAILABLE");
    expect(toDisplayError(error).message).toContain("재시작");
  });

  it("still calls a 4xx with no backend error shape an unreadable response — the server did answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(404)));

    const error = await listProjects().catch((caught: unknown) => caught);
    expect((error as ProjectsApiError).code).toBe("CLIENT_MALFORMED_RESPONSE");
  });

  it("converts an error response missing code/message into a safe ProjectsApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { oops: true })));

    const error = await listProjects().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProjectsApiError);
    expect(typeof (error as ProjectsApiError).code).toBe("string");
    expect((error as ProjectsApiError).code.length).toBeGreaterThan(0);
    expect(typeof (error as ProjectsApiError).message).toBe("string");
    expect((error as ProjectsApiError).message.length).toBeGreaterThan(0);
  });

  it("converts fetch() itself throwing (network failure) into a safe ProjectsApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const error = await listProjects().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProjectsApiError);
    expect((error as ProjectsApiError).code).toBe("CLIENT_NETWORK_ERROR");
  });

  it("never leaks local paths or raw response bodies into the error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(500, { stack: "at C:\\Users\\secret\\project\\file.ts:42", oops: true }),
      ),
    );

    const error = (await listProjects().catch((caught: unknown) => caught)) as ProjectsApiError;
    expect(error.message).not.toContain("C:\\");
    expect(error.message).not.toContain("secret");
  });

  describe("toDisplayError", () => {
    it("passes through a ProjectsApiError's code and message", () => {
      const error = new ProjectsApiError("PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
      expect(toDisplayError(error)).toEqual({ code: "PROJECT_NOT_FOUND", message: "프로젝트를 찾을 수 없습니다." });
    });

    it("falls back to a safe generic code/message for an unexpected error", () => {
      const result = toDisplayError(new Error("some internal detail"));
      expect(typeof result.code).toBe("string");
      expect(result.code.length).toBeGreaterThan(0);
      expect(result.message).not.toContain("some internal detail");
    });
  });
});
