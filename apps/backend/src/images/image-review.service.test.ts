import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";

import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
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
  const assets = new LocalAssetsRepository(path.dirname(projectsRoot));
  await assets.indexGeneratedProjectImages("review", project.topic, []);
  return { projectsRoot, projects, assets, service: new ImageReviewService(projects, projectsRoot, assets) };
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
    const { projectsRoot, projects, assets, service } = await setup();
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

  it("archives only the regenerated scene, resets its approval, and survives a new service instance", async () => {
    const { projectsRoot, projects, assets, service } = await setup();
    for (const scene of [1, 2, 3, 4, 5, 6]) await service.approve("review", String(scene), { approved: true });
    const before = await fs.readFile(path.join(projectsRoot, "review", "images", "scene3.png"));
    const result = await service.regenerate("review", "3", { approved: true });
    expect(result.project.workflowState).toBe(WorkflowState.ImagesReview);
    expect(result.reviews.find((review) => review.sceneNumber === 3)?.status).toBe("pending");
    expect(result.reviews.filter((review) => review.sceneNumber !== 3).every((review) => review.status === "approved")).toBe(true);
    const archive = path.join(projectsRoot, "review", "images", "originals", "scene3_v001.png");
    await expect(fs.readFile(archive)).resolves.toEqual(before);
    const raw = JSON.parse(await fs.readFile(path.join(projectsRoot, "review", "generated_image_reviews.json"), "utf8"));
    expect(raw.find((item: { scene_number: number }) => item.scene_number === 3)).toEqual(expect.objectContaining({
      status: "pending", regeneration_count: 1,
      history: expect.arrayContaining([expect.objectContaining({ event: "pending" }), expect.objectContaining({ event: "regenerated" })]),
    }));
    const restarted = new ImageReviewService(new LocalProjectRepository(projectsRoot), projectsRoot);
    await restarted.approve("review", "3", { approved: true });
    expect((await projects.findById("review")).workflow_state).toBe(WorkflowState.WaitingForVideoConfirmation);
  });

  it("rejects unknown or unsafe regeneration input and never permits a stored path outside the project images folder", async () => {
    const { projects, service } = await setup();
    await expect(service.regenerate("review", "01", { approved: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.regenerate("review", "1", { approved: true, extra: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const project = await projects.findById("review");
    project.generated_images[0] = path.join(path.dirname(project.generated_images[0]!), "..", "outside.png");
    await projects.save(project);
    await expect(service.regenerate("review", "1", { approved: true })).rejects.toMatchObject({ response: { code: "IMAGE_REVIEW_IMAGE_INVALID" } });
  });

  it("does not replace image bytes when existing review metadata is malformed", async () => {
    const { projectsRoot, service } = await setup();
    const current = path.join(projectsRoot, "review", "images", "scene1.png");
    const before = await fs.readFile(current);
    await fs.writeFile(path.join(projectsRoot, "review", "generated_image_reviews.json"), "{bad", "utf8");
    await expect(service.regenerate("review", "1", { approved: true })).rejects.toMatchObject({ response: { code: "IMAGE_REVIEW_DATA_INVALID" } });
    await expect(fs.readFile(current)).resolves.toEqual(before);
    await expect(fs.stat(path.join(projectsRoot, "review", "images", "originals"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
