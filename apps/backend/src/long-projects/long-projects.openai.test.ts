import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LongProjectsService } from "./long-projects.service.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { OpenAiBudget } from "../providers/openai-budget.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "already written overview", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
const PROJECT_RESULT = { title: "AI title", logline: "AI logline", overview: "AI overview", genre: "AI genre", tone: "AI tone", theme: "AI theme", starting_state: "AI starting state", midpoint: "AI midpoint", ending_direction: "AI ending", story_flow_summary: "AI flow" };
const episode = (number: number) => ({
  episode_number: number, title: `AI Episode ${number}`, summary: "AI summary", main_event: "AI event", conflict: "AI conflict",
  characters: [], locations: [], objects: [], reveals: [], hidden_secrets: [],
  cliffhanger: "AI cliffhanger", next_episode_hook: "AI hook",
});

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } } as unknown as Response;
}
function responsesBody(result: unknown): unknown {
  return { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }] };
}

async function setupWithConnectedOpenAi() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "long-projects-openai-"));
  const projectsRoot = path.join(root, "projects");
  const settingsRepository = new ProviderSettingsRepository(root);
  const providerSettings = new ProviderSettingsService(settingsRepository);
  await providerSettings.save("openai", { value: "sk-test-key-1234567890" });
  const budget = new OpenAiBudget(root, 10);
  const projects = new LongProjectsService(projectsRoot, undefined, undefined, undefined, providerSettings, budget);
  await projects.create({ projectId: "long", settings });
  return { root, projectsRoot, providerSettings, budget, projects };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("real OpenAI Long Project outline generation", () => {
  it("calls the real planner adapter, only fills blank project fields, applies every Episode outline, and reports the budget", async () => {
    const { projects } = await setupWithConnectedOpenAi();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody({ project: PROJECT_RESULT, episodes: [episode(1), episode(2)] })));
    vi.stubGlobal("fetch", fetchMock);

    const preview = await projects.preview("long");
    expect(preview.budget).toMatchObject({ monthlyLimitUsd: 10, estimatedRequestCostUsd: 0.10, canSpend: true });
    expect(preview.preview.prompt).toContain("[1. 작업 목표]");
    expect(preview.preview.prompt).toContain("already written overview");

    const approved = await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });

    // title/logline/overview were already set by the user (create() requires title/logline; overview set in fixture) — must survive untouched.
    expect(approved.project.settings.title).toBe("Long story");
    expect(approved.project.settings.logline).toBe("A hero changes");
    expect(approved.project.settings.overview).toBe("already written overview");
    // Fields the user left blank get filled from the AI response.
    expect(approved.project.settings.genre).toBe("AI genre");
    expect(approved.project.settings.tone).toBe("AI tone");
    expect(approved.project.settings.theme).toBe("AI theme");
    expect(approved.project.settings.startingState).toBe("AI starting state");
    expect(approved.project.settings.midpoint).toBe("AI midpoint");
    expect(approved.project.settings.endingDirection).toBe("AI ending");
    expect(approved.project.settings.storyFlowSummary).toBe("AI flow");
    expect(approved.project.episodes).toMatchObject([
      { episodeNumber: 1, title: "AI Episode 1", summary: "AI summary", mainEvent: "AI event", conflict: "AI conflict", cliffhanger: "AI cliffhanger", nextEpisodeHook: "AI hook", status: "outline_ready" },
      { episodeNumber: 2, title: "AI Episode 2", status: "outline_ready" },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init.body)) as { text: { format: { schema: { properties: { episodes: { minItems: number; maxItems: number } } } } } };
    expect(body.text.format.schema.properties.episodes).toMatchObject({ minItems: 2, maxItems: 2 });
  });

  it("falls back to the local-fake template, never calling fetch, when no OpenAI credential is configured", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "long-projects-openai-"));
    const projectsRoot = path.join(root, "projects");
    const projects = new LongProjectsService(projectsRoot);
    await projects.create({ projectId: "long", settings });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const preview = await projects.preview("long");
    expect(preview.budget).toBeUndefined();
    const approved = await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(approved.project.episodes[0]).toMatchObject({ title: "Episode 1: Long story", status: "outline_ready" });
  });

  it("blocks the real request and keeps the project planned when the monthly budget is already spent", async () => {
    const { projects, budget } = await setupWithConnectedOpenAi();
    await budget.record("some-other-project", "long_story_outline", true, 10, new Date());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const preview = await projects.preview("long");
    await expect(projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 }))
      .rejects.toMatchObject({ response: { code: "LONG_OUTLINE_BUDGET_EXCEEDED" } });

    expect(fetchMock).not.toHaveBeenCalled();
    expect((await projects.get("long")).project.outlineStatus).toBe("planned");
  });

  it("classifies a real provider failure and records failed budget usage, keeping the project planned", async () => {
    const { projects, root: usedRoot } = await setupWithConnectedOpenAi();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "invalid_api_key" } }));
    vi.stubGlobal("fetch", fetchMock);

    const preview = await projects.preview("long");
    await expect(projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 }))
      .rejects.toMatchObject({ response: { code: "LONG_OUTLINE_PROVIDER_ERROR", details: { category: "authentication" } } });

    const usage = JSON.parse(await fs.readFile(path.join(usedRoot!, "api_budget_usage.json"), "utf8")) as Array<{ succeeded: boolean }>;
    expect(usage).toEqual([expect.objectContaining({ succeeded: false })]);
    expect((await projects.get("long")).project.outlineStatus).toBe("planned");
  });

  it("rejects a response whose episode numbers are not contiguous 1..episodeCount as a provider error, without writing anything", async () => {
    const { projects, projectsRoot } = await setupWithConnectedOpenAi();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody({ project: PROJECT_RESULT, episodes: [episode(1), episode(1)] })));
    vi.stubGlobal("fetch", fetchMock);

    const preview = await projects.preview("long");
    await expect(projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 }))
      .rejects.toMatchObject({ response: { code: "LONG_OUTLINE_PROVIDER_ERROR" } });

    const stored = JSON.parse(await fs.readFile(path.join(projectsRoot, "long", "long_story", "project.json"), "utf8")) as { outline_status: string };
    expect(stored.outline_status).toBe("planned");
  });

  it("keeps the outline OpenAI was already paid for when the ledger goes unreadable, even though there is nowhere to say so", async () => {
    // Every Episode in the project comes out of this one paid call, so losing it to its own bookkeeping is the
    // most expensive failure here. The `finally` used to throw and take the whole outline with it.
    //
    // 🟠 No warning is asserted, on purpose. A long project has no warnings channel of its own, and this outline
    // is not about any one Episode, so there is nowhere honest to put the sentence — that needs a shared-contract
    // field and the screen to render it. This pair pins the half that cannot wait: the outline survives.
    const { root: usedRoot, projects } = await setupWithConnectedOpenAi();
    const ledger = path.join(usedRoot!, "api_budget_usage.json");
    const fetchMock = vi.fn(async () => {
      await fs.writeFile(ledger, "{ not json", "utf8");
      return jsonResponse(200, responsesBody({ project: PROJECT_RESULT, episodes: [episode(1), episode(2)] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const preview = await projects.preview("long");

    const approved = await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });

    expect(approved.project.episodes).toHaveLength(2);
    expect(approved.project.episodes[0]!.title).toBe(episode(1).title);
    expect(await fs.readFile(ledger, "utf8")).toBe("{ not json");
  });

});
