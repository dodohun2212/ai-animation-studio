import type { ListLongProjectsResponse } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  approveLongProjectOutline,
  approveLongEpisodeAssetMappingReview,
  approveLongEpisodeImageReview,
  beginLongEpisodeAssetMappingReview,
  createLongProject,
  createLongProjectOutlinePreview,
  getLongProject,
  getLongProjectSettings,
  getLongEpisodeAssetMappingReview,
  getLongEpisodeImageReview,
  listLongProjects,
  LongProjectsApiError,
  toLongProjectDisplayError,
  updateLongProjectSettings,
  updateLongEpisodeAssetMapping,
  regenerateLongEpisodeImageReview,
  startLongEpisodeImageGeneration,
  getLongEpisodeVideoPreview,
  startLongEpisodeVideoGeneration,
  getLongEpisodeContinuity,
  saveLongEpisodeContinuity,
  getLongEpisodeContinuityReference,
  addLongEpisode,
  duplicateLongEpisode,
  archiveLongEpisode,
} from "./longProjectsApi.js";
import { jsonResponse, makeLongEpisodeOutline, makeLongProject, makeLongProjectSettings, makeLongProjectSummary, nonJsonResponse } from "./testUtils.js";

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

  it("uses the local draft Episode timeline routes with an explicit archive body", async () => {
    const project = makeLongProject({ id: "timeline", episodeCount: 2 });
    const episode = makeLongEpisodeOutline({ episodeNumber: 3 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { project, episode }))
      .mockResolvedValueOnce(jsonResponse(200, { project, episode }))
      .mockResolvedValueOnce(jsonResponse(200, { project, archivedEpisodeNumber: 2, archiveId: "archive-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await addLongEpisode("timeline");
    await duplicateLongEpisode("timeline", 2);
    await archiveLongEpisode("timeline", 2);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/long-projects/timeline/episodes",
      "/long-projects/timeline/episodes/2/duplicate",
      "/long-projects/timeline/episodes/2",
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({});
    const archive = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(archive.method).toBe("DELETE");
    expect(JSON.parse(String(archive.body))).toEqual({ approved: true });
  });

  it("uses only the documented local Episode mapping-review routes", async () => {
    const candidate = { mappingId: "MAP-1", sourceCollection: "characters" as const, sourceItemId: "hero", assetId: "ASSET-1", usageRole: "character" as const, versionPolicy: "pinned_version" as const, pinnedVersion: 1, episodeScope: { mode: "all" as const }, status: "suggested" as const, userConfirmed: false };
    const review = { projectId: "reopen_me", episodeNumber: 1, mappingRevision: 1, scriptRevision: 3, scriptFingerprint: "a".repeat(64), status: "waiting" as const, textOnlyConfirmed: false, candidates: [candidate] };
    const episode = { episodeNumber: 1, title: "Episode 1", summary: "", mainEvent: "", conflict: "", cliffhanger: "", nextEpisodeHook: "", status: "asset_mapping_approved" as const, approved: true, scriptRevision: 3, scriptHistoryCount: 1 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { review }))
      .mockResolvedValueOnce(jsonResponse(200, { review }))
      .mockResolvedValueOnce(jsonResponse(200, { mapping: { ...candidate, status: "confirmed", userConfirmed: true }, review }))
      .mockResolvedValueOnce(jsonResponse(200, { review: { ...review, status: "approved" }, episode }));
    vi.stubGlobal("fetch", fetchMock);

    await getLongEpisodeAssetMappingReview("reopen_me", 1);
    await beginLongEpisodeAssetMappingReview("reopen_me", 1, {});
    await updateLongEpisodeAssetMapping("reopen_me", 1, "MAP-1", { decision: "confirm" });
    await approveLongEpisodeAssetMappingReview("reopen_me", 1, { approved: true, scriptFingerprint: review.scriptFingerprint });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/long-projects/reopen_me/episodes/1/asset-mapping-review",
      "/long-projects/reopen_me/episodes/1/asset-mapping-review",
      "/long-projects/reopen_me/episodes/1/asset-mapping-review/mappings/MAP-1",
      "/long-projects/reopen_me/episodes/1/asset-mapping-review/approval",
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({ decision: "confirm" });
  });

  it("uses only the documented local Episode image routes and explicit approval bodies", async () => {
    const imageEpisode = { episodeNumber: 1, title: "Episode 1", summary: "", mainEvent: "", conflict: "", cliffhanger: "", nextEpisodeHook: "", status: "images_review" as const, approved: true, scriptRevision: 3, scriptHistoryCount: 1 };
    const reviews = [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({ sceneNumber, status: "pending" as const, updatedAt: "2026-08-23T00:00:00.000Z" }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageEpisode, reviews }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageEpisode, generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageEpisode, reviews }))
      .mockResolvedValueOnce(jsonResponse(200, { episode: imageEpisode, reviews, sceneNumber: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    await getLongEpisodeImageReview("reopen_me", 1);
    await startLongEpisodeImageGeneration("reopen_me", 1);
    await approveLongEpisodeImageReview("reopen_me", 1, 1);
    await regenerateLongEpisodeImageReview("reopen_me", 1, 2);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/long-projects/reopen_me/episodes/1/images/review",
      "/long-projects/reopen_me/episodes/1/images/generations",
      "/long-projects/reopen_me/episodes/1/images/review/1/approve",
      "/long-projects/reopen_me/episodes/1/images/review/2/regenerate",
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ approved: true });
    expect(JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body))).toEqual({ approved: true });
  });

  it("gets the read-only Episode Scene 6 continuity reference without a request body", async () => {
    const response = { reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6 as const, available: true } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLongEpisodeContinuityReference("reopen_me", 2)).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("/long-projects/reopen_me/episodes/2/continuity-reference");
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

  it("validates Episode video preview responses and preserves a stale submission API code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { confirmationId: "x", model: "gen4_turbo", ratio: "720:1280", durationSecondsPerScene: 5, executionMode: "sequential", estimatedCostUsd: 1.5, scenes: [] })));
    await expect(getLongEpisodeVideoPreview("long", 1)).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code: "VIDEO_CONFIRMATION_STALE", message: "C:\\\\private" })));
    await expect(startLongEpisodeVideoGeneration("long", 1, { confirmationId: "confirm", userRequestId: "request", approved: true, prompts: [1,2,3,4,5,6].map((sceneNumber) => ({ sceneNumber: sceneNumber as 1|2|3|4|5|6, prompt: "prompt" })) })).rejects.toMatchObject({ code: "VIDEO_CONFIRMATION_STALE" });
  });

  it("uses GET and explicit PUT only for Episode continuity memory", async () => {
    const continuity = { episodeNumber: 1, episodeSummary: "summary", events: [], appearedCharacterIds: [], characterChanges: [], appearedLocationIds: [], itemChanges: [], resolvedConflicts: [], newConflicts: [], revealedSecretIds: [], remainingSecretIds: [], newForeshadowingIds: [], resolvedForeshadowingIds: [], nextActions: [], timeElapsed: "", worldChanges: [], userEdits: "", updatedAt: "2026-08-23T00:00:00.000Z" };
    const nextEpisode = { episodeNumber: 2, title: "Episode 2", summary: "", mainEvent: "", conflict: "", cliffhanger: "", nextEpisodeHook: "", status: "outline_ready" as const, approved: false, scriptRevision: 0, scriptHistoryCount: 0 };
    const { episodeNumber: _episodeNumber, updatedAt: _updatedAt, ...inputMemory } = continuity;
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { memory: null })).mockResolvedValueOnce(jsonResponse(200, { memory: continuity, nextEpisode }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLongEpisodeContinuity("long", 1)).resolves.toEqual({ memory: null });
    await expect(saveLongEpisodeContinuity("long", 1, { memory: inputMemory })).resolves.toEqual({ memory: continuity, nextEpisode });

    expect(fetchMock.mock.calls[0]).toEqual(["/long-projects/long/episodes/1/continuity"]);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/long-projects/long/episodes/1/continuity");
    expect(init.method).toBe("PUT");
  });
});
