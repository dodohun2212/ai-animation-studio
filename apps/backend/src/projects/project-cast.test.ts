import { describe, expect, it } from "vitest";
import { applyShortProjectCast, parseShortProjectCast, toShortProjectCast } from "./project-cast.js";
import { createStoredProject } from "./project.mapper.js";

describe("toShortProjectCast", () => {
  it("returns an empty array when character_profile.cast is absent", () => {
    const stored = createStoredProject("p", "topic", "2026-08-22T00:00:00.000Z");
    expect(toShortProjectCast(stored)).toEqual([]);
  });

  it("maps snake_case cast entries to the camelCase API shape", () => {
    const stored = createStoredProject("p", "topic", "2026-08-22T00:00:00.000Z");
    stored.character_profile = { name: "Hero", cast: [{ asset_id: "ASSET-CHAR-1", cast_role: "protagonist", story_role: "대표 캐릭터" }] };
    expect(toShortProjectCast(stored)).toEqual([{ assetId: "ASSET-CHAR-1", castRole: "protagonist", storyRole: "대표 캐릭터" }]);
  });

  it("fills in Python's defaults for a legacy entry missing role fields, and drops an entry with no asset_id", () => {
    const stored = createStoredProject("p", "topic", "2026-08-22T00:00:00.000Z");
    stored.character_profile = { cast: [{ asset_id: "ASSET-CHAR-1" }, { cast_role: "protagonist" }] };
    expect(toShortProjectCast(stored)).toEqual([{ assetId: "ASSET-CHAR-1", castRole: "supporting", storyRole: "서브 캐릭터" }]);
  });
});

describe("parseShortProjectCast", () => {
  it("accepts a well-formed cast array", () => {
    const parsed = parseShortProjectCast({ cast: [{ assetId: "ASSET-CHAR-1", castRole: "protagonist", storyRole: "대표 캐릭터" }] });
    expect(parsed).toEqual([{ assetId: "ASSET-CHAR-1", castRole: "protagonist", storyRole: "대표 캐릭터" }]);
  });

  it("trims whitespace from every field", () => {
    const parsed = parseShortProjectCast({ cast: [{ assetId: " ASSET-CHAR-1 ", castRole: " protagonist ", storyRole: " 대표 캐릭터 " }] });
    expect(parsed).toEqual([{ assetId: "ASSET-CHAR-1", castRole: "protagonist", storyRole: "대표 캐릭터" }]);
  });

  it("rejects a request body with fields other than cast", () => {
    expect(() => parseShortProjectCast({ cast: [], extra: true })).toThrow();
    expect(() => parseShortProjectCast({})).toThrow();
    expect(() => parseShortProjectCast([])).toThrow();
  });

  it("rejects a cast member with unknown fields or a missing/blank assetId", () => {
    expect(() => parseShortProjectCast({ cast: [{ assetId: "A", castRole: "x", storyRole: "y", extra: true }] })).toThrow();
    expect(() => parseShortProjectCast({ cast: [{ castRole: "x", storyRole: "y" }] })).toThrow();
    expect(() => parseShortProjectCast({ cast: [{ assetId: "  ", castRole: "x", storyRole: "y" }] })).toThrow();
  });

  it("rejects a blank or over-length castRole/storyRole", () => {
    expect(() => parseShortProjectCast({ cast: [{ assetId: "A", castRole: "", storyRole: "y" }] })).toThrow();
    expect(() => parseShortProjectCast({ cast: [{ assetId: "A", castRole: "x", storyRole: "y".repeat(81) }] })).toThrow();
  });

  it("rejects a duplicate assetId", () => {
    expect(() => parseShortProjectCast({ cast: [
      { assetId: "A", castRole: "x", storyRole: "y" },
      { assetId: "A", castRole: "x", storyRole: "y" },
    ] })).toThrow();
  });

  it("rejects more than 12 cast members", () => {
    const cast = Array.from({ length: 13 }, (_, index) => ({ assetId: `A${index}`, castRole: "x", storyRole: "y" }));
    expect(() => parseShortProjectCast({ cast })).toThrow();
  });

  it("accepts an empty cast array", () => {
    expect(parseShortProjectCast({ cast: [] })).toEqual([]);
  });
});

describe("applyShortProjectCast", () => {
  it("writes snake_case cast entries into character_profile while preserving other fields", () => {
    const stored = createStoredProject("p", "topic", "2026-08-22T00:00:00.000Z");
    stored.character_profile = { name: "Hero" };
    const updated = applyShortProjectCast(stored, [{ assetId: "ASSET-CHAR-1", castRole: "protagonist", storyRole: "대표 캐릭터" }], "2026-08-23T00:00:00.000Z");
    expect(updated.character_profile).toEqual({ name: "Hero", cast: [{ asset_id: "ASSET-CHAR-1", cast_role: "protagonist", story_role: "대표 캐릭터" }] });
    expect(updated.updated_at).toBe("2026-08-23T00:00:00.000Z");
  });
});
