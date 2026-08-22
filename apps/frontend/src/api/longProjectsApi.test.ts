import type { ListLongProjectsResponse } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  approveLongProjectOutline,
  createLongProject,
  createLongProjectOutlinePreview,
  getLongProject,
  getLongProjectSettings,
  listLongProjects,
  LongProjectsApiError,
  toLongProjectDisplayError,
  updateLongProjectSettings,
} from "./longProjectsApi.js";
import { jsonResponse, makeLongProject, makeLongProjectSettings, makeLongProjectSummary, nonJsonResponse } from "./testUtils.js";

describe("longProjectsApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a long project via POST /long-projects without calling a real network", async () => {
    const project = makeLongProject();
    const settings = makeLongProjectSettings();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { project }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createLongProject({ projectId: project.id, settings });

    expect(result).toEqual({ project });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/long-projects");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ projectId: project.id, settings });
  });

  it("lists long projects via GET /long-projects", async () => {
    const responseBody: ListLongProjectsResponse = { projects: [makeLongProjectSummary()] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responseBody));
    vi.stubGlobal("fetch", fetchMock);

    expect(await listLongProjects()).toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledWith("/long-projects");
  });

  it("reopens a long project via GET /long-projects/:projectId", async () => {
    const project = makeLongProject({ id: "reopen_me" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getLongProject("reopen_me")).toEqual({ project });
    expect(fetchMock).toHaveBeenCalledWith("/long-projects/reopen_me");
  });

  it("gets and updates settings via the documented settings route", async () => {
    const settings = makeLongProjectSettings();
    const project = makeLongProject({ settings });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { settings }))
      .mockResolvedValueOnce(jsonResponse(200, { project }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLongProjectSettings("reopen_me")).resolves.toEqual({ settings });
    await expect(updateLongProjectSettings("reopen_me", { settings })).resolves.toEqual({ project });
    expect(fetchMock.mock.calls[0]).toEqual(["/long-projects/reopen_me/settings"]);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/long-projects/reopen_me/settings");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ settings });
  });

  it("previews the outline via POST /long-projects/:projectId/outline/preview with no body", async () => {
    const preview = { projectId: "reopen_me", prompt: "outline prompt text", promptSha256: "a".repeat(64), episodeCount: 3 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { preview }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await createLongProjectOutlinePreview("reopen_me")).toEqual({ preview });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/long-projects/reopen_me/outline/preview");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("approves the outline via POST /long-projects/:projectId/outline/approval with an explicit approved:true body", async () => {
    const project = makeLongProject({ id: "reopen_me", outlineStatus: "outline_ready" });
    const response = { project, approvedAt: "2026-08-23T00:00:00.000Z", promptSha256: "b".repeat(64), modified: true };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    const body = { promptSha256: "a".repeat(64), prompt: "edited outline prompt", approved: true as const };
    expect(await approveLongProjectOutline("reopen_me", body)).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/long-projects/reopen_me/outline/approval");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(body);
  });

  it("rejects malformed settings responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { settings: { title: "x" } })));
    await expect(getLongProjectSettings("sample")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  describe.each([
    "INVALID_REQUEST",
    "UNSAFE_PROJECT_ID",
    "LONG_PROJECT_NOT_FOUND",
    "LONG_PROJECT_ALREADY_EXISTS",
    "LONG_PROJECT_JSON_MALFORMED",
    "LONG_PROJECT_DATA_INVALID",
    "LONG_PROJECT_STORAGE_ERROR",
    "LONG_OUTLINE_STALE",
    "LONG_OUTLINE_NOT_ALLOWED",
  ])("Backend error code %s", (code) => {
    it("is preserved verbatim on the thrown LongProjectsApiError", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code, message: `${code} raw backend detail` })));

      await expect(getLongProject("some_id")).rejects.toMatchObject({ code, message: `${code} raw backend detail` });
    });

    it("maps to a fixed, safe message via toLongProjectDisplayError that never leaks the raw backend text", () => {
      const error = new LongProjectsApiError(code, `${code} raw backend detail`);
      const displayed = toLongProjectDisplayError(error);
      expect(displayed.code).toBe(code);
      expect(displayed.message).not.toContain("raw backend detail");
      expect(displayed.message.length).toBeGreaterThan(0);
    });
  });

  it("converts a JSON-parse failure on a success response into a safe LongProjectsApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(200)));

    const error = await listLongProjects().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LongProjectsApiError);
    expect((error as LongProjectsApiError).code).toBe("CLIENT_MALFORMED_RESPONSE");
  });

  it("converts fetch() itself throwing (network failure) into a safe LongProjectsApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await listLongProjects().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LongProjectsApiError);
    expect((error as LongProjectsApiError).code).toBe("CLIENT_NETWORK_ERROR");
  });

  it("never leaks local paths or raw response bodies into the error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(500, { stack: "at C:\\Users\\secret\\project\\file.ts:42", oops: true })),
    );

    const error = (await listLongProjects().catch((caught: unknown) => caught)) as LongProjectsApiError;
    expect(error.message).not.toContain("C:\\");
    expect(error.message).not.toContain("secret");
  });

  describe("toLongProjectDisplayError", () => {
    it("falls back to a safe generic code/message for an unexpected error", () => {
      const result = toLongProjectDisplayError(new Error("some internal detail"));
      expect(typeof result.code).toBe("string");
      expect(result.code.length).toBeGreaterThan(0);
      expect(result.message).not.toContain("some internal detail");
    });
  });
});
