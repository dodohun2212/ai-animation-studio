import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";
import { AppModule } from "../app.module.js";
import { LocalProjectAssetMappingsRepository, scriptFingerprint } from "../mappings/mappings.repository.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";

let root: string | undefined;
let app: INestApplication | undefined;
let previousLearningRoot: string | undefined;
let previousProjectsRoot: string | undefined;
afterEach(async () => {
  await app?.close(); app = undefined;
  if (previousLearningRoot === undefined) delete process.env.LEARNING_DATA_ROOT; else process.env.LEARNING_DATA_ROOT = previousLearningRoot;
  if (previousProjectsRoot === undefined) delete process.env.PROJECTS_ROOT; else process.env.PROJECTS_ROOT = previousProjectsRoot;
  previousLearningRoot = undefined; previousProjectsRoot = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined;
});

describe.sequential("local image generation HTTP route", () => {
  it("requires explicit approval and writes six local PNGs without a provider", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "images-http-"));
    const projectsRoot = path.join(root, "projects");
    const projects = new LocalProjectRepository(projectsRoot);
    const project = createStoredProject("image_http", "Image HTTP", "2026-08-22T00:00:00.000Z");
    project.workflow_state = WorkflowState.AssetMappingApproved; project.script_revision = 1; project.mapping_revision = 1;
    project.scenes = [1, 2, 3, 4, 5, 6].map((number) => ({ number, description: `scene ${number}`, main_motion: `motion ${number}` }));
    await projects.create(project);
    const mappings = new LocalProjectAssetMappingsRepository(projectsRoot);
    await mappings.saveReview("image_http", { project_id: "image_http", mapping_revision: 1, script_revision: 1, script_fingerprint: scriptFingerprint(project.scenes), status: "approved", approved_at: "2026-08-22T00:00:00.000Z", approved_by: "user", text_only_confirmed: true, legacy_confirmed: false, reviewed_scenes: [1, 2, 3, 4, 5, 6] });
    previousLearningRoot = process.env.LEARNING_DATA_ROOT; previousProjectsRoot = process.env.PROJECTS_ROOT;
    process.env.LEARNING_DATA_ROOT = root; delete process.env.PROJECTS_ROOT;
    app = await NestFactory.create(AppModule, { logger: false }); await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const denied = await fetch(`${base}/projects/image_http/images/generations`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(denied.status).toBe(400);
    const response = await fetch(`${base}/projects/image_http/images/generations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: true }) });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [], project: { workflowState: WorkflowState.ImagesReview } });
    await expect(fs.readFile(path.join(projectsRoot, "image_http", "images", "scene6.png"))).resolves.toEqual(expect.any(Buffer));
  });
});
