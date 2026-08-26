import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";

import { createStoredProject } from "./project.mapper.js";
import { OrphanedGenerationRecoveryService } from "./orphaned-generation-recovery.service.js";
import { LocalProjectRepository } from "./projects.repository.js";

const roots: string[] = [];
async function setup() {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "orphan-recovery-"));
  roots.push(root);
  const repository = new LocalProjectRepository(root);
  return { repository, service: new OrphanedGenerationRecoveryService(repository) };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsPromises.rm(root, { recursive: true, force: true })));
});

describe("OrphanedGenerationRecoveryService", () => {
  it("reverts every orphaned in-progress state to the state its own loop started from, preserving already-generated results", async () => {
    const { repository, service } = await setup();
    const generatingStory = { ...createStoredProject("p1", "t1", "2026-08-26T00:00:00.000Z"), workflow_state: WorkflowState.GeneratingStory };
    const generatingImages = { ...createStoredProject("p2", "t2", "2026-08-26T00:00:00.000Z"), workflow_state: WorkflowState.GeneratingImages, generated_images: ["images/scene1.png", "images/scene2.png", "images/scene3.png"] };
    const generatingVideos = { ...createStoredProject("p3", "t3", "2026-08-26T00:00:00.000Z"), workflow_state: WorkflowState.GeneratingVideos };
    const rendering = { ...createStoredProject("p4", "t4", "2026-08-26T00:00:00.000Z"), workflow_state: WorkflowState.Rendering };
    await Promise.all([generatingStory, generatingImages, generatingVideos, rendering].map((project) => repository.create(project)));

    const recovered = await service.recoverAll();

    expect(recovered.map((project) => project.project_id).sort()).toEqual(["p1", "p2", "p3", "p4"]);
    expect((await repository.findById("p1")).workflow_state).toBe(WorkflowState.Ready);
    const p2 = await repository.findById("p2");
    expect(p2.workflow_state).toBe(WorkflowState.AssetMappingApproved);
    expect(p2.generated_images).toEqual(["images/scene1.png", "images/scene2.png", "images/scene3.png"]); // untouched — nothing already made is discarded
    expect((await repository.findById("p3")).workflow_state).toBe(WorkflowState.Interrupted);
    expect((await repository.findById("p4")).workflow_state).toBe(WorkflowState.VideosApproved);
    expect(p2.warnings).toEqual([expect.stringContaining("GENERATING_IMAGES")]);
  });

  it("leaves projects outside a generating state untouched", async () => {
    const { repository, service } = await setup();
    const ready = createStoredProject("ready_project", "t", "2026-08-26T00:00:00.000Z");
    const approved = { ...createStoredProject("approved_project", "t", "2026-08-26T00:00:00.000Z"), workflow_state: WorkflowState.AssetMappingApproved };
    await repository.create(ready);
    await repository.create(approved);

    const recovered = await service.recoverAll();

    expect(recovered).toEqual([]);
    expect((await repository.findById("ready_project")).workflow_state).toBe(WorkflowState.Ready);
    expect((await repository.findById("approved_project")).workflow_state).toBe(WorkflowState.AssetMappingApproved);
  });

  it("is idempotent — a second recovery pass finds nothing left to recover", async () => {
    const { repository, service } = await setup();
    await repository.create({ ...createStoredProject("p1", "t1", "2026-08-26T00:00:00.000Z"), workflow_state: WorkflowState.GeneratingImages });

    await service.recoverAll();
    const second = await service.recoverAll();

    expect(second).toEqual([]);
  });
});
