import { API_ROUTES, type GetAssetResponse, type ListAssetsResponse } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetsApiError, createAsset, deleteAsset, getAsset, listAssets, toAssetDisplayError, updateAsset } from "./assetsApi.js";
import { jsonResponse, makeAsset, nonJsonResponse } from "./testUtils.js";

describe("assetsApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the list via GET /assets with no query when no filters are given", async () => {
    const response: ListAssetsResponse = { assets: [makeAsset()] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await listAssets()).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("/assets");
  });

  it("sends a trimmed search query and exact asset type as query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { assets: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listAssets({ query: "  고양이  ", assetType: "character" });

    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url, "http://localhost");
    expect(parsed.pathname).toBe("/assets");
    expect(parsed.searchParams.get("query")).toBe("고양이");
    expect(parsed.searchParams.get("assetType")).toBe("character");
  });

  it("omits an all-whitespace query from the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { assets: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listAssets({ query: "   " });

    expect(fetchMock).toHaveBeenCalledWith("/assets");
  });

  it("preserves the backend's response order without re-sorting on the client", async () => {
    const response: ListAssetsResponse = {
      assets: [
        makeAsset({ assetId: "ASSET-1", displayName: "zzz" }),
        makeAsset({ assetId: "ASSET-2", displayName: "aaa" }),
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, response)));

    const result = await listAssets();
    expect(result.assets.map((asset) => asset.assetId)).toEqual(["ASSET-1", "ASSET-2"]);
  });

  it("fetches a single asset with usage and ownership via GET /assets/:id", async () => {
    const response: GetAssetResponse = {
      asset: makeAsset(),
      usageProjectIds: ["proj_a"],
      ownership: "project_owned",
      canDeleteOwnedFile: false,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getAsset("ASSET-GENERAL-000000000001")).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("/assets/ASSET-GENERAL-000000000001");
  });

  it("URL-encodes the asset ID when building single-asset routes", async () => {
    const assetId = "weird id/../x";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { asset: makeAsset({ assetId }), usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true })));

    await getAsset(assetId);

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe(`/assets/${encodeURIComponent(assetId)}`);
  });

  it("rejects a get-asset response whose asset ID does not match the ID that was requested", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {
      asset: makeAsset({ assetId: "ASSET-OTHER" }), usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true,
    })));

    await expect(getAsset("ASSET-GENERAL-000000000001")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("submits a multipart POST with the image under the 'image' field and metadata as a JSON string", async () => {
    const created = makeAsset({ displayName: "새 에셋" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { asset: created }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["binary-bytes"], "photo.png", { type: "image/png" });

    const result = await createAsset(file, { assetType: "general_reference", displayName: "새 에셋" });

    expect(result).toEqual({ asset: created });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/assets");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("image")).toBe(file);
    expect(JSON.parse(String(body.get("metadata")))).toEqual({ assetType: "general_reference", displayName: "새 에셋" });
  });

  it("sends metadata updates via PATCH with a JSON body", async () => {
    const updated = makeAsset({ displayName: "수정된 이름" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { asset: updated }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateAsset("ASSET-GENERAL-000000000001", { displayName: "수정된 이름" });

    expect(result).toEqual({ asset: updated });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/assets/ASSET-GENERAL-000000000001");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ displayName: "수정된 이름" });
  });

  it("rejects an update response whose asset ID does not match the ID that was requested", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { asset: makeAsset({ assetId: "ASSET-OTHER" }) })));

    await expect(updateAsset("ASSET-GENERAL-000000000001", { displayName: "x" })).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("deletes an asset via DELETE and returns the index-only outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { assetId: "ASSET-GENERAL-000000000001", deletedOwnedFile: false }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteAsset("ASSET-GENERAL-000000000001");

    expect(result).toEqual({ assetId: "ASSET-GENERAL-000000000001", deletedOwnedFile: false });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/assets/ASSET-GENERAL-000000000001");
    expect(init.method).toBe("DELETE");
  });

  it("rejects a delete response whose asset ID does not match the ID that was requested", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { assetId: "ASSET-OTHER", deletedOwnedFile: false })));

    await expect(deleteAsset("ASSET-GENERAL-000000000001")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("converts fetch() throwing (network failure) into a safe AssetsApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await listAssets().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AssetsApiError);
    expect((error as AssetsApiError).code).toBe("CLIENT_NETWORK_ERROR");
  });

  it("converts a non-JSON success response into a safe AssetsApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nonJsonResponse(200)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a list envelope containing a malformed asset instead of casting it blindly", async () => {
    const malformed = { assets: [{ assetId: "ASSET-1" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a get-asset envelope with an invalid ownership value", async () => {
    const malformed = { asset: makeAsset(), usageProjectIds: [], ownership: "unknown_kind", canDeleteOwnedFile: true };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(getAsset("ASSET-GENERAL-000000000001")).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects an asset whose nested versions array contains a malformed entry", async () => {
    const malformed = { assets: [{ ...makeAsset(), versions: [{ version: 1 }] }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects an asset whose nested referenceImages array contains a malformed entry", async () => {
    const malformed = { assets: [{ ...makeAsset(), referenceImages: [{ role: "front" }] }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects an asset whose contentUrl points outside the backend's own asset content route", async () => {
    const malformed = { assets: [makeAsset({ contentUrl: "https://evil.example.com/steal" })] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("accepts an asset whose ID needs URL-encoding as long as contentUrl is bound to that exact encoded content route", async () => {
    const assetId = "ASSET GENERAL/한글 1";
    const valid = { assets: [makeAsset({ assetId, contentUrl: API_ROUTES.assetContent(assetId) })] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, valid)));

    const result = await listAssets();
    expect(result.assets[0]?.contentUrl).toBe(`/assets/${encodeURIComponent(assetId)}/content`);
  });

  it("rejects a contentUrl bound to a different asset ID's content route", async () => {
    const malformed = { assets: [makeAsset({ assetId: "ASSET-1", contentUrl: API_ROUTES.assetContent("ASSET-2") })] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a malformed content route that only resembles the real asset content route", async () => {
    const assetId = "ASSET-GENERAL-000000000001";
    const malformed = { assets: [makeAsset({ assetId, contentUrl: `${API_ROUTES.assetContent(assetId)}/../secret` })] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a contradiction where imageAvailable is true but contentUrl is null", async () => {
    const malformed = { assets: [{ ...makeAsset(), imageAvailable: true, contentUrl: null }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a contradiction where imageAvailable is false but contentUrl still points at a content route", async () => {
    const assetId = "ASSET-GENERAL-000000000001";
    const malformed = { assets: [{ ...makeAsset({ assetId }), imageAvailable: false, contentUrl: API_ROUTES.assetContent(assetId) }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a top-level contentSha256 that is not a full 64-hex SHA-256 digest", async () => {
    const malformed = { assets: [makeAsset({ contentSha256: "" })] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a nested version whose contentSha256 is an empty string (versions never carry the legacy exception)", async () => {
    const malformed = { assets: [{ ...makeAsset(), versions: [{ version: 1, contentSha256: "", createdAt: "2026-08-21T00:00:00.000Z", notes: "" }] }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("accepts a reference image whose contentSha256 is the documented legacy empty string", async () => {
    const valid = {
      assets: [{ ...makeAsset(), assetType: "character", referenceRoles: ["front"], referenceImages: [{ role: "front", contentSha256: "", originalFilename: "front.png" }] }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, valid)));

    await expect(listAssets()).resolves.toBeDefined();
  });

  it("rejects a reference image whose contentSha256 is set but not a valid digest", async () => {
    const malformed = { assets: [{ ...makeAsset(), referenceImages: [{ role: "front", contentSha256: "not-a-digest", originalFilename: "front.png" }] }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a version number that is not a finite positive integer", async () => {
    const malformed = { assets: [makeAsset({ version: 0 })] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a non-integer sortOrder", async () => {
    const malformed = { assets: [makeAsset({ sortOrder: 1.5 })] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a sourceSceneNumber outside the 1-6 scene range", async () => {
    const malformed = { assets: [makeAsset({ sourceSceneNumber: 7 })] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("accepts a null sourceSceneNumber", async () => {
    const valid = { assets: [makeAsset({ sourceSceneNumber: null })] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, valid)));

    await expect(listAssets()).resolves.toBeDefined();
  });

  it("rejects a createdAt timestamp that is not a valid UTC ISO timestamp", async () => {
    const malformed = { assets: [makeAsset({ createdAt: "2026-08-21" })] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a timestamp with a non-UTC offset", async () => {
    const malformed = { assets: [makeAsset({ updatedAt: "2026-08-21T00:00:00+09:00" })] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("accepts a legacy-style UTC offset timestamp alongside a Z-suffixed one", async () => {
    const valid = { assets: [makeAsset({ createdAt: "2026-08-21T00:00:00+00:00", updatedAt: "2026-08-21T00:00:00.000Z" })] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, valid)));

    await expect(listAssets()).resolves.toBeDefined();
  });

  describe.each([
    "INVALID_REQUEST",
    "UNSAFE_ASSET_ID",
    "ASSET_NOT_FOUND",
    "ASSET_ALREADY_EXISTS",
    "ASSET_IN_USE",
    "ASSET_MUTATION_UNSUPPORTED",
    "ASSET_JSON_MALFORMED",
    "ASSET_DATA_INVALID",
    "ASSET_FILE_INVALID",
    "ASSET_STORAGE_ERROR",
  ])("backend error code %s", (code) => {
    it("maps to a fixed, non-empty Korean message and preserves the code", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code, message: "raw backend detail that must never render" })));

      const error = await listAssets().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AssetsApiError);
      expect((error as AssetsApiError).code).toBe(code);
      const display = toAssetDisplayError(error);
      expect(display.code).toBe(code);
      expect(display.message.length).toBeGreaterThan(0);
      expect(display.message).not.toContain("raw backend detail");
    });
  });

  it("never surfaces the backend's raw message, details, path, or stack", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(500, {
        code: "ASSET_STORAGE_ERROR",
        message: "ENOENT at C:\\Users\\secret\\learning_data\\asset_library\\assets.json",
        details: { path: "C:\\Users\\secret", stack: "at Object.<anonymous> (C:\\Users\\secret\\file.ts:42:1)" },
      })),
    );

    const error = (await listAssets().catch((caught: unknown) => caught)) as AssetsApiError;
    const display = toAssetDisplayError(error);
    expect(JSON.stringify(display)).not.toContain("secret");
    expect(JSON.stringify(display)).not.toContain("C:\\");
    expect(JSON.stringify(display)).not.toContain("ENOENT");
    expect(display.message).toBe("에셋을 저장하거나 읽지 못했습니다.");
  });

  it("falls back to a fixed unknown-error message for an untrusted or unmapped error code", async () => {
    const secretCode = "UNKNOWN_C:\\Users\\secret\\sk-live-value";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code: secretCode, message: "raw" })));

    const error = (await listAssets().catch((caught: unknown) => caught)) as AssetsApiError;
    expect(error.code).toBe(secretCode);
    const display = toAssetDisplayError(error);
    expect(display.code).toBe("CLIENT_UNKNOWN_ERROR");
    expect(display.message).toBe("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    expect(JSON.stringify(display)).not.toContain("secret");
    expect(JSON.stringify(display)).not.toContain("sk-live-value");
  });

  it("treats a missing/empty error code as the safe malformed-response fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { message: "internal only" })));

    const error = (await listAssets().catch((caught: unknown) => caught)) as AssetsApiError;
    expect(error.code).toBe("CLIENT_MALFORMED_RESPONSE");
    expect(toAssetDisplayError(error).message).not.toContain("internal only");
  });

  it("toAssetDisplayError falls back to a safe generic result for a non-AssetsApiError", () => {
    const result = toAssetDisplayError(new Error("some internal detail"));
    expect(result.code).toBe("CLIENT_UNKNOWN_ERROR");
    expect(result.message).not.toContain("some internal detail");
  });

  it("never sends requests to provider, video, or FFmpeg-related routes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { assets: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listAssets({ query: "x", assetType: "style" });
    await getAsset("ASSET-GENERAL-000000000001").catch(() => undefined);

    for (const [url] of fetchMock.mock.calls as Array<[string]>) {
      expect(url).toMatch(/^\/assets/);
      expect(url).not.toContain("/settings/providers");
      expect(url).not.toContain("/videos/");
    }
  });

  /**
   * Hand-built to mirror the shape the real backend mapper (asset.mapper.ts's
   * toPublicAsset + parseAssetIndex's field rules) actually produces — a full
   * SHA-256 digest, a contentUrl bound to API_ROUTES.assetContent(assetId), a
   * Z-suffixed UTC timestamp, and a documented legacy empty referenceImage
   * digest — without importing anything from apps/backend.
   */
  const backendMapperShapedAsset = {
    assetId: "ASSET-CHAR-1A2B3C4D5E6F",
    assetType: "character",
    displayName: "주인공",
    description: "메인 캐릭터",
    originalFilename: "hero.png",
    contentSha256: "f".repeat(64),
    imageAvailable: true,
    contentUrl: API_ROUTES.assetContent("ASSET-CHAR-1A2B3C4D5E6F"),
    tags: ["hero"],
    aliases: [],
    enabled: true,
    approved: true,
    faceBaseline: true,
    characterKey: "hero",
    version: 2,
    versions: [
      { version: 1, contentSha256: "e".repeat(64), createdAt: "2026-08-01T00:00:00.000Z", notes: "" },
      { version: 2, contentSha256: "f".repeat(64), createdAt: "2026-08-20T12:34:56.000Z", notes: "리터치" },
    ],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T12:34:56.000Z",
    notes: "",
    legacyAssetIds: [],
    status: "approved",
    sourceProjectId: "_asset_library_manual",
    sourceSceneNumber: null,
    referenceImages: [
      { role: "thumbnail", contentSha256: "", originalFilename: "hero.png" },
      { role: "front", contentSha256: "f".repeat(64), originalFilename: "hero.png" },
    ],
    referenceRoles: ["thumbnail", "front"],
    isFolder: false,
    parentFolderId: "",
    childAssetIds: [],
    thumbnailAssetId: "",
    role: "",
    sortOrder: 0,
  };

  it("accepts a real backend-mapper-shaped Asset envelope through the list guard", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { assets: [backendMapperShapedAsset] })));

    const result = await listAssets();
    expect(result.assets[0]?.assetId).toBe("ASSET-CHAR-1A2B3C4D5E6F");
  });

  it("accepts a real backend-mapper-shaped Asset envelope through the get guard", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {
      asset: backendMapperShapedAsset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true,
    })));

    await expect(getAsset("ASSET-CHAR-1A2B3C4D5E6F")).resolves.toMatchObject({ asset: { assetId: "ASSET-CHAR-1A2B3C4D5E6F" } });
  });

  /**
   * Hand-built to mirror the exact no-content folder shape the real backend
   * emits — asset-storage.ts's parseAssetIndex enforces content_sha256: "",
   * stored_path: "" (so imageAvailable is false and contentUrl is null), and
   * empty versions/reference_images arrays for any is_folder record (see the
   * "rejects minimal-step mutation for folders" fixture in
   * assets.repository.test.ts) — without importing anything from apps/backend.
   */
  const backendMapperShapedFolder = {
    assetId: "FOLDER-ROOT",
    assetType: "background",
    displayName: "배경 폴더",
    description: "",
    originalFilename: "",
    contentSha256: "",
    imageAvailable: false,
    contentUrl: null,
    tags: [],
    aliases: [],
    enabled: true,
    approved: false,
    faceBaseline: false,
    characterKey: null,
    version: 1,
    versions: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    notes: "",
    legacyAssetIds: [],
    status: "manual",
    sourceProjectId: "",
    sourceSceneNumber: null,
    referenceImages: [],
    referenceRoles: [],
    isFolder: true,
    parentFolderId: "",
    childAssetIds: ["ASSET-CHILD-1"],
    thumbnailAssetId: "ASSET-CHILD-1",
    role: "",
    sortOrder: 0,
  };

  it("accepts a real backend-mapper-shaped folder envelope through the list guard", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { assets: [backendMapperShapedFolder] })));

    const result = await listAssets();
    expect(result.assets[0]?.assetId).toBe("FOLDER-ROOT");
  });

  it("accepts a real backend-mapper-shaped folder envelope through the get guard", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {
      asset: backendMapperShapedFolder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true,
    })));

    await expect(getAsset("FOLDER-ROOT")).resolves.toMatchObject({ asset: { assetId: "FOLDER-ROOT" } });
  });

  it("rejects a folder whose contentSha256 is a real digest instead of the backend's empty-string invariant", async () => {
    const malformed = { assets: [{ ...backendMapperShapedFolder, contentSha256: "a".repeat(64) }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a folder that contradicts the no-content invariant by claiming an available image", async () => {
    const malformed = { assets: [{ ...backendMapperShapedFolder, imageAvailable: true, contentUrl: API_ROUTES.assetContent("FOLDER-ROOT") }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a folder with a non-null contentUrl even while imageAvailable stays false", async () => {
    const malformed = { assets: [{ ...backendMapperShapedFolder, contentUrl: API_ROUTES.assetContent("FOLDER-ROOT") }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a folder carrying a non-empty versions array", async () => {
    const malformed = {
      assets: [{ ...backendMapperShapedFolder, versions: [{ version: 1, contentSha256: "a".repeat(64), createdAt: "2026-08-01T00:00:00.000Z", notes: "" }] }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("rejects a folder carrying a non-empty referenceImages array", async () => {
    const malformed = { assets: [{ ...backendMapperShapedFolder, referenceImages: [{ role: "thumbnail", contentSha256: "", originalFilename: "" }] }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("still rejects a non-folder asset with an empty contentSha256 (the legacy exception is folder-only)", async () => {
    const malformed = { assets: [makeAsset({ isFolder: false, contentSha256: "" })] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, malformed)));

    await expect(listAssets()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });
});
