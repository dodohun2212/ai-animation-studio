import type {
  ApproveProjectAssetMappingReviewResponse,
  BeginProjectAssetMappingReviewResponse,
  GetProjectAssetMappingReviewResponse,
  ListProjectAssetMappingsResponse,
  SnapshotProjectAssetMappingResponse,
  UpdateProjectAssetMappingResponse,
} from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  approveProjectAssetMappingReview,
  beginProjectAssetMappingReview,
  getProjectAssetMappingReview,
  listProjectAssetMappings,
  snapshotProjectAssetMapping,
  toMappingDisplayError,
  updateProjectAssetMapping,
} from "./mappingsApi.js";
import { jsonResponse, makeMapping, makeReview, nonJsonResponse } from "./testUtils.js";

describe("mappingsApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the mapping list via GET /projects/:id/assets/mappings", async () => {
    const response: ListProjectAssetMappingsResponse = { mappings: [makeMapping()] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await listProjectAssetMappings("sample_project")).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("/projects/sample_project/assets/mappings");
  });

  it("URL-encodes the project ID when building the mapping list route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { mappings: [] })));

    await listProjectAssetMappings("한글 project");

    expect(fetch).toHaveBeenCalledWith("/projects/%ED%95%9C%EA%B8%80%20project/assets/mappings");
  });

  it("fetches the current review via GET mapping-review", async () => {
    const response: GetProjectAssetMappingReviewResponse = { review: makeReview() };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getProjectAssetMappingReview("sample_project")).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("/projects/sample_project/assets/mapping-review");
  });

  it("confirms a mapping via PATCH with a decision body", async () => {
    const mapping = makeMapping({ status: "confirmed" });
    const review = makeReview();
    const response: UpdateProjectAssetMappingResponse = { mapping, review };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateProjectAssetMapping("sample_project", mapping.mappingId, { decision: "confirm" });

    expect(result).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/projects/sample_project/assets/mappings/${mapping.mappingId}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ decision: "confirm" });
  });

  it("rejects an update response whose mapping ID does not match the ID requested", async () => {
    const response: UpdateProjectAssetMappingResponse = { mapping: makeMapping({ mappingId: "MAP-OTHER" }), review: makeReview() };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, response)));

    await expect(updateProjectAssetMapping("sample_project", "MAP-000000000001", { decision: "confirm" })).rejects.toThrow();
  });

  it("begins a review via POST with the given scriptRevision and confirmation flags", async () => {
    const response: BeginProjectAssetMappingReviewResponse = { review: makeReview({ mappingRevision: 1, scriptRevision: 1 }) };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    const result = await beginProjectAssetMappingReview("sample_project", { scriptRevision: 1, textOnlyConfirmed: true, legacyConfirmed: false });

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

    const result = await approveProjectAssetMappingReview("sample_project", { scriptFingerprint: "a".repeat(64) });

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

    await expect(approveProjectAssetMappingReview("sample_project", { scriptFingerprint: "a".repeat(64) })).rejects.toMatchObject({
      code: "ASSET_MAPPING_APPROVAL_BLOCKED",
    });
  });

  it("surfaces a fingerprint-mismatch error with a fixed, safe message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, {
      code: "ASSET_MAPPING_FINGERPRINT_MISMATCH",
      message: "internal detail",
    })));

    await expect(approveProjectAssetMappingReview("sample_project", { scriptFingerprint: "a".repeat(64) })).rejects.toMatchObject({
      code: "ASSET_MAPPING_FINGERPRINT_MISMATCH",
    });
  });

  it("creates a snapshot via POST and rejects a response whose mapping ID does not match", async () => {
    const mapping = makeMapping({ snapshot: { relativePath: "asset_snapshots/MAP-000000000001-v1.png", sha256: "b".repeat(64), sourceVersion: 1 } });
    const response: SnapshotProjectAssetMappingResponse = { mapping };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    const result = await snapshotProjectAssetMapping("sample_project", mapping.mappingId);
    expect(result).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/projects/sample_project/assets/mappings/${mapping.mappingId}/snapshot`);
    expect(init.method).toBe("POST");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { mapping: makeMapping({ mappingId: "MAP-OTHER" }) })));
    await expect(snapshotProjectAssetMapping("sample_project", "MAP-000000000001")).rejects.toThrow();
  });

  it("maps a network failure to a safe, identifiable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(listProjectAssetMappings("sample_project")).rejects.toMatchObject({ code: "CLIENT_NETWORK_ERROR" });
  });

  it("maps a non-JSON response to a safe, identifiable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(200)));

    await expect(listProjectAssetMappings("sample_project")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a mapping list entry with an invalid scene scope shape", async () => {
    const invalid = { ...makeMapping(), sceneScope: { kind: "scene", sceneNumber: 13 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { mappings: [invalid] })));

    await expect(listProjectAssetMappings("sample_project")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("accepts a scene scope beyond the old fixed six, up to the supported maximum of twelve", async () => {
    const beyondSix = { ...makeMapping(), sceneScope: { kind: "scene", sceneNumber: 9 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { mappings: [beyondSix] })));

    await expect(listProjectAssetMappings("sample_project")).resolves.toEqual({ mappings: [beyondSix] });
  });

  it("never renders or throws the raw backend message text through toMappingDisplayError for a known code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { code: "ASSET_MAPPING_STORAGE_ERROR", message: "C:\\secret\\path failure" })));

    try {
      await listProjectAssetMappings("sample_project");
      throw new Error("expected rejection");
    } catch (caught) {
      const display = toMappingDisplayError(caught);
      expect(display.message).not.toContain("secret");
      expect(display.code).toBe("ASSET_MAPPING_STORAGE_ERROR");
    }
  });
});
