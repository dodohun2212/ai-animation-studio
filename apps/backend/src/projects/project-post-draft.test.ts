import { describe, expect, it } from "vitest";
import { applyPostDraft, parsePostDraft, toPostDraft } from "./project-post-draft.js";
import { createStoredProject } from "./project.mapper.js";

describe("toPostDraft", () => {
  it("returns an empty object when lore_context has no post_draft field", () => {
    const stored = createStoredProject("p", "topic", "2026-08-23T00:00:00.000Z");
    expect(toPostDraft(stored)).toEqual({});
  });

  it("reads the snake_case lore_context field into the camelCase API shape", () => {
    const stored = createStoredProject("p", "topic", "2026-08-23T00:00:00.000Z");
    stored.lore_context = { post_draft: { body: "오늘의 영상입니다", hashtags: "#고양이 #우주", ai_notice: false } };
    expect(toPostDraft(stored)).toEqual({ body: "오늘의 영상입니다", hashtags: "#고양이 #우주", aiNotice: false });
  });

  it("omits blank strings rather than returning empty-string fields", () => {
    const stored = createStoredProject("p", "topic", "2026-08-23T00:00:00.000Z");
    stored.lore_context = { post_draft: { body: "", hashtags: "", ai_notice: true } };
    expect(toPostDraft(stored)).toEqual({ aiNotice: true });
  });

  it("tolerates malformed legacy data instead of throwing", () => {
    const stored = createStoredProject("p", "topic", "2026-08-23T00:00:00.000Z");
    stored.lore_context = { post_draft: "not-an-object" };
    expect(toPostDraft(stored)).toEqual({});
  });
});

describe("parsePostDraft", () => {
  it("accepts a well-formed request", () => {
    expect(parsePostDraft({ body: "본문", hashtags: "#a #b", aiNotice: true })).toEqual({ body: "본문", hashtags: "#a #b", aiNotice: true });
  });

  it("accepts an empty request, since every field is optional", () => {
    expect(parsePostDraft({})).toEqual({});
  });

  it("rejects an unknown field", () => {
    expect(() => parsePostDraft({ body: "x", extra: "y" })).toThrow();
  });

  it("rejects a body over the character cap", () => {
    expect(() => parsePostDraft({ body: "a".repeat(2201) })).toThrow();
  });

  it("rejects a non-boolean aiNotice", () => {
    expect(() => parsePostDraft({ aiNotice: "yes" })).toThrow();
  });

  it("rejects a non-object request", () => {
    expect(() => parsePostDraft("not-an-object")).toThrow();
    expect(() => parsePostDraft(undefined)).toThrow();
  });
});

describe("applyPostDraft", () => {
  it("stores the draft under lore_context.post_draft, defaulting an omitted field to blank/true", () => {
    const stored = createStoredProject("p", "topic", "2026-08-23T00:00:00.000Z");
    const updated = applyPostDraft(stored, { body: "본문" }, "2026-08-24T00:00:00.000Z");
    expect(updated.lore_context.post_draft).toEqual({ body: "본문", hashtags: "", ai_notice: true });
    expect(updated.updated_at).toBe("2026-08-24T00:00:00.000Z");
  });

  it("is a full replace, not a merge — a second call without body clears it rather than keeping the first", () => {
    const stored = createStoredProject("p", "topic", "2026-08-23T00:00:00.000Z");
    const first = applyPostDraft(stored, { body: "첫 번째", hashtags: "#a" }, "2026-08-24T00:00:00.000Z");
    const second = applyPostDraft(first, { hashtags: "#b" }, "2026-08-25T00:00:00.000Z");
    expect(second.lore_context.post_draft).toEqual({ body: "", hashtags: "#b", ai_notice: true });
  });

  it("preserves other lore_context fields already present", () => {
    const stored = createStoredProject("p", "topic", "2026-08-23T00:00:00.000Z");
    stored.lore_context = { atmosphere_asset_ids: ["ASSET-A"] };
    const updated = applyPostDraft(stored, { body: "본문" }, "2026-08-24T00:00:00.000Z");
    expect(updated.lore_context.atmosphere_asset_ids).toEqual(["ASSET-A"]);
  });
});
