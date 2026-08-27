import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { WorkflowState } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it } from "vitest";

import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { LocalProjectAssetMappingsRepository } from "./mappings.repository.js";
import { ShortProjectMappingOwners } from "./short-project-mapping-owner.js";

let root: string | undefined;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

async function setup(workflowState: WorkflowState = WorkflowState.WaitingForAssetMappingReview) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mapping-owner-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("owner_test", "Owner", "2026-08-28T00:00:00.000Z");
  project.script_revision = 4;
  project.scenes = [1, 2, 3, 4, 5, 6].map((number) => ({ number, description: `scene ${number}` }));
  project.workflow_state = workflowState;
  await projects.create(project);
  const repository = new LocalProjectAssetMappingsRepository(projectsRoot);
  return { projects, repository, projectsRoot };
}

describe("ShortProjectMappingOwners", () => {
  it("answers the four questions the mapping flow asks, from where the service used to read them", async () => {
    const { repository, projects } = await setup();
    const owner = await new ShortProjectMappingOwners(repository, projects).get("owner_test");

    expect(owner.sceneCount).toBe(6);
    expect(owner.scenes).toHaveLength(6);
    expect(owner.scriptRevision).toBe(4);
  });

  it("raises the mapping flow's own not-found error for a project that is not there", async () => {
    // The read stays inside the repository precisely so this keeps being a mapping error rather than whichever
    // error a different reader would have produced.
    const { repository, projects } = await setup();
    await expect(new ShortProjectMappingOwners(repository, projects).get("no_such_project")).rejects.toMatchObject({});
  });

  it("advances the project when the approval is the thing it was waiting for", async () => {
    const { repository, projects } = await setup();
    const owner = await new ShortProjectMappingOwners(repository, projects).get("owner_test");

    await owner.markMappingApproved(3);

    const saved = await projects.findById("owner_test");
    expect(saved.workflow_state).toBe(WorkflowState.AssetMappingApproved);
    expect(saved.mapping_revision).toBe(3);
  });

  it("does not drag a project backwards when a later approval arrives", async () => {
    // Approving again is allowed — the review itself is rewritten — so the state is what has to refuse. Without
    // this the second approval would move a project that had already moved past this step back to it.
    const { repository, projects } = await setup(WorkflowState.GeneratingImages);
    const owner = await new ShortProjectMappingOwners(repository, projects).get("owner_test");

    await owner.markMappingApproved(9);

    const saved = await projects.findById("owner_test");
    expect(saved.workflow_state).toBe(WorkflowState.GeneratingImages);
    expect(saved.mapping_revision).not.toBe(9);
  });

  it("changes nothing where there is no project repository to change it with", async () => {
    // The contexts that only read mappings construct the owners without one, exactly as the service used to be
    // constructed without a project repository.
    const { repository, projects } = await setup();
    const owner = await new ShortProjectMappingOwners(repository).get("owner_test");

    await owner.markMappingApproved(2);

    expect((await projects.findById("owner_test")).workflow_state).toBe(WorkflowState.WaitingForAssetMappingReview);
  });
});
