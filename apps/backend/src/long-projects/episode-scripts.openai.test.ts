import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { LongProjectsService } from "./long-projects.service.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { OpenAiBudget } from "../providers/openai-budget.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };

function aiScene(number: number) {
  return {
    number, description: `AI scene ${number}`, visual_action: "AI visual action", start_motion: "AI start", main_motion: "AI main", end_motion: "AI end",
    shot_size: "medium shot", camera_angle: "eye level", composition: "centered", lens_feel: "natural", focus_subject: "hero",
    camera_motion: "slow push in", environment_motion: "wind moves the grass", motion_speed: "normal", motion_intensity: "moderate",
    expression_change: "calm to determined", continuity_hint: "continues previous scene", narration: `AI narration for scene ${number}`,
  };
}
function aiStory(sceneCount: number) {
  return { title: "AI Episode Script", synopsis: "AI synopsis", ending: "AI ending", scenes: Array.from({ length: sceneCount }, (_, index) => aiScene(index + 1)) };
}
function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } } as unknown as Response;
}
function responsesBody(result: unknown): unknown {
  return { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }] };
}

async function setupWithConnectedOpenAi(sceneCount = 6) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-scripts-openai-"));
  const projectsRoot = path.join(root, "projects");
  const settingsRepository = new ProviderSettingsRepository(root);
  const providerSettings = new ProviderSettingsService(settingsRepository);
  await providerSettings.save("openai", { value: "sk-test-key-1234567890" });
  const budget = new OpenAiBudget(root, 10);
  const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings: { ...settings, sceneCount } });
  const preview = await projects.preview("long");
  await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
  const subject = new EpisodeScriptsService(projectsRoot, providerSettings, budget);
  return { root, projectsRoot, providerSettings, budget, subject };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("real OpenAI Long Episode script generation", () => {
  it("calls the real story adapter with a five-section prompt and saves the parsed script, including narration", async () => {
    const { subject } = await setupWithConnectedOpenAi();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody(aiStory(6))));
    vi.stubGlobal("fetch", fetchMock);

    const generated = await subject.generate("long", 1, { userRequestId: "episode-scripts.openai-script-1" });
    expect(generated.episode).toMatchObject({ status: "script_review", approved: false, scriptRevision: 1 });
    expect(generated.episode.script).toMatchObject({ title: "AI Episode Script", synopsis: "AI synopsis", ending: "AI ending" });
    expect(generated.episode.script?.scenes).toHaveLength(6);
    expect(generated.episode.script?.scenes.every((scene) => scene.narration?.startsWith("AI narration"))).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init.body)) as { input: string };
    expect(body.input).toContain("[1. 작업 목표]");
    expect(body.input).toContain("[3. Episode 제작 Context]");
    expect(body.input).toContain("내레이션");
  });

  it("assembles the Episode context from the story bible, project settings, and outline into the prompt", async () => {
    const { subject, projectsRoot } = await setupWithConnectedOpenAi();
    const biblePath = path.join(projectsRoot, "long", "long_story", "story_bible.json");
    const bible = JSON.parse(await fs.readFile(biblePath, "utf8")) as Record<string, unknown>;
    bible.basic = { premise: "고유한 세계관 전제" };
    await fs.writeFile(biblePath, JSON.stringify(bible, null, 2));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody(aiStory(6))));
    vi.stubGlobal("fetch", fetchMock);

    await subject.generate("long", 1, { userRequestId: "episode-scripts.openai-script-2" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { input: string };
    expect(body.input).toContain("고유한 세계관 전제");
  });

  it("leaves a stale settings copy in the Story Bible out of the prompt, while keeping what only lives there", async () => {
    // `create()` used to copy eight settings fields into `basic`, and settings edits never reached that copy, so
    // an edited project sent the model both versions. Written here the way an older project actually looks: a
    // stale title sitting in `basic` next to a line somebody typed themselves. The settings own the title, so
    // only their value goes; the typed line has no duplicate anywhere and stays.
    const { subject, projectsRoot } = await setupWithConnectedOpenAi();
    const biblePath = path.join(projectsRoot, "long", "long_story", "story_bible.json");
    const bible = JSON.parse(await fs.readFile(biblePath, "utf8")) as Record<string, unknown>;
    bible.basic = { title: "지워진 옛 제목", theme: "옛 주제", premise: "손으로 적은 전제" };
    await fs.writeFile(biblePath, JSON.stringify(bible, null, 2));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody(aiStory(6))));
    vi.stubGlobal("fetch", fetchMock);

    await subject.generate("long", 1, { userRequestId: "episode-scripts.openai-stale-basic" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { input: string };
    expect(body.input).not.toContain("지워진 옛 제목");
    expect(body.input).not.toContain("옛 주제");
    expect(body.input).toContain("손으로 적은 전제");
  });

  it("falls back to the local-fake script generator, never calling fetch, when no OpenAI credential is configured", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-scripts-openai-"));
    const projectsRoot = path.join(root, "projects");
    const projects = new LongProjectsService(projectsRoot);
    await projects.create({ projectId: "long", settings });
    const preview = await projects.preview("long");
    await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
    const subject = new EpisodeScriptsService(projectsRoot);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const generated = await subject.generate("long", 1, { userRequestId: "episode-scripts.openai-script-3" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(generated.episode.script?.title).toContain("Local Episode Script");
  });

  it("blocks the real request and keeps the episode in outline_ready when the monthly budget is already spent", async () => {
    const { subject, budget } = await setupWithConnectedOpenAi();
    await budget.record("some-other-project", "long_story_outline", true, 10, new Date());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(subject.generate("long", 1, { userRequestId: "episode-scripts.openai-script-4" })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_SCRIPT_BUDGET_EXCEEDED" } });

    expect(fetchMock).not.toHaveBeenCalled();
    expect((await subject.get("long", 1)).episode.status).toBe("outline_ready");
  });

  it("classifies a real provider failure, records failed budget usage, and keeps the episode in outline_ready", async () => {
    const { subject, root: usedRoot } = await setupWithConnectedOpenAi();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "invalid_api_key" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(subject.generate("long", 1, { userRequestId: "episode-scripts.openai-script-5" })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_SCRIPT_PROVIDER_ERROR", details: { category: "authentication" } } });

    const usage = JSON.parse(await fs.readFile(path.join(usedRoot!, "api_budget_usage.json"), "utf8")) as Array<{ succeeded: boolean }>;
    expect(usage).toEqual([expect.objectContaining({ succeeded: false })]);
    expect((await subject.get("long", 1)).episode.status).toBe("outline_ready");
  });

  it("rejects a malformed provider script response as a provider error, without saving anything", async () => {
    const { subject } = await setupWithConnectedOpenAi();
    const malformed = aiStory(6); malformed.scenes = malformed.scenes.slice(0, 5);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody(malformed)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(subject.generate("long", 1, { userRequestId: "episode-scripts.openai-script-6" })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_SCRIPT_PROVIDER_ERROR" } });

    expect((await subject.get("long", 1)).episode.status).toBe("outline_ready");
  });

  it("sizes the schema and prompt to the project's own scene count, not a hardcoded six", async () => {
    const { subject } = await setupWithConnectedOpenAi(9);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody(aiStory(9))));
    vi.stubGlobal("fetch", fetchMock);

    const generated = await subject.generate("long", 1, { userRequestId: "episode-scripts.openai-script-7" });
    expect(generated.episode.script?.scenes).toHaveLength(9);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { text: { format: { schema: { properties: { scenes: { minItems: number; maxItems: number } } } } } };
    expect(body.text.format.schema.properties.scenes).toMatchObject({ minItems: 9, maxItems: 9 });
  });
});
