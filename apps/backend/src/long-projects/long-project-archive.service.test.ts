import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LongProjectsService } from "./long-projects.service.js";

const settings = { title: "Exact long title", logline: "logline", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };

describe("long-project recoverable archive", () => {
  let root: string;
  let projectsRoot: string;
  let service: LongProjectsService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "long-project-archive-")); projectsRoot = path.join(root, "projects"); service = new LongProjectsService(projectsRoot);
    await service.create({ projectId: "long", settings });
    await fs.mkdir(path.join(projectsRoot, "long", "long_story", "episodes", "001", "history"), { recursive: true });
    await fs.writeFile(path.join(projectsRoot, "long", "long_story", "episodes", "001", "history", "keep.txt"), "all episode history", "utf8");
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("archives the complete long directory and removes it from normal access", async () => {
    await expect(service.archive("long", { confirmation: "Exact long title" })).resolves.toEqual({ archivedProjectId: "long" });
    await expect(fs.readFile(path.join(projectsRoot, ".archive", "long", "long_story", "episodes", "001", "history", "keep.txt"), "utf8")).resolves.toBe("all episode history");
    expect(await service.list()).toEqual({ projects: [] });
    await expect(service.get("long")).rejects.toMatchObject({ response: { code: "LONG_PROJECT_NOT_FOUND" } });
  });

  it("rejects blank/mismatched confirmation, traversal, and active episode work without moving data", async () => {
    await expect(service.archive("long", { confirmation: "Exact long title " })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.archive("../long", { confirmation: "Exact long title" })).rejects.toMatchObject({ response: { code: "UNSAFE_PROJECT_ID" } });
    const outlinesPath = path.join(projectsRoot, "long", "long_story", "episode_outlines.json");
    const outlines = JSON.parse(await fs.readFile(outlinesPath, "utf8")) as Array<Record<string, unknown>>;
    outlines[0]!.status = "videos_generating";
    await fs.writeFile(outlinesPath, JSON.stringify(outlines), "utf8");
    await expect(service.archive("long", { confirmation: "Exact long title" })).rejects.toMatchObject({ response: { code: "LONG_PROJECT_ARCHIVE_NOT_ALLOWED" } });
    await expect(fs.access(path.join(projectsRoot, "long", "long_story", "episodes", "001", "history", "keep.txt"))).resolves.toBeUndefined();
  });

  it("keeps source data on archive collision and move failure", async () => {
    await fs.mkdir(path.join(projectsRoot, ".archive", "long"), { recursive: true });
    await expect(service.archive("long", { confirmation: "Exact long title" })).rejects.toMatchObject({ response: { code: "LONG_PROJECT_ARCHIVE_COLLISION" } });
    await expect(fs.access(path.join(projectsRoot, "long", "long_story", "project.json"))).resolves.toBeUndefined();
    await fs.rm(path.join(projectsRoot, ".archive", "long"), { recursive: true });
    const failing = new LongProjectsService(projectsRoot, async () => { throw new Error("disk failure"); });
    await expect(failing.archive("long", { confirmation: "Exact long title" })).rejects.toMatchObject({ response: { code: "LONG_PROJECT_STORAGE_ERROR" } });
    await expect(fs.readFile(path.join(projectsRoot, "long", "long_story", "episodes", "001", "history", "keep.txt"), "utf8")).resolves.toBe("all episode history");
  });

  it("lists archived long projects with an archived-at timestamp and restores one back to its active location", async () => {
    await service.archive("long", { confirmation: "Exact long title" });

    const listed = await service.listArchived();
    expect(listed.projects).toHaveLength(1);
    expect(listed.projects[0]).toMatchObject({ id: "long", title: "Exact long title" });
    expect(typeof listed.projects[0]!.archivedAt).toBe("string");
    expect(await service.list()).toEqual({ projects: [] });

    await expect(service.restore("long")).resolves.toEqual({ restoredProjectId: "long" });
    await expect(fs.readFile(path.join(projectsRoot, "long", "long_story", "episodes", "001", "history", "keep.txt"), "utf8")).resolves.toBe("all episode history");
    expect(await service.listArchived()).toEqual({ projects: [] });
    await expect(service.get("long")).resolves.toMatchObject({ project: { title: "Exact long title" } });
  });

  it("rejects restoring a long project that is not archived and a restore collision with an active project", async () => {
    await expect(service.restore("long")).rejects.toMatchObject({ response: { code: "LONG_PROJECT_NOT_FOUND" } });
    await expect(service.restore("../long")).rejects.toMatchObject({ response: { code: "UNSAFE_PROJECT_ID" } });

    await service.archive("long", { confirmation: "Exact long title" });
    await service.create({ projectId: "long", settings: { ...settings, title: "Recreated" } });
    await expect(service.restore("long")).rejects.toMatchObject({ response: { code: "LONG_PROJECT_RESTORE_COLLISION" } });
    await expect(fs.readFile(path.join(projectsRoot, ".archive", "long", "long_story", "episodes", "001", "history", "keep.txt"), "utf8")).resolves.toBe("all episode history");
  });

  it("permanently deletes an archived long project after exact confirmation, never touching an active project of the same ID", async () => {
    await service.archive("long", { confirmation: "Exact long title" });
    for (const confirmation of ["", "Exact long title ", "wrong"]) {
      await expect(service.deleteArchived("long", { confirmation })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    }
    await service.create({ projectId: "active", settings: { ...settings, title: "Active long project" } });
    await expect(service.deleteArchived("active", { confirmation: "Active long project" })).rejects.toMatchObject({ response: { code: "LONG_PROJECT_NOT_FOUND" } });
    await expect(fs.access(path.join(projectsRoot, "active"))).resolves.toBeUndefined();

    await expect(service.deleteArchived("long", { confirmation: "Exact long title" })).resolves.toEqual({ deletedProjectId: "long" });
    await expect(fs.access(path.join(projectsRoot, ".archive", "long"))).rejects.toBeTruthy();
    expect(await service.listArchived()).toEqual({ projects: [] });
  });
});
