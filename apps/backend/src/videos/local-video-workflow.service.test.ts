import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";

import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { LocalVideoPreviewService } from "./video-preview.service.js";
import { LocalVideoSubmissionService } from "./local-video-submission.service.js";
import { LocalVideoWorkflowService } from "./local-video-workflow.service.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

function scenes() { return [1, 2, 3, 4, 5, 6].map((number) => ({ number, description: `d${number}`, visual_action: "a", start_motion: "s", main_motion: "m", end_motion: "e", shot_size: "medium", camera_angle: "eye", composition: "center", lens_feel: "natural", focus_subject: "subject", camera_motion: "dolly", environment_motion: "wind", motion_speed: "normal", motion_intensity: "moderate", expression_change: "calm", continuity_hint: "continue" })); }

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "video-workflow-")); roots.push(root);
  const projectsRoot = path.join(root, "projects"); const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("video_workflow", "topic", "2026-08-23T00:00:00.000Z"); project.workflow_state = WorkflowState.WaitingForVideoConfirmation; project.scenes = scenes(); await projects.create(project);
  const images = path.join(projectsRoot, project.project_id, "images"); await fs.mkdir(images, { recursive: true });
  project.generated_images = await Promise.all([1, 2, 3, 4, 5, 6].map(async (number) => { const file = path.join(images, `scene${number}.png`); await fs.writeFile(file, PNG); return file; })); await projects.save(project);
  const previews = new LocalVideoPreviewService(projects, projectsRoot); const submit = new LocalVideoSubmissionService(projects, previews);
  const preview = await previews.preview(project.project_id, undefined);
  const accepted = await submit.start(project.project_id, { confirmationId: preview.confirmationId!, userRequestId: "request_1", approved: true, prompts: preview.previews.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
  return { projectsRoot, projects, accepted, workflow: new LocalVideoWorkflowService(projects, projectsRoot) };
}

describe("local fake video workflow", () => {
  it("writes six sequential local placeholders, persists restart-safe checkpoints, and never exposes paths", async () => {
    const { projectsRoot, projects, accepted, workflow } = await setup();
    await expect(workflow.run("video_workflow", accepted.jobId)).resolves.toMatchObject({ status: "succeeded", completedSceneNumbers: [1, 2, 3, 4, 5, 6] });
    const project = await projects.findById("video_workflow");
    expect(project.workflow_state).toBe(WorkflowState.ReviewingVideos);
    expect(project.generated_video_paths).toHaveLength(6);
    expect(await Promise.all([1, 2, 3, 4, 5, 6].map((scene) => fs.stat(path.join(projectsRoot, "video_workflow", "videos", "runway", `scene${scene}.mp4`))))).toHaveLength(6);
    const review = await new LocalVideoWorkflowService(projects, projectsRoot).getReview("video_workflow", accepted.jobId);
    expect(JSON.stringify(review)).not.toContain(projectsRoot); expect(review.reviews).toHaveLength(6);
  });

  it("serves a completed scene's mp4 bytes by canonical path, independent of jobId, and rejects a missing or out-of-range scene", async () => {
    const { projectsRoot, accepted, workflow } = await setup();
    await workflow.run("video_workflow", accepted.jobId);
    const content = await workflow.content("video_workflow", "2");
    expect(content).toEqual({ path: path.join(projectsRoot, "video_workflow", "videos", "runway", "scene2.mp4") });
    await expect(fs.readFile(content.path)).resolves.toEqual(expect.any(Buffer));
    await expect(workflow.content("video_workflow", "7")).rejects.toMatchObject({ response: { code: "VIDEO_CONTENT_UNAVAILABLE" } });
    await expect(workflow.content("video_workflow", "abc")).rejects.toMatchObject({ response: { code: "VIDEO_CONTENT_UNAVAILABLE" } });
  });

  it("rejects content for a scene that has not produced a video yet", async () => {
    const { workflow } = await setup();
    await expect(workflow.content("video_workflow", "1")).rejects.toMatchObject({ response: { code: "VIDEO_CONTENT_UNAVAILABLE" } });
  });

  it("stops before a new scene, blocks direct new submission state, and restarts missing work without replacing completed files", async () => {
    const { projectsRoot, projects, accepted, workflow } = await setup();
    const project = await projects.findById("video_workflow");
    const first = path.join(projectsRoot, "video_workflow", "videos", "runway", "scene1.mp4"); await fs.mkdir(path.dirname(first), { recursive: true }); await fs.writeFile(first, Buffer.from("completed"));
    project.generated_video_paths = [first, "", "", "", "", ""]; project.video_generation_records = project.video_generation_records.map((record) => typeof record === "object" && record !== null && (record as { scene_number?: number }).scene_number === 1 ? { ...(record as Record<string, unknown>), status: "succeeded", output_path: first } : record); await projects.save(project);
    await expect(workflow.stop("video_workflow", accepted.jobId)).resolves.toMatchObject({ status: "interrupted", completedSceneNumbers: [1] });
    await expect(workflow.run("video_workflow", accepted.jobId)).rejects.toMatchObject({ response: { code: "VIDEO_WORKFLOW_NOT_ALLOWED" } });
    await expect(new LocalVideoWorkflowService(projects, projectsRoot).restart("video_workflow", accepted.jobId)).resolves.toMatchObject({ status: "succeeded" });
    await expect(fs.readFile(first, "utf8")).resolves.toBe("completed");
  });

  it("requires explicit regeneration approval, archives only regenerated output, resets its review, and advances after six approvals", async () => {
    const { projectsRoot, projects, accepted, workflow } = await setup(); await workflow.run("video_workflow", accepted.jobId);
    await expect(workflow.regenerate("video_workflow", accepted.jobId, [])).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(workflow.regenerate("video_workflow", accepted.jobId, [2])).resolves.toMatchObject({ regeneratedSceneNumbers: [2], status: "succeeded" });
    await expect(fs.readdir(path.join(projectsRoot, "video_workflow", "videos", "history"))).resolves.toContain("scene2_v001.mp4");
    for (const scene of [1, 2, 3, 4, 5, 6] as const) await workflow.approveReview("video_workflow", accepted.jobId, String(scene), { approved: true });
    expect((await projects.findById("video_workflow")).workflow_state).toBe(WorkflowState.VideosApproved);
  });
});
