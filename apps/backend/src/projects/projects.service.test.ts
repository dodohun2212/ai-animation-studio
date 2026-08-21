import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { WorkflowState } from "@ai-animation-studio/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalProjectRepository } from "./projects.repository.js";
import { ProjectsService } from "./projects.service.js";

describe("ProjectsService", () => {
  let root: string;
  let service: ProjectsService;

  beforeEach(async () => {
    root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "projects-service-test-"));
    service = new ProjectsService(new LocalProjectRepository(root));
  });

  afterEach(async () => {
    await fsPromises.rm(root, { recursive: true, force: true });
  });

  it("creates a project and returns the camelCase API shape", async () => {
    const response = await service.createProject({ projectId: "sample_project", topic: "우주를 여행하는 고양이" });

    expect(response.project).toEqual({
      id: "sample_project",
      topic: "우주를 여행하는 고양이",
      projectType: "short_project",
      workflowState: WorkflowState.Ready,
      createdAt: response.project.createdAt,
      updatedAt: response.project.updatedAt,
      scenes: [],
      warnings: [],
      errors: [],
    });
    expect(new Date(response.project.createdAt).toISOString()).toBe(response.project.createdAt);
  });

  it("trims surrounding whitespace on projectId and topic", async () => {
    const response = await service.createProject({ projectId: "  padded_id  ", topic: "  padded topic  " });
    expect(response.project.id).toBe("padded_id");
    expect(response.project.topic).toBe("padded topic");
  });

  it("rejects an empty or missing projectId/topic", async () => {
    await expect(service.createProject({ projectId: "", topic: "topic" })).rejects.toThrow();
    await expect(service.createProject({ projectId: "id", topic: "   " })).rejects.toThrow();
    await expect(
      service.createProject({} as unknown as { projectId: string; topic: string }),
    ).rejects.toThrow();
  });

  it("rejects an unsafe projectId", async () => {
    await expect(service.createProject({ projectId: "../escape", topic: "topic" })).rejects.toThrow();
  });

  it("rejects a duplicate projectId", async () => {
    await service.createProject({ projectId: "dup_project", topic: "first" });
    await expect(service.createProject({ projectId: "dup_project", topic: "second" })).rejects.toThrow();
  });

  it("returns an empty list when no projects exist", async () => {
    expect(await service.listProjects()).toEqual({ projects: [] });
  });

  it("lists multiple projects sorted by most recently updated first", async () => {
    await service.createProject({ projectId: "older", topic: "older topic" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.createProject({ projectId: "newer", topic: "newer topic" });

    const { projects } = await service.listProjects();
    expect(projects.map((project) => project.id)).toEqual(["newer", "older"]);
  });

  it("reopens a created project by ID with matching fields", async () => {
    const created = await service.createProject({ projectId: "reopen_me", topic: "topic" });
    const reopened = await service.getProject("reopen_me");
    expect(reopened.project).toEqual(created.project);
  });

  it("throws a not-found error for a missing project", async () => {
    await expect(service.getProject("missing_project")).rejects.toThrow();
  });
});
