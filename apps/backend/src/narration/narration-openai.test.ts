import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { parseShortProjectSettings, applyShortProjectSettings } from "../projects/project-settings.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { OpenAiBudget } from "../providers/openai-budget.js";
import { LocalNarrationGenerationService } from "./local-narration-generation.service.js";
import { NarrationReviewService } from "./narration-review.service.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const SETTINGS_REQUEST = {
  projectName: "narration openai test", topic: "topic", genre: "", mood: "", character: "", lore: "", fullStory: "",
  sceneCount: 2, clipDurationSeconds: 5, additionalNotes: "", styleNotes: {}, narrationEnabled: true, subtitlesEnabled: false,
};
const AUDIO_BYTES = Buffer.from("fake mp3 bytes from openai");

function audioResponse(status: number, bytes: Buffer, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300, status,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    json: async () => ({}),
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}
function errorResponse(status: number, body: unknown): Response {
  return {
    ok: false, status,
    arrayBuffer: async () => new ArrayBuffer(0),
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "narration-openai-")); roots.push(root);
  const projectsRoot = path.join(root, "learning_data", "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("narr", "topic", "2026-08-22T00:00:00.000Z");
  const settings = parseShortProjectSettings(SETTINGS_REQUEST);
  const withSettings = applyShortProjectSettings(project, settings, "2026-08-22T00:00:00.000Z");
  withSettings.scenes = [1, 2].map((number) => ({ number, description: `scene ${number}`, narration: `narration line ${number}` }));
  await projects.create(withSettings);
  const settingsRepository = new ProviderSettingsRepository(root);
  const providerSettings = new ProviderSettingsService(settingsRepository);
  await providerSettings.save("openai", { value: "sk-test-key-1234567890" });
  const budget = new OpenAiBudget(root, 10);
  const generation = new LocalNarrationGenerationService(projects, projectsRoot, undefined, providerSettings, budget);
  const reviews = new NarrationReviewService(projects, generation, providerSettings, budget);
  return { root, projectsRoot, projects, providerSettings, budget, generation, reviews };
}

describe("narration generation with a connected OpenAI credential", () => {
  it("calls the real TTS adapter for every scene with narration text and reports budget", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(200, AUDIO_BYTES));
    vi.stubGlobal("fetch", fetchMock);
    const { generation } = await setup();
    const result = await generation.generate("narr", { approved: true });
    expect(result.generatedSceneNumbers).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(JSON.parse(String(init.body))).toMatchObject({ input: "narration line 1" });
    expect(result.budget).toMatchObject({ spentUsd: expect.closeTo(0.02, 8) });
    const bytes = await fs.readFile(generation.narrationPath("narr", 1));
    expect(bytes).toEqual(AUDIO_BYTES);
  });

  it("falls back to local-fake audio when no OpenAI credential is connected", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { projectsRoot, projects } = await setup();
    const noCredentialGeneration = new LocalNarrationGenerationService(projects, projectsRoot);
    const result = await noCredentialGeneration.generate("narr", { approved: true });
    expect(result.budget).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks generation before any request when the estimate would exceed the remaining monthly budget", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(200, AUDIO_BYTES));
    vi.stubGlobal("fetch", fetchMock);
    const { generation, budget } = await setup();
    await budget.record("other-project", "tts", true, 9.995);
    await expect(generation.generate("narr", { approved: true })).rejects.toMatchObject({ response: { code: "NARRATION_BUDGET_EXCEEDED" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies a provider error and still records the failed spend attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401, { error: { code: "invalid_api_key" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { generation, budget } = await setup();
    await expect(generation.generate("narr", { approved: true })).rejects.toMatchObject({ response: { code: "NARRATION_PROVIDER_ERROR", details: { category: "authentication" } } });
    expect(await budget.spentThisMonth()).toBeCloseTo(0.01, 8);
  });

  it("regenerates one scene with a real call and reports a retryEstimate", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(200, AUDIO_BYTES));
    vi.stubGlobal("fetch", fetchMock);
    const { generation, reviews } = await setup();
    await generation.generate("narr", { approved: true });
    fetchMock.mockClear();
    const result = await reviews.regenerate("narr", "1", { approved: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.retryEstimate).toMatchObject({ perSceneCostUsd: 0.01 });
  });
});
