import { describe, expect, it } from "vitest";

import { isSafeProjectId } from "./projectId.js";

describe("isSafeProjectId", () => {
  it("accepts letters, numbers, underscore and dash", () => {
    expect(isSafeProjectId("sample_project-1")).toBe(true);
  });

  it("accepts a Korean project ID", () => {
    expect(isSafeProjectId("우주_고양이")).toBe(true);
  });

  it("rejects an empty ID", () => {
    expect(isSafeProjectId("")).toBe(false);
  });

  it("rejects whitespace", () => {
    expect(isSafeProjectId("has space")).toBe(false);
    expect(isSafeProjectId(" leading")).toBe(false);
  });

  it("rejects dots, slashes and backslashes", () => {
    expect(isSafeProjectId(".")).toBe(false);
    expect(isSafeProjectId("..")).toBe(false);
    expect(isSafeProjectId("a/b")).toBe(false);
    expect(isSafeProjectId("a\\b")).toBe(false);
    expect(isSafeProjectId("../outside")).toBe(false);
  });

  it("rejects URL-encoded traversal sequences", () => {
    expect(isSafeProjectId("%2e%2e%2foutside")).toBe(false);
  });
});
