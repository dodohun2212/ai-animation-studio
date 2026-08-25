import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeAssetMappingsService } from "./episode-asset-mappings.service.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { LongProjectsService } from "./long-projects.service.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { OpenAiBudget } from "../providers/openai-budget.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=";
let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, episodeDurationSeconds: 30, platform: "YouTube Shorts" as const, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "" };

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } } as unknown as Response;
}

async function setupWithConnectedOpenAi() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-images-openai-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings });
  const preview = await projects.preview("long");
  await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot);
  await scripts.generate("long", 1, {});
  await scripts.approve("long", 1, { approved: true });
  const assets = new LocalAssetsRepository(root);
  const mappingsService = new EpisodeAssetMappingsService(projectsRoot, assets);
  const mapping = await mappingsService.begin("long", 1, { textOnlyConfirmed: true });
  await mappingsService.approve("long", 1, { approved: true, scriptFingerprint: mapping.review.scriptFingerprint });
  const settingsRepository = new ProviderSettingsRepository(root);
  const providerSettings = new ProviderSettingsService(settingsRepository);
  await providerSettings.save("openai", { value: "sk-test-key-1234567890" });
  const budget = new OpenAiBudget(root, 10);
  const images = new EpisodeImagesService(projectsRoot, assets, mappingsService, providerSettings, budget);
  return { root, projectsRoot, assets, mappingsService, providerSettings, budget, images };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("real OpenAI Episode image generation", () => {
  it("calls the real adapter for all six scenes, assembles the composition prompt (never the narrated description), and reports the budget", async () => {
    const { images } = await setupWithConnectedOpenAi();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: PNG_BASE64 }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await images.generate("long", 1, { approved: true });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // No confirmed Asset Mapping candidates in this minimal setup, so this goes through the plain
    // images/generations JSON path rather than images/edits FormData (no reference images to attach).
    const { prompt } = JSON.parse(init.body as string) as { prompt: string };
    expect(prompt).toContain("Scene:");
    expect(prompt).not.toMatch(/says|dialogue/i);
    expect(result.budget?.monthlyLimitUsd).toBe(10);
    expect(result.budget?.spentUsd).toBeCloseTo(0.6, 8);
    expect(result.budget?.remainingUsd).toBeCloseTo(9.4, 8);
    expect(result.budget?.canSpend).toBe(true);
  });

  it("falls back to the local fake adapter, never calling fetch, when no OpenAI credential is configured", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-images-openai-"));
    const projectsRoot = path.join(root, "projects");
    const projects = new LongProjectsService(projectsRoot);
    await projects.create({ projectId: "long", settings });
    const preview = await projects.preview("long");
    await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
    const scripts = new EpisodeScriptsService(projectsRoot);
    await scripts.generate("long", 1, {});
    await scripts.approve("long", 1, { approved: true });
    const assets = new LocalAssetsRepository(root);
    const mappingsService = new EpisodeAssetMappingsService(projectsRoot, assets);
    const mapping = await mappingsService.begin("long", 1, { textOnlyConfirmed: true });
    await mappingsService.approve("long", 1, { approved: true, scriptFingerprint: mapping.review.scriptFingerprint });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const images = new EpisodeImagesService(projectsRoot, assets, mappingsService);
    const result = await images.generate("long", 1, { approved: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.generatedSceneNumbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.budget).toBeUndefined();
    await expect(fs.readFile(path.join(projectsRoot, "long", "long_story", "Episode01", "images", "scene1.png"))).resolves.toEqual(PNG);
  });

  it("blocks the real request and restores asset_mapping_approved when the monthly budget is already spent", async () => {
    const { images, budget } = await setupWithConnectedOpenAi();
    await budget.record("some-other-project", "image", true, 10, new Date());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(images.generate("long", 1, { approved: true })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_IMAGES_BUDGET_EXCEEDED" } });

    expect(fetchMock).not.toHaveBeenCalled();
    expect((await images.get("long", 1).catch((error: unknown) => error)) as { response?: { code: string } }).toMatchObject({ response: { code: "LONG_EPISODE_IMAGES_NOT_ALLOWED" } });
  });

  it("classifies a real provider failure and records failed budget usage", async () => {
    const { images, root: usedRoot } = await setupWithConnectedOpenAi();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "invalid_api_key" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(images.generate("long", 1, { approved: true })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_IMAGES_PROVIDER_ERROR", details: { category: "authentication" } } });

    const usage = JSON.parse(await fs.readFile(path.join(usedRoot!, "api_budget_usage.json"), "utf8")) as Array<{ succeeded: boolean }>;
    expect(usage).toEqual([expect.objectContaining({ succeeded: false })]);
  });

  it("regenerates one scene via the real adapter and reports a retry cost estimate", async () => {
    const { images } = await setupWithConnectedOpenAi();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: PNG_BASE64 }] }));
    vi.stubGlobal("fetch", fetchMock);
    await images.generate("long", 1, { approved: true });
    for (const scene of [1, 2, 3, 4, 5] as const) await images.approve("long", 1, String(scene), { approved: true });
    await images.approve("long", 1, "6", { approved: true });

    const regenerated = await images.regenerate("long", 1, "3", { approved: true });

    expect(fetchMock).toHaveBeenCalledTimes(7); // six from generate() + one regeneration
    expect(regenerated.retryEstimate).toEqual({
      perSceneCostUsd: 0.10,
      budget: { monthlyLimitUsd: 10, spentUsd: expect.closeTo(0.7, 8), remainingUsd: expect.closeTo(9.3, 8), estimatedRequestCostUsd: 0.10, canSpend: true },
    });
  });
});
