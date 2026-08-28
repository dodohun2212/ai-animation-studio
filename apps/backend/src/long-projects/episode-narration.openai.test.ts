import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAiBudget } from "../providers/openai-budget.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { EpisodeNarrationService } from "./episode-narration.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { LongProjectsService } from "./long-projects.service.js";

/**
 * The Episode's narration with a credential connected — the half of this feature that had no test.
 *
 * Its short-project twin has had one all along (narration-openai.test.ts). On this side every test ran without a
 * credential, so `audio: "generated"` — the state that only exists when a real call succeeded — had never been
 * produced anywhere in the suite, let alone asserted. The union that replaced two booleans was therefore proven
 * for "none" and "placeholder" only, which is two thirds of the thing it was introduced to make safe.
 *
 * `fetch` is stubbed for every test here, so no request leaves the process.
 */

let root: string | undefined;
const settings = {
  title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "",
  episodeCount: 2, sceneCount: 4, clipDurationSeconds: 5, aspectRatio: "9:16" as const,
  audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "",
  narrationEnabled: true, subtitlesEnabled: false,
};
const AUDIO_BYTES = Buffer.from("fake mp3 bytes from openai");

function audioResponse(bytes: Buffer): Response {
  return {
    ok: true, status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    json: async () => ({}),
    headers: { get: () => null },
  } as unknown as Response;
}

async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-narration-openai-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings });
  const preview = await projects.preview("long");
  await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot);
  await scripts.generate("long", 1, { userRequestId: "episode-narration-openai-script" });

  const providerSettings = new ProviderSettingsService(new ProviderSettingsRepository(root));
  await providerSettings.save("openai", { value: "sk-test-key-1234567890" });
  const budget = new OpenAiBudget(root, 10);
  return { projectsRoot, narration: new EpisodeNarrationService(projectsRoot, providerSettings, budget) };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("Episode narration with a connected OpenAI credential", () => {
  it("speaks every scene through the real endpoint and reports the audio as generated, not as a placeholder", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(AUDIO_BYTES));
    vi.stubGlobal("fetch", fetchMock);
    const { narration } = await setup();

    const result = await narration.generate("long", 1, { approved: true });
    expect(result.generatedSceneNumbers.length).toBeGreaterThan(0);
    expect(result.reusedSceneNumbers).toEqual([]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(JSON.parse(String(init.body))).toMatchObject({ input: expect.any(String) });

    // The assertion this file exists for. Every other test on this side runs without a credential, so this
    // branch of audioState — the one that reads the record's adapter and finds a real one — had never run.
    const review = await narration.get("long", 1);
    expect(review.narrations.filter((item) => item.narration).every((item) => item.audio === "generated")).toBe(true);
    expect(review.narrations.some((item) => item.audio === "placeholder")).toBe(false);
  });

  it("charges once per scene it actually spoke, and reuses on a second press without spending again", async () => {
    // Reuse is decided from the record, not from a file being present — the distinction that let a placeholder
    // count as finished work forever. With a real adapter recorded, a second press must spend nothing.
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(AUDIO_BYTES));
    vi.stubGlobal("fetch", fetchMock);
    const { narration } = await setup();

    const first = await narration.generate("long", 1, { approved: true });
    const spoken = first.generatedSceneNumbers.length;
    expect(fetchMock).toHaveBeenCalledTimes(spoken);

    const second = await narration.generate("long", 1, { approved: true });
    expect(second.generatedSceneNumbers).toEqual([]);
    expect(second.reusedSceneNumbers.length).toBe(spoken);
    expect(fetchMock).toHaveBeenCalledTimes(spoken);
  });

  it("writes what the provider returned, not the silent placeholder", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(AUDIO_BYTES));
    vi.stubGlobal("fetch", fetchMock);
    const { projectsRoot, narration } = await setup();

    await narration.generate("long", 1, { approved: true });
    const file = path.join(projectsRoot, "long", "long_story", "Episode01", "narration", "scene1.mp3");
    expect(await fs.readFile(file)).toEqual(AUDIO_BYTES);
  });
});
