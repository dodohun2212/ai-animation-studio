import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";

import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { ImageReviewService } from "./image-review.service.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "image-review-")); roots.push(root);
  const projectsRoot = path.join(root, "learning_data", "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("review", "image review", "2026-08-22T00:00:00.000Z");
  project.workflow_state = WorkflowState.ImagesReview;
  await projects.create(project);
  const images = path.join(projectsRoot, "review", "images");
  await fs.mkdir(images, { recursive: true });
  project.generated_images = await Promise.all([1, 2, 3, 4, 5, 6].map(async (number) => {
    const file = path.join(images, `scene${number}.png`); await fs.writeFile(file, PNG); return file;
  }));
  await projects.save(project);
  return { projectsRoot, projects, service: new ImageReviewService(projects, projectsRoot) };
}

describe("provider-free generated image review", () => {
  it("returns six pending review rows for valid generated images without writing review metadata", async () => {
    const { projectsRoot, service } = await setup();
    const result = await service.getStatus("review");
    expect(result.project.workflowState).toBe(WorkflowState.ImagesReview);
    expect(result.reviews).toEqual(expect.arrayContaining([{ sceneNumber: 1, status: "pending", updatedAt: expect.any(String) }]));
    await expect(fs.stat(path.join(projectsRoot, "review", "generated_image_reviews.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires an explicit action, a numeric scene 1 through 6, IMAGES_REVIEW, and a valid PNG", async () => {
    const { projects, service } = await setup();
    await expect(service.approve("review", "1", {})).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.approve("review", "0", { approved: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const project = await projects.findById("review"); project.workflow_state = WorkflowState.ImagesReady; await projects.save(project);
    await expect(service.approve("review", "1", { approved: true })).rejects.toMatchObject({ response: { code: "IMAGE_REVIEW_NOT_ALLOWED" } });
    project.workflow_state = WorkflowState.ImagesReview; project.generated_images[0] = `${project.generated_images[0]}.missing`; await projects.save(project);
    await expect(service.approve("review", "1", { approved: true })).rejects.toMatchObject({ response: { code: "IMAGE_REVIEW_IMAGE_INVALID" } });
  });

  it("persists per-scene approval history, survives a new service instance, and advances only after all six", async () => {
    const { projectsRoot, projects, service } = await setup();
    const first = await service.approve("review", "1", { approved: true });
    expect(first.project.workflowState).toBe(WorkflowState.ImagesReview);
    expect(first.reviews.find((review) => review.sceneNumber === 1)?.status).toBe("approved");
    const raw = JSON.parse(await fs.readFile(path.join(projectsRoot, "review", "generated_image_reviews.json"), "utf8"));
    expect(raw).toEqual([expect.objectContaining({ scene_number: 1, status: "approved", history: [expect.objectContaining({ event: "approved" })] })]);
    const restarted = new ImageReviewService(new LocalProjectRepository(projectsRoot), projectsRoot);
    for (const scene of [2, 3, 4, 5, 6]) await restarted.approve("review", String(scene), { approved: true });
    const reloaded = await new LocalProjectRepository(projectsRoot).findById("review");
    expect(reloaded.workflow_state).toBe(WorkflowState.WaitingForVideoConfirmation);
    await expect(restarted.getStatus("review")).rejects.toMatchObject({ response: { code: "IMAGE_REVIEW_NOT_ALLOWED" } });
    expect((await projects.findById("review")).workflow_state).toBe(WorkflowState.WaitingForVideoConfirmation);
  });

  it("rejects damaged review JSON without treating it as a pending decision", async () => {
    const { projectsRoot, service } = await setup();
    await fs.writeFile(path.join(projectsRoot, "review", "generated_image_reviews.json"), "{bad", "utf8");
    await expect(service.getStatus("review")).rejects.toMatchObject({ response: { code: "IMAGE_REVIEW_DATA_INVALID" } });
  });
});
