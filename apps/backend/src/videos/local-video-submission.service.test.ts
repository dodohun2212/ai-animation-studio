import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";

import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { LocalVideoPreviewService } from "./video-preview.service.js";
import { LocalVideoSubmissionService } from "./local-video-submission.service.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

function scenes() {
  return [1, 2, 3, 4, 5, 6].map((number) => ({ number, description: `d${number}`, visual_action: `a${number}`, start_motion: `s${number}`, main_motion: `m${number}`, end_motion: `e${number}`, shot_size: "medium", camera_angle: "eye", composition: "center", lens_feel: "natural", focus_subject: "subject", camera_motion: "dolly", environment_motion: "wind", motion_speed: "normal", motion_intensity: "moderate", expression_change: "calm", continuity_hint: "continue" }));
}

async function setup(budget = 10) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "video-submit-")); roots.push(root);
  const projectsRoot = path.join(root, "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("video_submit", "topic", "2026-08-23T00:00:00.000Z");
  project.workflow_state = WorkflowState.WaitingForVideoConfirmation;
  project.scenes = scenes();
  await projects.create(project);
  const images = path.join(projectsRoot, project.project_id, "images"); await fs.mkdir(images, { recursive: true });
  project.generated_images = await Promise.all([1, 2, 3, 4, 5, 6].map(async (number) => { const file = path.join(images, `scene${number}.png`); await fs.writeFile(file, PNG); return file; }));
  await projects.save(project);
  const previews = new LocalVideoPreviewService(projects, projectsRoot);
  return { projects, previews, service: new LocalVideoSubmissionService(projects, previews, budget) };
}

async function request(previews: LocalVideoPreviewService, requestId = "request_1") {
  const preview = await previews.preview("video_submit", undefined);
  return {
    confirmationId: preview.confirmationId!,
    userRequestId: requestId,
    approved: true as const,
    prompts: preview.previews.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt: `${prompt}\nUser edit ${sceneNumber}` })),
  };
}

describe("local video submission approval gate", () => {
  it("persists six exact prompt/input-hash checkpoints without any provider call and survives a new instance", async () => {
    const { projects, previews, service } = await setup();
    const body = await request(previews);
    const accepted = await service.start("video_submit", body);
    expect(accepted.acceptedSceneNumbers).toEqual([1, 2, 3, 4, 5, 6]);
    const persisted = await projects.findById("video_submit");
    expect(persisted.workflow_state).toBe(WorkflowState.GeneratingVideos);
    expect(persisted.video_generation_records).toHaveLength(6);
    expect(persisted.video_generation_records).toEqual(expect.arrayContaining([expect.objectContaining({ job_id: accepted.jobId, status: "created", execution_mode: "local_fake_no_provider", input_hash: expect.stringMatching(/^[a-f0-9]{64}$/), prompt: body.prompts[0]!.prompt })]));
    expect(persisted.lore_context.video_submission).toMatchObject({ job_id: accepted.jobId, maximum_provider_calls: 6, estimated_cost_usd: 1.5 });
    const restarted = new LocalVideoSubmissionService(projects, previews);
    await expect(restarted.start("video_submit", body)).resolves.toEqual(accepted);
  });

  it("rejects unapproved/malformed IDs, stale image confirmation, duplicate request-ID input changes, and over-budget submissions", async () => {
    const { projects, previews, service } = await setup();
    const body = await request(previews);
    await expect(service.start("video_submit", { ...body, approved: false })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.start("video_submit", { ...body, userRequestId: "contains space" })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const changed = await projects.findById("video_submit"); changed.style_profile = { aspect: "16:9" }; await projects.save(changed);
    await expect(service.start("video_submit", body)).rejects.toMatchObject({ response: { code: "VIDEO_CONFIRMATION_STALE" } });

    const fresh = await request(previews);
    await service.start("video_submit", fresh);
    const project = await projects.findById("video_submit");
    project.workflow_state = WorkflowState.WaitingForVideoConfirmation; await projects.save(project);
    await expect(service.start("video_submit", { ...fresh, prompts: fresh.prompts.map((item, index) => index ? item : { ...item, prompt: "different" }) })).rejects.toMatchObject({ response: { code: "VIDEO_REQUEST_ID_CONFLICT" } });
    const budgeted = await setup(1);
    await expect(budgeted.service.start("video_submit", await request(budgeted.previews))).rejects.toMatchObject({ response: { code: "VIDEO_BUDGET_EXCEEDED" } });
  });

  it("uses input hashes to idempotently return an existing job even with a new user request ID", async () => {
    const { projects, previews, service } = await setup();
    const first = await request(previews, "request_1");
    const accepted = await service.start("video_submit", first);
    const project = await projects.findById("video_submit"); project.workflow_state = WorkflowState.WaitingForVideoConfirmation; await projects.save(project);
    const retry = { ...first, userRequestId: "request_2" };
    await expect(service.start("video_submit", retry)).resolves.toEqual(accepted);
  });
});
