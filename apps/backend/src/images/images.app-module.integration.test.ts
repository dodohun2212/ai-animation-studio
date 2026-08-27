import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";
import { AppModule } from "../app.module.js";
import { LocalProjectAssetMappingsRepository, scriptFingerprint } from "../mappings/mappings.repository.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";

let root: string | undefined;
let app: INestApplication | undefined;
let previousLearningRoot: string | undefined;
let previousProjectsRoot: string | undefined;
let previousSettingsRoot: string | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.close(); app = undefined;
  if (previousLearningRoot === undefined) delete process.env.LEARNING_DATA_ROOT; else process.env.LEARNING_DATA_ROOT = previousLearningRoot;
  if (previousProjectsRoot === undefined) delete process.env.PROJECTS_ROOT; else process.env.PROJECTS_ROOT = previousProjectsRoot;
  if (previousSettingsRoot === undefined) delete process.env.PROVIDER_SETTINGS_ROOT; else process.env.PROVIDER_SETTINGS_ROOT = previousSettingsRoot;
  previousLearningRoot = undefined; previousProjectsRoot = undefined; previousSettingsRoot = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined;
});

describe.sequential("local image generation HTTP route", () => {
  it("requires explicit approval and writes six local PNGs without a provider", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "images-http-"));
    const projectsRoot = path.join(root, "projects");
    const projects = new LocalProjectRepository(projectsRoot);
    const project = createStoredProject("image_http", "Image HTTP", "2026-08-22T00:00:00.000Z");
    project.workflow_state = WorkflowState.AssetMappingApproved; project.script_revision = 1; project.mapping_revision = 1;
    project.scenes = [1, 2, 3, 4, 5, 6].map((number) => ({ number, description: `scene ${number}`, main_motion: `motion ${number}`, visual_action: `action ${number}` }));
    await projects.create(project);
    const mappings = new LocalProjectAssetMappingsRepository(projectsRoot);
    await mappings.saveReview("image_http", { project_id: "image_http", mapping_revision: 1, script_revision: 1, script_fingerprint: scriptFingerprint(project.scenes), status: "approved", approved_at: "2026-08-22T00:00:00.000Z", approved_by: "user", text_only_confirmed: true, legacy_confirmed: false, reviewed_scenes: [1, 2, 3, 4, 5, 6] });
    previousLearningRoot = process.env.LEARNING_DATA_ROOT; previousProjectsRoot = process.env.PROJECTS_ROOT;
    process.env.LEARNING_DATA_ROOT = root; delete process.env.PROJECTS_ROOT;
    // Isolated even though this test never intends to touch a real provider: PROVIDER_SETTINGS_ROOT defaults to
    // process.cwd(), and this app is the real AppModule over a real HTTP server — without this, "no provider
    // connected" is only true by accident of whatever real credentials happen to sit in apps/backend/.env on
    // whichever machine runs this suite (docs/06_DECISIONS.md D-016: real, unmocked Runway/OpenAI calls from this
    // exact test shape, on this exact gap, are the leading suspect for real unexplained provider charges).
    previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT; process.env.PROVIDER_SETTINGS_ROOT = root;
    app = await NestFactory.create(AppModule, { logger: false }); await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const denied = await fetch(`${base}/projects/image_http/images/generations`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(denied.status).toBe(400);
    const response = await fetch(`${base}/projects/image_http/images/generations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: true }) });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [], project: { workflowState: WorkflowState.ImagesReview } });
    await expect(fs.readFile(path.join(projectsRoot, "image_http", "images", "scene6.png"))).resolves.toEqual(expect.any(Buffer));
    const regenerated = await fetch(`${base}/projects/image_http/images/review/1/regenerate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: true }) });
    expect(regenerated.status).toBe(201);
    expect(await regenerated.json()).toMatchObject({ sceneNumber: 1, project: { workflowState: WorkflowState.ImagesReview } });
    await expect(fs.readFile(path.join(projectsRoot, "image_http", "images", "originals", "scene1_v001.png"))).resolves.toEqual(expect.any(Buffer));

    const content = await fetch(`${base}/projects/image_http/images/6/content`);
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await content.arrayBuffer())).toEqual(await fs.readFile(path.join(projectsRoot, "image_http", "images", "scene6.png")));
    const missing = await fetch(`${base}/projects/image_http/images/7/content`);
    expect(missing.status).toBe(404);
  });

  it("calls the real OpenAI Images endpoint once a credential is saved and connected over the same running app", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "images-http-"));
    const projectsRoot = path.join(root, "projects");
    const projects = new LocalProjectRepository(projectsRoot);
    const project = createStoredProject("image_http_real", "Image HTTP Real", "2026-08-22T00:00:00.000Z");
    project.workflow_state = WorkflowState.AssetMappingApproved; project.script_revision = 1; project.mapping_revision = 1;
    project.scenes = [1, 2, 3, 4, 5, 6].map((number) => ({ number, description: `scene ${number}`, main_motion: `motion ${number}`, visual_action: `action ${number}` }));
    await projects.create(project);
    const mappings = new LocalProjectAssetMappingsRepository(projectsRoot);
    await mappings.saveReview("image_http_real", { project_id: "image_http_real", mapping_revision: 1, script_revision: 1, script_fingerprint: scriptFingerprint(project.scenes), status: "approved", approved_at: "2026-08-22T00:00:00.000Z", approved_by: "user", text_only_confirmed: true, legacy_confirmed: false, reviewed_scenes: [1, 2, 3, 4, 5, 6] });
    previousLearningRoot = process.env.LEARNING_DATA_ROOT; previousProjectsRoot = process.env.PROJECTS_ROOT;
    process.env.LEARNING_DATA_ROOT = root; delete process.env.PROJECTS_ROOT;
    previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT; process.env.PROVIDER_SETTINGS_ROOT = root;
    app = await NestFactory.create(AppModule, { logger: false }); await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    const saveResponse = await fetch(`${base}/settings/providers/openai/credential`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "sk-image-app-module-test-000" }),
    });
    expect(saveResponse.status).toBe(200);

    const realFetch = fetch;
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://api.openai.com/v1/images/generations") {
        return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: pngBase64 }] }), headers: { get: () => null } } as unknown as Response;
      }
      return realFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const response = await fetch(`${base}/projects/image_http_real/images/generations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: true }) });
    expect(response.status).toBe(201);
    const openAiCalls = fetchSpy.mock.calls.filter(([url]) => url === "https://api.openai.com/v1/images/generations");
    expect(openAiCalls).toHaveLength(6);
    const raw = JSON.parse(await fs.readFile(path.join(projectsRoot, "image_http_real", "project.json"), "utf8")) as Record<string, unknown>;
    expect(raw.image_generation_records).toEqual(expect.arrayContaining([expect.objectContaining({ adapter: "gpt-image-2", image_api_calls: 1 })]));
    const usage = JSON.parse(await fs.readFile(path.join(root, "api_budget_usage.json"), "utf8")) as unknown[];
    expect(usage).toHaveLength(6);
  });
});
