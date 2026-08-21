import { describe, expect, it } from "vitest";
import { assertSafeAssetId } from "./asset-id.js";

describe("Asset ID safety", () => {
  it.each(["ASSET-CHAR-ABC_123", "ASSET-LEGACY_ID", "FOLDER-ABC-123"])("accepts canonical legacy-compatible ID %s", (id) => {
    expect(assertSafeAssetId(id)).toBe(id);
  });
  it.each(["../ASSET-X", "ASSET-../X", "ASSET-%2e%2e", "asset-LOWER", "ASSET-X/Y", "ASSET-X\\Y", "FOLDER-한글", "ASSET- X"])("rejects traversal or non-canonical ID %s", (id) => {
    expect(() => assertSafeAssetId(id)).toThrow();
  });
});
