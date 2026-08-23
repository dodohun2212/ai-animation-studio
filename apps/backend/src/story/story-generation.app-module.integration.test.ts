import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";

let app: INestApplication | undefined;
let root: string | undefined;
let previousRoot: string | undefined;
let previousSettingsRoot: string | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.close(); app = undefined;
  if (previousRoot === undefined) delete process.env.LEARNING_DATA_ROOT;
  else process.env.LEARNING_DATA_ROOT = previousRoot;
  previousRoot = undefined;
  if (previousSettingsRoot === undefined) delete process.env.PROVIDER_SETTINGS_ROOT;
  else process.env.PROVIDER_SETTINGS_ROOT = previousSettingsRoot;
  previousSettingsRoot = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

const SCENE = (number: number) => ({
  number, description: `d${number}`, visual_action: "v", start_motion: "s", main_motion: "m", end_motion: "e",
  shot_size: "medium", camera_angle: "eye", composition: "centered", lens_feel: "natural", focus_subject: "hero",
  camera_motion: "forward", environment_motion: "ambient", motion_speed: "normal", motion_intensity: "moderate",
  expression_change: "focused", continuity_hint: "continue",
});
const VALID_STORY = { title: "t", synopsis: "s", ending: "e", scenes: [1, 2, 3, 4, 5, 6].map(SCENE) };

describe.sequential("real AppModule Story HTTP smoke — real OpenAI wiring boots and stays fake without a connected key", () => {
  async function bootAppWithProject(): Promise<{ base: string }> {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "story-app-module-"));
    const templateRoot = path.join(root, "prompts", "story");
    await fs.mkdir(templateRoot, { recursive: true });
    await fs.writeFile(path.join(templateRoot, "story_generation.txt"), "topic=$topic", "utf8");
    const projects = new LocalProjectRepository(path.join(root, "learning_data", "projects"));
    await projects.create(createStoredProject("app_module_story", "a lighthouse", "2026-08-22T00:00:00.000Z"));
    previousRoot = process.env.LEARNING_DATA_ROOT;
    process.env.LEARNING_DATA_ROOT = path.join(root, "learning_data");
    process.env.PROMPTS_ROOT = path.join(root, "prompts");
    previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT;
    process.env.PROVIDER_SETTINGS_ROOT = root;
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    return { base: `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}` };
  }

  it("boots the full module graph and uses the local fake adapter when no OpenAI credential is configured", async () => {
    const { base } = await bootAppWithProject();

    const preview = await (await fetch(`${base}/projects/app_module_story/story/preview`, { method: "POST" })).json() as { preview: { originalPrompt: string; originalPromptSha256: string } };
    const approveResponse = await fetch(`${base}/projects/app_module_story/story/approval`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ originalPromptSha256: preview.preview.originalPromptSha256, prompt: preview.preview.originalPrompt, approved: true }),
    });
    expect(approveResponse.status).toBe(201);
    const raw = JSON.parse(await fs.readFile(path.join(root!, "learning_data", "projects", "app_module_story", "project.json"), "utf8")) as Record<string, unknown>;
    expect((raw.lore_context as Record<string, unknown>).story_prompt_request).toMatchObject({ model: "local-fake-story-adapter" });
  });

  it("calls the real OpenAI Responses endpoint once a credential is saved and connected over the same running app", async () => {
    const { base } = await bootAppWithProject();

    const saveResponse = await fetch(`${base}/settings/providers/openai/credential`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "sk-app-module-test-key-000000" }),
    });
    expect(saveResponse.status).toBe(200);

    const realFetch = fetch;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://api.openai.com/v1/responses") {
        return {
          ok: true, status: 200,
          json: async () => ({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(VALID_STORY) }] }] }),
          headers: { get: () => null },
        } as unknown as Response;
      }
      return realFetch(url, init); // pass this test's own calls to the local Nest server through untouched
    });
    vi.stubGlobal("fetch", fetchSpy);

    const preview = await (await fetch(`${base}/projects/app_module_story/story/preview`, { method: "POST" })).json() as { preview: { originalPrompt: string; originalPromptSha256: string } };
    const approveResponse = await fetch(`${base}/projects/app_module_story/story/approval`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ originalPromptSha256: preview.preview.originalPromptSha256, prompt: preview.preview.originalPrompt, approved: true }),
    });
    expect(approveResponse.status).toBe(201);
    expect(fetchSpy).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({ method: "POST" }));
    const raw = JSON.parse(await fs.readFile(path.join(root!, "learning_data", "projects", "app_module_story", "project.json"), "utf8")) as Record<string, unknown>;
    expect((raw.lore_context as Record<string, unknown>).story_prompt_request).toMatchObject({ model: "gpt-5.6-luna" });
    expect(raw.story).toEqual(VALID_STORY);
    const usage = JSON.parse(await fs.readFile(path.join(root!, "learning_data", "api_budget_usage.json"), "utf8")) as unknown[];
    expect(usage).toHaveLength(1);
  });
});
