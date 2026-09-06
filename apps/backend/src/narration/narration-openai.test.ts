import * as fs from "node:fs/promises";
import { OPENAI_TTS_MODEL } from "./openai-narration-adapter.js";
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

  /**
   * The record names what made the audio, and four call sites wrote that name out by hand while the adapter
   * that actually sends the request reads it from OPENAI_TTS_MODEL. The image and story paths both record from
   * their own constants; narration was the one family that did not, so changing the model would have left every
   * narration record naming a model that produced none of it.
   *
   * Asserted against the constant rather than the string, so re-typing the literal is what turns this red.
   */
  it("records the model the adapter actually calls, not a copy of its name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(200, AUDIO_BYTES));
    vi.stubGlobal("fetch", fetchMock);
    const { generation, projects } = await setup();

    await generation.generate("narr", { approved: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body)) as { model?: string };
    expect(sent.model).toBe(OPENAI_TTS_MODEL);
    const stored = await projects.findById("narr");
    const adapters = stored.narration_generation_records.map((record) => (record as { adapter?: string }).adapter);
    expect(adapters.length).toBeGreaterThan(0);
    expect(adapters.every((adapter) => adapter === OPENAI_TTS_MODEL)).toBe(true);
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

  it("passes a one-off additionalInstruction as the TTS instructions field, never appended to the spoken input", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(200, AUDIO_BYTES));
    vi.stubGlobal("fetch", fetchMock);
    const { generation, reviews, projectsRoot } = await setup();
    await generation.generate("narr", { approved: true });
    fetchMock.mockClear();
    await reviews.regenerate("narr", "1", { approved: true, additionalInstruction: "  더 밝고 신나게  " });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ input: "narration line 1", instructions: "더 밝고 신나게" });
    // Not stored: the persisted record still holds only the spoken narration text.
    const project = JSON.parse(await fs.readFile(path.join(projectsRoot, "narr", "project.json"), "utf8")) as { narration_generation_records: Array<{ narration: string }> };
    expect(project.narration_generation_records[0]!.narration).toBe("narration line 1");
  });

  it("omits instructions when additionalInstruction is blank or absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(200, AUDIO_BYTES));
    vi.stubGlobal("fetch", fetchMock);
    const { generation, reviews } = await setup();
    await generation.generate("narr", { approved: true });
    fetchMock.mockClear();
    await reviews.regenerate("narr", "1", { approved: true, additionalInstruction: "   " });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("instructions");
  });

  it("rejects a non-string additionalInstruction", async () => {
    const { reviews } = await setup();
    await expect(reviews.regenerate("narr", "1", { approved: true, additionalInstruction: 5 })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("keeps the narration OpenAI was already paid for when the ledger goes unreadable mid-run, and says its cost went unrecorded", async () => {
    // Two scenes, and the ledger breaks inside the first paid call — after preflight let it through, before
    // record() writes the cost. Scene 1 is bought, so it is kept; scene 2 is not, and its own preflight reads
    // the same broken file and refuses. Before the fix the `finally` threw from inside the provider call and
    // took scene 1's audio with it, leaving nothing but an instruction to repair a file.
    const { root, projects, generation } = await setup();
    const ledger = path.join(root, "api_budget_usage.json");
    const fetchMock = vi.fn(async () => {
      await fs.writeFile(ledger, "{ not json", "utf8");
      return audioResponse(200, AUDIO_BYTES);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(generation.generate("narr", { approved: true })).rejects.toMatchObject({ response: { code: "BUDGET_LEDGER_UNREADABLE" } });

    expect(fetchMock).toHaveBeenCalledTimes(1); // scene 2 never went out
    expect(await fs.readFile(generation.narrationPath("narr", 1))).toEqual(AUDIO_BYTES);
    const warning = (await projects.findById("narr")).warnings.find((item) => item.includes("api_budget_usage.json"));
    expect(warning).toContain("1번 장면");
    expect(warning).toContain("다시 만들지 마시고");
    expect(await fs.readFile(ledger, "utf8")).toBe("{ not json");
  });

});
