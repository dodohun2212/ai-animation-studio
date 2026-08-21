import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectsController } from "./projects.controller.js";
import { LocalProjectRepository } from "./projects.repository.js";
import { ProjectsService } from "./projects.service.js";

function newBackendInstance(root: string): ProjectsController {
  return new ProjectsController(new ProjectsService(new LocalProjectRepository(root)));
}

describe("project persistence across a Backend restart", () => {
  let root: string;

  beforeEach(async () => {
    root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "projects-restart-test-"));
  });

  afterEach(async () => {
    await fsPromises.rm(root, { recursive: true, force: true });
  });

  it("keeps a created project visible and unchanged after the Backend process restarts", async () => {
    // 1-2. First instance creates a project; project.json is written to the shared root.
    let firstInstance: ProjectsController | undefined = newBackendInstance(root);
    const created = await firstInstance.create({
      projectId: "sample_project",
      topic: "우주를 여행하는 고양이",
    });

    // 3. Discard the first instance entirely so nothing but the file on disk can carry state forward.
    firstInstance = undefined;

    // 4. A completely new repository/service/controller triad, as a fresh Backend instance would build.
    const secondInstance = newBackendInstance(root);

    // 5. GET /projects on the new instance must see the project.
    const { projects } = await secondInstance.list();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe("sample_project");

    // 6. GET /projects/:projectId reopens it.
    const reopened = await secondInstance.getOne("sample_project");

    // 7. Every core field must be identical before and after the restart.
    expect(reopened.project.id).toBe(created.project.id);
    expect(reopened.project.topic).toBe(created.project.topic);
    expect(reopened.project.projectType).toBe(created.project.projectType);
    expect(reopened.project.workflowState).toBe(created.project.workflowState);
    expect(reopened.project.createdAt).toBe(created.project.createdAt);
    expect(reopened.project.updatedAt).toBe(created.project.updatedAt);
    expect(reopened.project).toEqual(created.project);
  });
});
