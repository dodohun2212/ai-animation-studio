import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { WorkflowState } from "@ai-animation-studio/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalProjectRepository } from "./projects.repository.js";
import { ProjectsService } from "./projects.service.js";

describe("short-project recoverable archive", () => {
  let root: string;
  let repository: LocalProjectRepository;
  let service: ProjectsService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "project-archive-"));
    repository = new LocalProjectRepository(root);
    service = new ProjectsService(repository);
    await service.createProject({ projectId: "short", topic: "Exact topic" });
    await fs.mkdir(path.join(root, "short", "nested"), { recursive: true });
    await fs.writeFile(path.join(root, "short", "nested", "keep.bin"), "preserve", "utf8");
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("moves the full directory to the hidden archive, excludes it from normal lookup/listing, and preserves contents", async () => {
    await expect(service.archiveProject("short", { confirmation: "Exact topic" })).resolves.toEqual({ archivedProjectId: "short" });
    await expect(fs.access(path.join(root, "short"))).rejects.toBeTruthy();
    await expect(fs.readFile(path.join(root, ".archive", "short", "nested", "keep.bin"), "utf8")).resolves.toBe("preserve");
    expect(await service.listProjects()).toEqual({ projects: [] });
    await expect(service.getProject("short")).rejects.toMatchObject({ response: { code: "PROJECT_NOT_FOUND" } });
  });

  it("requires the exact nonblank persisted topic and rejects traversal", async () => {
    for (const confirmation of ["", "Exact topic ", "wrong"]) {
      await expect(service.archiveProject("short", { confirmation })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    }
    await expect(service.archiveProject("../short", { confirmation: "Exact topic" })).rejects.toMatchObject({ response: { code: "UNSAFE_PROJECT_ID" } });
    await expect(fs.access(path.join(root, "short"))).resolves.toBeUndefined();
  });

  it.each([WorkflowState.GeneratingStory, WorkflowState.GeneratingImages, WorkflowState.GeneratingVideos, WorkflowState.Rendering, WorkflowState.Interrupted])("does not archive active %s work", async (state) => {
    const stored = await repository.findById("short");
    await repository.save({ ...stored, workflow_state: state });
    await expect(service.archiveProject("short", { confirmation: "Exact topic" })).rejects.toMatchObject({ response: { code: "PROJECT_ARCHIVE_NOT_ALLOWED" } });
    await expect(fs.access(path.join(root, "short", "project.json"))).resolves.toBeUndefined();
  });

  it("rejects an archive collision and a storage failure without losing source data", async () => {
    await fs.mkdir(path.join(root, ".archive", "short"), { recursive: true });
    await expect(service.archiveProject("short", { confirmation: "Exact topic" })).rejects.toMatchObject({ response: { code: "PROJECT_ARCHIVE_COLLISION" } });
    await expect(fs.access(path.join(root, "short", "nested", "keep.bin"))).resolves.toBeUndefined();

    const failing = new ProjectsService(new LocalProjectRepository(root, undefined, async () => { throw new Error("disk failure"); }));
    await fs.rm(path.join(root, ".archive", "short"), { recursive: true });
    await expect(failing.archiveProject("short", { confirmation: "Exact topic" })).rejects.toMatchObject({ response: { code: "PROJECT_STORAGE_ERROR" } });
    await expect(fs.readFile(path.join(root, "short", "nested", "keep.bin"), "utf8")).resolves.toBe("preserve");
  });
});
