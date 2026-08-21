import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { isSafeProjectId, resolveSafeProjectDirectory } from "./project-id.js";

describe("isSafeProjectId", () => {
  it("accepts letters, numbers, underscore and dash", () => {
    expect(isSafeProjectId("sample_project-1")).toBe(true);
  });

  it("accepts Unicode letters, matching Python's str.isalnum()", () => {
    expect(isSafeProjectId("우주_고양이")).toBe(true);
  });

  it("rejects an empty ID", () => {
    expect(isSafeProjectId("")).toBe(false);
  });

  it("rejects path separators, dots and drive prefixes", () => {
    expect(isSafeProjectId("../outside")).toBe(false);
    expect(isSafeProjectId("a/b")).toBe(false);
    expect(isSafeProjectId("a\\b")).toBe(false);
    expect(isSafeProjectId(".")).toBe(false);
    expect(isSafeProjectId("..")).toBe(false);
    expect(isSafeProjectId("C:\\Windows")).toBe(false);
  });

  it("rejects URL-encoded traversal sequences", () => {
    expect(isSafeProjectId("%2e%2e%2foutside")).toBe(false);
  });

  it("rejects whitespace", () => {
    expect(isSafeProjectId("has space")).toBe(false);
  });
});

describe("resolveSafeProjectDirectory", () => {
  it("resolves a safe ID to a path inside the root", () => {
    const root = path.join("C:", "projects-root");
    expect(resolveSafeProjectDirectory(root, "sample_project")).toBe(
      path.join(root, "sample_project"),
    );
  });

  it("rejects an ID that would resolve outside the configured root", () => {
    const root = path.join("C:", "projects-root");
    expect(() => resolveSafeProjectDirectory(root, "../escape")).toThrow();
  });
});
