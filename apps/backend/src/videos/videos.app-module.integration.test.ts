import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";

import { AppModule } from "../app.module.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
let app: INestApplication | undefined;
let root: string | undefined;
let previousLearningRoot: string | undefined;

afterEach(async () => {
  await app?.close(); app = undefined;
  if (previousLearningRoot === undefined) delete process.env.LEARNING_DATA_ROOT; else process.env.LEARNING_DATA_ROOT = previousLearningRoot;
  previousLearningRoot = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); root = undefined;
});

it("serves a restart-safe local video preview and explicit fake submission without paths or provider work", async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "video-preview-http-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("video_http", "topic", "2026-08-22T00:00:00.000Z");
  project.workflow_state = WorkflowState.WaitingForVideoConfirmation;
  project.scenes = [1, 2, 3, 4, 5, 6].map((number) => ({ number, description: `d${number}`, visual_action: `a${number}`, start_motion: `s${number}`, main_motion: `m${number}`, end_motion: `e${number}`, shot_size: "medium", camera_angle: "eye", composition: "center", lens_feel: "natural", focus_subject: "subject", camera_motion: "dolly", environment_motion: "wind", motion_speed: "normal", motion_intensity: "moderate", expression_change: "calm", continuity_hint: "continue" }));
  await projects.create(project);
  const images = path.join(projectsRoot, "video_http", "images"); await fs.mkdir(images, { recursive: true });
  project.generated_images = await Promise.all([1, 2, 3, 4, 5, 6].map(async (number) => { const file = path.join(images, `scene${number}.png`); await fs.writeFile(file, PNG); return file; }));
  await projects.save(project);
  previousLearningRoot = process.env.LEARNING_DATA_ROOT; process.env.LEARNING_DATA_ROOT = root;
  app = await NestFactory.create(AppModule, { logger: false }); await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  const response = await fetch(`${base}/projects/video_http/videos/preview`, { method: "POST" });
  expect(response.status).toBe(201);
  const body = await response.json() as { confirmationId: string; previews: Array<{ sceneNumber: number; prompt: string }> };
  expect(body.previews).toHaveLength(6);
  expect(body.previews[0]).toMatchObject({ sceneNumber: 1, model: "gen4_turbo", ratio: "720:1280", durationSeconds: 5, estimatedCostUsd: 0.25 });
  expect(JSON.stringify(body)).not.toContain(projectsRoot);
  expect((await new LocalProjectRepository(projectsRoot).findById("video_http")).workflow_state).toBe(WorkflowState.WaitingForVideoConfirmation);
  const accepted = await fetch(`${base}/projects/video_http/videos/generations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmationId: body.confirmationId, userRequestId: "http_request_1", approved: true, prompts: body.previews.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) }),
  });
  expect(accepted.status).toBe(201);
  expect(await accepted.json()).toMatchObject({ acceptedSceneNumbers: [1, 2, 3, 4, 5, 6], jobId: expect.any(String) });
  const reloaded = await new LocalProjectRepository(projectsRoot).findById("video_http");
  expect(reloaded.workflow_state).toBe(WorkflowState.GeneratingVideos);
  expect(reloaded.video_generation_records).toHaveLength(6);
  expect(JSON.stringify(reloaded)).not.toContain(projectsRoot);
});

it("serves a generated scene's mp4 over HTTP once the local fake workflow completes, independent of jobId", async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "video-content-http-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("video_content_http", "topic", "2026-08-22T00:00:00.000Z");
  project.workflow_state = WorkflowState.WaitingForVideoConfirmation;
  project.scenes = [1, 2, 3, 4, 5, 6].map((number) => ({ number, description: `d${number}`, visual_action: `a${number}`, start_motion: `s${number}`, main_motion: `m${number}`, end_motion: `e${number}`, shot_size: "medium", camera_angle: "eye", composition: "center", lens_feel: "natural", focus_subject: "subject", camera_motion: "dolly", environment_motion: "wind", motion_speed: "normal", motion_intensity: "moderate", expression_change: "calm", continuity_hint: "continue" }));
  await projects.create(project);
  const images = path.join(projectsRoot, "video_content_http", "images"); await fs.mkdir(images, { recursive: true });
  project.generated_images = await Promise.all([1, 2, 3, 4, 5, 6].map(async (number) => { const file = path.join(images, `scene${number}.png`); await fs.writeFile(file, PNG); return file; }));
  await projects.save(project);
  previousLearningRoot = process.env.LEARNING_DATA_ROOT; process.env.LEARNING_DATA_ROOT = root;
  app = await NestFactory.create(AppModule, { logger: false }); await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

  const missingBeforeGeneration = await fetch(`${base}/projects/video_content_http/videos/1/content`);
  expect(missingBeforeGeneration.status).toBe(404);

  const previewResponse = await fetch(`${base}/projects/video_content_http/videos/preview`, { method: "POST" });
  const preview = await previewResponse.json() as { confirmationId: string; previews: Array<{ sceneNumber: number; prompt: string }> };
  const acceptedResponse = await fetch(`${base}/projects/video_content_http/videos/generations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmationId: preview.confirmationId, userRequestId: "http_request_1", approved: true, prompts: preview.previews.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) }),
  });
  const accepted = await acceptedResponse.json() as { jobId: string };

  await expect.poll(async () => {
    const progress = await (await fetch(`${base}/projects/video_content_http/videos/generations/${accepted.jobId}`)).json() as { status: string };
    return progress.status;
  }, { timeout: 10000 }).toBe("succeeded");

  const content = await fetch(`${base}/projects/video_content_http/videos/6/content`);
  expect(content.status).toBe(200);
  expect(content.headers.get("content-type")).toBe("video/mp4");
  expect(Buffer.from(await content.arrayBuffer())).toEqual(await fs.readFile(path.join(projectsRoot, "video_content_http", "videos", "runway", "scene6.mp4")));
  const outOfRange = await fetch(`${base}/projects/video_content_http/videos/7/content`);
  expect(outOfRange.status).toBe(404);
}, 20000);

it("serves the final merged video at /videos/final/content, matched ahead of the :sceneNumber route", async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "video-final-content-http-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("video_final_http", "topic", "2026-08-22T00:00:00.000Z");
  project.workflow_state = WorkflowState.Completed;
  await projects.create(project);
  const finalDirectory = path.join(projectsRoot, "video_final_http", "videos", "final");
  await fs.mkdir(finalDirectory, { recursive: true });
  await fs.writeFile(path.join(finalDirectory, "instagram_reel.mp4"), Buffer.from("final reel bytes"));
  previousLearningRoot = process.env.LEARNING_DATA_ROOT; process.env.LEARNING_DATA_ROOT = root;
  app = await NestFactory.create(AppModule, { logger: false }); await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

  const response = await fetch(`${base}/projects/video_final_http/videos/final/content`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("video/mp4");
  expect(await response.text()).toBe("final reel bytes");

  const missingScene = await fetch(`${base}/projects/video_final_http/videos/1/content`);
  expect(missingScene.status).toBe(404);
});
