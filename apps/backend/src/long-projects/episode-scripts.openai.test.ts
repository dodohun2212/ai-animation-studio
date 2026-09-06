import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LongProjectsService } from "./long-projects.service.js";
import { StoryBibleService } from "./story-bible.service.js";
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

async function setupWithConnectedOpenAi(sceneCount = 6, episodeCount = settings.episodeCount) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-scripts-openai-"));
  const projectsRoot = path.join(root, "projects");
  const settingsRepository = new ProviderSettingsRepository(root);
  const providerSettings = new ProviderSettingsService(settingsRepository);
  await providerSettings.save("openai", { value: "sk-test-key-1234567890" });
  const budget = new OpenAiBudget(root, 10);
  const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings: { ...settings, sceneCount, episodeCount } });
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

  /**
   * Episode 6 scene 6 failed at Runway with INTERNAL.BAD_OUTPUT.CODE01 on 2026-09-06 — $0.25 charged, the five
   * scenes before it fine. Its prompt asked one five-second shot for two camera moves and three separate
   * deformations of a face, while the fixed closing line of every video request demands stable identity,
   * anatomy and clothing throughout.
   *
   * Neither fact reached the model that wrote it. The clip length appeared only on the narration line, so the
   * motion fields were written without knowing how long the shot they become is, and the stability requirement
   * is appended downstream by code the model never sees. The pacing rule already here holds the speed steady
   * and says nothing about how many things happen at that speed.
   */
  it("tells the model how long one shot is and that the subject has to survive it", async () => {
    const { subject } = await setupWithConnectedOpenAi();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody(aiStory(6))));
    vi.stubGlobal("fetch", fetchMock);

    await subject.generate("long", 1, { userRequestId: "episode-scripts.openai-shot-budget" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const input = (JSON.parse(String(init.body)) as { input: string }).input;
    const motionInstruction = input.split(/\r?\n/).find((line) => line.startsWith("움직임 항목(")) ?? "";
    expect(motionInstruction).toContain("주요 동작 하나");
    // The Episode's own clip length, not a literal five. A fixture that happens to be five cannot tell the two
    // apart, so this compares the number against the narration line's — the one place the same value already
    // had to be interpolated. Hardcoding either one makes them disagree.
    const narrationInstruction = input.split(/\r?\n/).find((line) => line.startsWith("narration에는")) ?? "";
    const seconds = (line: string) => /(\d+)초/.exec(line)?.[1];
    expect(seconds(motionInstruction)).toBeDefined();
    expect(seconds(motionInstruction)).toBe(seconds(narrationInstruction));
    expect(input).toContain("정체성·신체·의상이 컷 내내 유지");
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

  it("puts the protagonist's name in the prompt, and the link plumbing nowhere near it", async () => {
    // The first path that gives a script prompt a character name at all. buildEpisodeContext's `characters`
    // list has always been empty and the Story Bible's character collection never reached it, so scripts were
    // written without knowing who they were about.
    const { subject, projectsRoot, root: testRoot } = await setupWithConnectedOpenAi();
    const assets = new LocalAssetsRepository(testRoot);
    const folder = await assets.createFolder({ assetType: "character", displayName: "이배드" });
    const bibleService = new StoryBibleService(projectsRoot, assets);
    await bibleService.updateProtagonistAssetLink("long", { assetLink: { assetId: folder.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody(aiStory(6))));
    vi.stubGlobal("fetch", fetchMock);

    await subject.generate("long", 1, { userRequestId: "episode-scripts.openai-protagonist" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { input: string };
    expect(body.input).toContain("이배드");
    // An Asset ID and a version policy mean nothing to a model writing a script. The style link had been going
    // into the prompt as a raw blob; both links are plumbing and neither belongs there.
    expect(body.input).not.toContain(folder.asset_id);
    expect(body.input).not.toContain("follow_latest");
  });

  it("still writes the script when the protagonist Folder cannot be read", async () => {
    // A link pointing at a missing library file must not be able to block generation — the name is a nicety,
    // the script is the thing the person asked for.
    const { subject, projectsRoot } = await setupWithConnectedOpenAi();
    const biblePath = path.join(projectsRoot, "long", "long_story", "story_bible.json");
    const bible = JSON.parse(await fs.readFile(biblePath, "utf8")) as Record<string, unknown>;
    bible.basic = { protagonist_asset_link: { asset_id: "ASSET-GONE", version_policy: "follow_latest", pinned_version: null } };
    await fs.writeFile(biblePath, JSON.stringify(bible, null, 2));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody(aiStory(6))));
    vi.stubGlobal("fetch", fetchMock);

    const generated = await subject.generate("long", 1, { userRequestId: "episode-scripts.openai-protagonist-missing" });
    expect(generated.episode).toMatchObject({ status: "script_review" });
  });

  it("keeps the Episode script OpenAI was already paid for when the ledger goes unreadable, and says the month's total is short", async () => {
    // The script is what every later step is built on — images, narration, video all read it — so losing it to
    // its own bookkeeping is the most expensive failure in this file. The `finally` around the paid call used
    // to throw and take the script with it, leaving the person on a screen whose only action is to buy it again.
    const { root: usedRoot, projectsRoot, subject } = await setupWithConnectedOpenAi();
    const ledger = path.join(usedRoot, "api_budget_usage.json");
    const fetchMock = vi.fn(async () => {
      await fs.writeFile(ledger, "{ not json", "utf8");
      return jsonResponse(200, responsesBody(aiStory(6)));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await subject.generate("long", 1, { userRequestId: "ledger-broke-mid-call" });

    expect(result.episode.status).toBe("script_review");
    const stored = JSON.parse(await fs.readFile(path.join(projectsRoot, "long", "long_story", "Episode01", "project.json"), "utf8")) as { script: Record<string, unknown>; warnings?: string[] };
    expect(Object.keys(stored.script).length).toBeGreaterThan(0);
    const warning = stored.warnings?.find((item) => item.includes("api_budget_usage.json"));
    expect(warning).toContain("1화 대본 생성");
    expect(warning).toContain("다시 만들지 마시고");
    // Written to the outline row before save() re-reads it to stamp the new status, so it is not overwritten.
    const outlines = JSON.parse(await fs.readFile(path.join(projectsRoot, "long", "long_story", "episode_outlines.json"), "utf8")) as Array<{ warnings?: string[]; status: string }>;
    expect(outlines[0]!.status).toBe("script_review");
    expect(outlines[0]!.warnings?.some((item) => item.includes("api_budget_usage.json"))).toBe(true);
    expect(await fs.readFile(ledger, "utf8")).toBe("{ not json");
  });


  /**
   * The earlier Episodes' memos reach the prompt that is actually sent.
   *
   * This is the whole reason the Continuity Memory exists, and it is the input a person pays for when they
   * generate the next Episode's script: gathered but not rendered, the request goes out knowing nothing about
   * the story so far, costs the same, and comes back with a plausible script that contradicts Episode 1.
   * Nothing measured it — the reader is covered, the template is covered, the join between them was not.
   *
   * Written for Episode 5 rather than Episode 3 on purpose. The reader splits earlier Episodes into the last
   * three, kept whole, and everything before that, compressed to a summary. Generating Episode 3 puts both of
   * its predecessors in the first bucket, so a version that dropped the compressed half entirely would pass —
   * measured: that injection stayed green until this moved to five.
   *
   * Asserted on the request body rather than the context object, because "what was sent" is the only question
   * that matters and it is the last place anything can be dropped.
   */
  it("carries the earlier Episodes' memos into the prompt it sends, both the recent ones and the compressed ones", async () => {
    const { projectsRoot, subject } = await setupWithConnectedOpenAi(6, 6);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody(aiStory(6))));
    vi.stubGlobal("fetch", fetchMock);

    // The stored form of a memo, written where continuityContext reads it. Distinctive words, so finding them in
    // the prompt cannot be an accident of the template's own wording.
    const memos = [
      { number: 1, summary: "주인공이 잊힌 정거장에서 깨어난다", event: "기억 조각을 처음 줍는다", action: "정거장 관리인을 찾아간다" },
      { number: 2, summary: "관리인이 거짓말을 하고 있었다", event: "지도의 절반이 불탄다", action: "남쪽 터널로 내려간다" },
      { number: 3, summary: "터널 아래에서 옛 승강장을 찾는다", event: "낡은 방송이 다시 흘러나온다", action: "방송의 출처를 쫓는다" },
      { number: 4, summary: "출처는 사람이 아니었다", event: "기록실의 문이 열린다", action: "기록실 안으로 들어간다" },
    ];
    for (const memo of memos) {
      const directory = path.join(projectsRoot, "long", "long_story", `Episode0${memo.number}`);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, "continuity.json"), JSON.stringify({
        episode_number: memo.number, episode_summary: memo.summary, events: [memo.event], character_changes: [],
        next_actions: [memo.action], updated_at: "2026-08-30T00:00:00.000Z",
      }), "utf8");
    }

    await subject.generate("long", 5, { userRequestId: "episode-5-with-memos" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // `input`, not `prompt`: the Responses API carries the whole prompt there (openai-story-adapter.ts).
    const sent = String((JSON.parse(init.body as string) as { input: string }).input);

    // Episodes 2-4 are the recent three: kept whole, down to what happened and what was left to do.
    for (const memo of memos.slice(1)) {
      for (const words of [memo.summary, memo.event, memo.action]) {
        expect(sent, `the prompt lost: ${words}`).toContain(words);
      }
    }
    // Episode 1 is older than that: its summary still has to travel, which is what "compressed" means. Its
    // events being absent is the compression working, not a loss — asserted so the two are not confused.
    expect(sent, "the prompt lost Episode 1's summary").toContain(memos[0]!.summary);
    expect(sent).not.toContain(memos[0]!.event);
  });

});
