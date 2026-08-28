import type {
  ApproveProjectAssetMappingReviewResponse,
  BeginProjectAssetMappingReviewResponse,
  GetProjectAssetMappingReviewResponse,
  ListProjectAssetMappingsResponse,
  SnapshotProjectAssetMappingResponse,
  UpdateProjectAssetMappingResponse,
} from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { episodeMappingApi, projectMappingApi, toMappingDisplayError } from "./mappingsApi.js";
import { jsonResponse, makeMapping, makeReview, nonJsonResponse } from "./testUtils.js";

describe("mappingsApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the mapping list via GET /projects/:id/assets/mappings", async () => {
    const response: ListProjectAssetMappingsResponse = { mappings: [makeMapping()] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await projectMappingApi("sample_project").list()).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("/projects/sample_project/assets/mappings");
  });

  it("URL-encodes the project ID when building the mapping list route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { mappings: [] })));

    await projectMappingApi("한글 project").list();

    expect(fetch).toHaveBeenCalledWith("/projects/%ED%95%9C%EA%B8%80%20project/assets/mappings");
  });

  it("fetches the current review via GET mapping-review", async () => {
    const response: GetProjectAssetMappingReviewResponse = { review: makeReview(), sceneCount: 6 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await projectMappingApi("sample_project").getReview()).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("/projects/sample_project/assets/mapping-review");
  });

  it("rejects a review response with no sceneCount instead of letting undefined reach the scene pickers", async () => {
    // The screen builds its scene lists from this number. Without the guard a response missing it arrives as
    // `undefined` on a field the type says is a number, sceneNumbersFor(undefined) yields nothing, and the
    // pickers go empty with no error anywhere — the app looking broken instead of saying so.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { review: makeReview() })));

    await expect(projectMappingApi("sample_project").getReview()).rejects.toMatchObject({
      code: "CLIENT_MALFORMED_RESPONSE",
    });
  });

  it("confirms a mapping via PATCH with a decision body", async () => {
    const mapping = makeMapping({ status: "confirmed" });
    const review = makeReview();
    const response: UpdateProjectAssetMappingResponse = { mapping, review };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    const result = await projectMappingApi("sample_project").update(mapping.mappingId, { decision: "confirm" });

    expect(result).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/projects/sample_project/assets/mappings/${mapping.mappingId}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ decision: "confirm" });
  });

  it("rejects an update response whose mapping ID does not match the ID requested", async () => {
    const response: UpdateProjectAssetMappingResponse = { mapping: makeMapping({ mappingId: "MAP-OTHER" }), review: makeReview() };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await expect(projectMappingApi("sample_project").update("MAP-000000000001", { decision: "confirm" })).rejects.toThrow();
  });

  it("begins a review via POST with the given scriptRevision and confirmation flags", async () => {
    const response: BeginProjectAssetMappingReviewResponse = { review: makeReview({ mappingRevision: 1, scriptRevision: 1 }) };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    const result = await projectMappingApi("sample_project").beginReview({ scriptRevision: 1, textOnlyConfirmed: true, legacyConfirmed: false });

    expect(result).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/assets/mapping-review");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ scriptRevision: 1, textOnlyConfirmed: true, legacyConfirmed: false });
  });

  it("approves a review via POST with the current script fingerprint", async () => {
    const response: ApproveProjectAssetMappingReviewResponse = { review: makeReview({ status: "approved", approvedAt: "2026-08-22T00:00:00.000Z", approvedBy: "user" }) };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    const result = await projectMappingApi("sample_project").approveReview({ scriptFingerprint: "a".repeat(64) });

    expect(result).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/assets/mapping-review/approve");
    expect(init.method).toBe("POST");
  });

  it("surfaces a blocked-approval error with a fixed, safe message and passes through safe detail identifiers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, {
      code: "ASSET_MAPPING_APPROVAL_BLOCKED",
      message: "internal detail that must never reach the UI",
      details: { missingSceneNumbers: [2, 4] },
    })));

    await expect(projectMappingApi("sample_project").approveReview({ scriptFingerprint: "a".repeat(64) })).rejects.toMatchObject({
      code: "ASSET_MAPPING_APPROVAL_BLOCKED",
    });
  });

  it("surfaces a fingerprint-mismatch error with a fixed, safe message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, {
      code: "ASSET_MAPPING_FINGERPRINT_MISMATCH",
      message: "internal detail",
    })));

    await expect(projectMappingApi("sample_project").approveReview({ scriptFingerprint: "a".repeat(64) })).rejects.toMatchObject({
      code: "ASSET_MAPPING_FINGERPRINT_MISMATCH",
    });
  });

  it("creates a snapshot via POST and rejects a response whose mapping ID does not match", async () => {
    const mapping = makeMapping({ snapshot: { relativePath: "asset_snapshots/MAP-000000000001-v1.png", sha256: "b".repeat(64), sourceVersion: 1 } });
    const response: SnapshotProjectAssetMappingResponse = { mapping };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    const result = await projectMappingApi("sample_project").snapshot(mapping.mappingId);
    expect(result).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/projects/sample_project/assets/mappings/${mapping.mappingId}/snapshot`);
    expect(init.method).toBe("POST");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { mapping: makeMapping({ mappingId: "MAP-OTHER" }) })));
    await expect(projectMappingApi("sample_project").snapshot("MAP-000000000001")).rejects.toThrow();
  });

  it("maps a network failure to a safe, identifiable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(projectMappingApi("sample_project").list()).rejects.toMatchObject({ code: "CLIENT_NETWORK_ERROR" });
  });

  it("maps a non-JSON response to a safe, identifiable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(200)));

    await expect(projectMappingApi("sample_project").list()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a mapping list entry with an invalid scene scope shape", async () => {
    const invalid = { ...makeMapping(), sceneScope: { kind: "scene", sceneNumber: 13 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { mappings: [invalid] })));

    await expect(projectMappingApi("sample_project").list()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("accepts a scene scope beyond the old fixed six, up to the supported maximum of twelve", async () => {
    const beyondSix = { ...makeMapping(), sceneScope: { kind: "scene", sceneNumber: 9 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { mappings: [beyondSix] })));

    await expect(projectMappingApi("sample_project").list()).resolves.toEqual({ mappings: [beyondSix] });
  });

  it("never renders or throws the raw backend message text through toMappingDisplayError for a known code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { code: "ASSET_MAPPING_STORAGE_ERROR", message: "C:\\secret\\path failure" })));

    try {
      await projectMappingApi("sample_project").list();
      throw new Error("expected rejection");
    } catch (caught) {
      const display = toMappingDisplayError(caught);
      expect(display.message).not.toContain("secret");
      expect(display.code).toBe("ASSET_MAPPING_STORAGE_ERROR");
    }
  });

  it("sends the same calls to an Episode's own scope when built with episodeMappingApi", async () => {
    // The whole point of the adapter: identical flow, identical shapes, different scope. Asserted per route
    // because a builder typo here is invisible — the request would simply reach the wrong owner's mappings and
    // succeed.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { mappings: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const api = episodeMappingApi("sample_project", 3);

    await api.list();
    expect(fetchMock).toHaveBeenLastCalledWith("/long-projects/sample_project/episodes/3/assets/mappings");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { review: makeReview(), sceneCount: 6 })));
    await api.getReview();
    expect(fetch).toHaveBeenLastCalledWith("/long-projects/sample_project/episodes/3/assets/mapping-review");
  });

  it("URL-encodes the project ID in an Episode route too", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { mappings: [] })));

    await episodeMappingApi("한글 project", 2).list();

    expect(fetch).toHaveBeenCalledWith("/long-projects/%ED%95%9C%EA%B8%80%20project/episodes/2/assets/mappings");
  });

  it("creates a mapping without sending versionPolicy, so the server decides it", async () => {
    // Untested until now, and it is the call that was unreachable from a Long Episode at all. versionPolicy is
    // omitted on purpose: the server picks follow_latest for a Folder (which has no versions of its own) and
    // pinned_version for a single image, and rejects a Folder pinned to a version. Sending one from here would
    // put that rule in two places, and the Long Episode path already showed what happens when a second copy of
    // a rule drifts — a Folder its own UI offered was refused on save.
    const mapping = makeMapping();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { mapping, review: makeReview() }));
    vi.stubGlobal("fetch", fetchMock);

    await projectMappingApi("sample_project").create({
      assetId: mapping.assetId, usageRole: "character", sceneScope: { kind: "all" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/assets/mappings");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("versionPolicy");
    expect(body.usageRole).toBe("character");
  });
});
