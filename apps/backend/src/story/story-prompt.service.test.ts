import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as url from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { OpenAiBudget } from "../providers/openai-budget.js";
import { StoryPromptService, renderTemplate } from "./story-prompt.service.js";
import { generateLocalStory, validateStory } from "./story-generation.service.js";
import { STORY_SCENE_FIELDS } from "./openai-story-adapter.js";
import { WorkflowState } from "@ai-animation-studio/shared";

const roots: string[] = [];
async function setup() {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "story-prompt-")); roots.push(root);
  const templateRoot = path.join(root, "templates"); await fsPromises.mkdir(path.join(templateRoot, "story"), { recursive: true });
  await fsPromises.writeFile(path.join(templateRoot, "story", "story_generation.txt"), "name=$project_name topic=$topic count=$scene_count literal=$$ missing=$missing", "utf8");
  const repository = new LocalProjectRepository(path.join(root, "projects"));
  const stored = createStoredProject("sample", "night sky", "2026-08-22T00:00:00.000Z");
  stored.character_profile = { name: "hero", cast: [{ asset_id: "CHAR-1" }] };
  stored.lore_context = { project_name: "Stars", duration_seconds: 30, scene_count: 6 };
  await repository.create(stored);
  return { repository, templateRoot, root, service: new StoryPromptService(repository, templateRoot) };
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => fsPromises.rm(root, { recursive: true, force: true })));
});

describe("default prompts root resolution (regression: must not depend on process.cwd())", () => {
  it("finds the real repository prompts/story/story_generation.txt with no templateRoot override, exactly as production wiring constructs the service", async () => {
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "story-prompt-default-root-")); roots.push(root);
    const repository = new LocalProjectRepository(path.join(root, "projects"));
    const stored = createStoredProject("default_root_check", "a lighthouse at dusk", "2026-08-22T00:00:00.000Z");
    await repository.create(stored);
    // No templateRoot argument: exercises the real default promptsRoot() resolution, which every production
    // launch path (nest start --watch, node dist/main.js, the packaged app) relies on and which previously
    // silently broke whenever process.cwd() wasn't the repository root (i.e. every real launch).
    const service = new StoryPromptService(repository);
    const result = await service.preview("default_root_check");
    expect(result.preview.originalPrompt).toContain("a lighthouse at dusk");
  });

  it("leaves no section heading standing over nothing in the real template", async () => {
    // Each numbered section prints a heading, then its value, then an instruction about what to do with it. A
    // value that is the empty string leaves the heading with nothing under it and the instruction pointing at
    // the gap — to a model that reads as content that was dropped, not content that does not exist, and it
    // goes out on a paid request. Python filled every one of these blanks with a sentence saying "없음".
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "story-prompt-blank-section-")); roots.push(root);
    const repository = new LocalProjectRepository(path.join(root, "projects"));
    await repository.create(createStoredProject("blank_sections", "a lighthouse at dusk", "2026-08-22T00:00:00.000Z"));
    const { preview } = await new StoryPromptService(repository).preview("blank_sections");

    // Headings come from the template rather than being spelled here: written by hand, one of them was wrong
    // and the test passed for the wrong reason — it found no heading, took the empty string, and only failed
    // because the assertion happened to be "not empty". Every line that is a lone `$variable` is a section
    // whose whole body is that value, which is exactly the set that can come out blank.
    // Anchored to this file, not to process.cwd() — the same rule promptsRoot() follows, and the one this
    // describe block is named after. Read from the repository root it passed; read from apps/backend it looked
    // for C:\dev\prompts and threw ENOENT, so which directory the suite was started from decided whether the
    // check ran at all. src/story/ -> ../../../.. -> repository root, matching promptsRoot()'s dev candidate.
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const template = await fsPromises.readFile(path.resolve(here, "../../../../prompts/story/story_generation.txt"), "utf8");
    const lines = template.split(/\r?\n/);
    const headings = lines.flatMap((line, index) => /^\$\w+$/.test(line) && lines[index - 1]?.startsWith("[") ? [lines[index - 1]!] : []);
    expect(headings.length).toBeGreaterThanOrEqual(4);

    // Nothing is selected or linked on a project this bare, so every one of them takes its empty case.
    for (const heading of headings) {
      // The first line after the heading is the section's value; a blank one is the failure being pinned.
      const [, rest = ""] = preview.originalPrompt.split(heading);
      const [, value = ""] = rest.split(/\r?\n/);
      expect(value.trim()).not.toBe("");
    }
  });

  /**
   * The same rule for the labelled lines, which is where it was actually being broken.
   *
   * The check above only sees a section whose whole body is one `$variable`. Most of the template is not that
   * shape: section 7 is seven `라벨: $variable` lines, and a blank one leaves `대사 스타일:` trailing off with
   * the next label directly under it. The heading check passed the entire time that was happening.
   *
   * Measured on a copy of the real projects rather than argued from the code: all eight sent `대사 스타일:`
   * bare, four also sent `피해야 할 요소:`, three sent six such labels, one sent seven. Nothing about that is
   * visible from the arguments — the value is present, it is the empty string, and it goes out paid.
   *
   * The labels are read out of the template for the same reason the headings are: hand-copied, they go stale
   * the moment a line is added, and the new line is exactly the one nobody checked.
   */
  it("leaves no label standing over nothing either, on a project with nothing filled in", async () => {
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "story-prompt-blank-label-")); roots.push(root);
    const repository = new LocalProjectRepository(path.join(root, "projects"));
    await repository.create(createStoredProject("blank_labels", "a lighthouse at dusk", "2026-08-22T00:00:00.000Z"));
    const { preview } = await new StoryPromptService(repository).preview("blank_labels");

    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const template = await fsPromises.readFile(path.resolve(here, "../../../../prompts/story/story_generation.txt"), "utf8");
    const labels = template.split(/\r?\n/).flatMap((line) => {
      const match = /^(.+): \$\w+$/.exec(line);
      return match ? [match[1]!] : [];
    });
    expect(labels.length).toBeGreaterThanOrEqual(10); // the template still has this shape

    const lines = preview.originalPrompt.split(/\r?\n/);
    const blank = labels.filter((label) => lines.some((line) =>
      line.startsWith(`${label}:`) && line.slice(label.length + 1).trim() === ""));
    expect(blank, "labels sent with nothing after them").toEqual([]);

    // And the open ones say so in the baseline's word rather than in the constant's name: the prompt used to
    // carry the literal `AUTONOMOUS_SETTING` into a Korean sentence, which is an identifier leaking into a
    // paid request, not an instruction the model can act on.
    expect(preview.originalPrompt).toContain("세계관: 자율");
    expect(preview.originalPrompt).not.toContain("AUTONOMOUS_SETTING");
  });
});

const SCENE = (number: number) => ({
  number, description: `d${number}`, visual_action: "v", start_motion: "s", main_motion: "m", end_motion: "e",
  shot_size: "medium", camera_angle: "eye", composition: "centered", lens_feel: "natural", focus_subject: "hero",
  camera_motion: "forward", environment_motion: "ambient", motion_speed: "normal", motion_intensity: "moderate",
  expression_change: "focused", continuity_hint: "continue", narration: "narration line",
});
const VALID_STORY = { title: "t", synopsis: "s", ending: "e", scenes: [1, 2, 3, 4, 5, 6].map(SCENE) };
function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } } as unknown as Response;
}
function responsesBody(story: unknown): unknown {
  return { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(story) }] }] };
}

async function setupWithConnectedOpenAi() {
  const base = await setup();
  const settingsRepository = new ProviderSettingsRepository(base.root);
  const providerSettings = new ProviderSettingsService(settingsRepository);
  await providerSettings.save("openai", { value: "sk-test-key-1234567890" });
  const budget = new OpenAiBudget(base.root, 10);
  const service = new StoryPromptService(base.repository, base.templateRoot, undefined, providerSettings, budget);
  return { ...base, providerSettings, budget, service };
}

describe("StoryPromptService", () => {
  it("renders an exact local preview with six scenes and no provider call", async () => {
    const { service } = await setup();
    const result = await service.preview("sample");
    expect(result.preview).toMatchObject({ projectId: "sample", originalPrompt: "name=Stars topic=night sky count=6 literal=$ missing=$missing", characterCount: 1, sceneCount: 6 });
    expect(result.preview.originalPromptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.budget).toBeUndefined(); // no OpenAI credential/budget wired in — local fake mode
  });
  it("reports the real budget ledger state when an OpenAI credential is connected", async () => {
    const { budget, service } = await setupWithConnectedOpenAi();
    await budget.record("sample", "story", true, 0.02, new Date());
    const result = await service.preview("sample");
    expect(result.budget).toEqual({ monthlyLimitUsd: 10, spentUsd: 0.02, remainingUsd: 9.98, estimatedRequestCostUsd: 0.05, canSpend: true });
  });
  it("reflects a project's actual stored scene count in the preview instead of assuming six", async () => {
    const { repository, service } = await setup();
    const stored = await repository.findById("sample");
    await repository.save({ ...stored, lore_context: { ...stored.lore_context, scene_count: 4 } });
    const result = await service.preview("sample");
    expect(result.preview).toMatchObject({ sceneCount: 4, originalPrompt: "name=Stars topic=night sky count=4 literal=$ missing=$missing" });
  });
  it("renders a draft preview from not-yet-saved settings, leaving the stored project untouched", async () => {
    const { repository, service } = await setup();
    const before = await repository.findById("sample");
    const draftSettings = {
      projectName: "Draft Name", topic: "draft topic", genre: "", mood: "", character: "",
      lore: "", fullStory: "", sceneCount: 6, clipDurationSeconds: 5, additionalNotes: "", styleNotes: {},
      narrationEnabled: false, subtitlesEnabled: false,
    };
    const result = await service.draftPreview("sample", { settings: draftSettings });
    expect(result).toEqual({ prompt: "name=Draft Name topic=draft topic count=6 literal=$ missing=$missing" });
    expect(await repository.findById("sample")).toEqual(before);
  });
  it("rejects malformed or incomplete draft settings", async () => {
    const { service } = await setup();
    await expect(service.draftPreview("sample", { settings: { projectName: "x" } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.draftPreview("sample", {})).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });
  it("persists only the approved exact text and detects a stale preview", async () => {
    const { repository, service } = await setup(); const preview = await service.preview("sample");
    const approved = await service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: "  edited prompt  ", approved: true });
    expect(approved).toMatchObject({ prompt: "edited prompt", modified: true });
    const persisted = await repository.findById("sample");
    expect(persisted.lore_context).toMatchObject({ story_prompt_request: { actual_prompt: "edited prompt", original_prompt: preview.preview.originalPrompt, modified: true, model: "local-fake-story-adapter" } });
    expect(persisted).toMatchObject({ workflow_state: WorkflowState.WaitingForAssetMappingReview, script_revision: 1 });
    expect(persisted.story).toMatchObject({ title: "night sky — Local Story" });
    expect(persisted.scenes).toHaveLength(6);
    expect(persisted.scenes.map((scene) => (scene as { number: number }).number)).toEqual([1, 2, 3, 4, 5, 6]);
    await expect(service.approve("sample", { originalPromptSha256: "a".repeat(64), prompt: "x", approved: true })).rejects.toMatchObject({ response: { code: "STORY_PROMPT_STALE" } });
  });
  it("rejects blank, unapproved, and unknown approval fields", async () => {
    const { service } = await setup(); const preview = await service.preview("sample");
    await expect(service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: " ", approved: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: "x", approved: false })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: "x", approved: true, extra: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });
  it("keeps Python-style unresolved placeholders and escaped dollars", () => {
    expect(renderTemplate("$known $$ $unknown", { known: "value" })).toBe("value $ $unknown");
  });
  it("begins a new mapping review after persisting validated six-scene Story output", async () => {
    const { repository, templateRoot } = await setup();
    const beginReview = async (_projectId: string, request: unknown) => {
      expect(request).toEqual({ scriptRevision: 1 });
      return { review: { mappingRevision: 4 } };
    };
    const service = new StoryPromptService(repository, templateRoot, { beginReview } as never);
    const preview = await service.preview("sample");
    await service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: preview.preview.originalPrompt, approved: true });
    expect(await repository.findById("sample")).toMatchObject({
      workflow_state: WorkflowState.WaitingForAssetMappingReview,
      script_revision: 1,
      mapping_revision: 4,
    });
  });
  it("rejects generation when the approved project is no longer READY", async () => {
    const { repository, service } = await setup();
    const preview = await service.preview("sample");
    const stored = await repository.findById("sample");
    await repository.save({ ...stored, workflow_state: WorkflowState.GeneratingStory });
    await expect(service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: "x", approved: true }))
      .rejects.toMatchObject({ response: { code: "STORY_GENERATION_NOT_ALLOWED" } });
  });

  it("resets a generated Story back to READY so it can be approved again from scratch, as long as no scene image exists yet", async () => {
    const { repository, service } = await setup();
    const preview = await service.preview("sample");
    await service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: preview.preview.originalPrompt, approved: true });
    expect((await repository.findById("sample")).workflow_state).toBe(WorkflowState.WaitingForAssetMappingReview);

    const result = await service.regenerate("sample", { approved: true });

    expect(result.project.workflowState).toBe(WorkflowState.Ready);
    expect(result.project.scenes).toEqual([]);
    const persisted = await repository.findById("sample");
    expect(persisted).toMatchObject({ workflow_state: WorkflowState.Ready, scenes: [], story: {}, image_prompts: [], motion_prompts: [] });

    // The reset must be a genuine do-over, not a dead end: preview/approve must work again immediately.
    const secondPreview = await service.preview("sample");
    const secondApproval = await service.approve("sample", { originalPromptSha256: secondPreview.preview.originalPromptSha256, prompt: secondPreview.preview.originalPrompt, approved: true });
    expect(secondApproval.project.workflowState).toBe(WorkflowState.WaitingForAssetMappingReview);
    expect((await repository.findById("sample")).script_revision).toBe(2);
  });

  it("rejects regeneration before a Story exists, once a scene image has been generated, or with a malformed request", async () => {
    const { repository, service } = await setup();
    await expect(service.regenerate("sample", { approved: true })).rejects.toMatchObject({ response: { code: "STORY_REGENERATION_NOT_ALLOWED" } });

    const preview = await service.preview("sample");
    await service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: preview.preview.originalPrompt, approved: true });
    await expect(service.regenerate("sample", { approved: false })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.regenerate("sample", { approved: true, extra: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });

    const stored = await repository.findById("sample");
    await repository.save({ ...stored, generated_images: ["images/scene1.png"] });
    await expect(service.regenerate("sample", { approved: true })).rejects.toMatchObject({ response: { code: "STORY_REGENERATION_NOT_ALLOWED" } });
  });

  it("rejects regeneration outside the Story-exists-no-images-yet window (still generating, or already generating images)", async () => {
    const { repository, service } = await setup();
    const preview = await service.preview("sample");
    await service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: preview.preview.originalPrompt, approved: true });
    const stored = await repository.findById("sample");

    await repository.save({ ...stored, workflow_state: WorkflowState.GeneratingStory });
    await expect(service.regenerate("sample", { approved: true })).rejects.toMatchObject({ response: { code: "STORY_REGENERATION_NOT_ALLOWED" } });

    await repository.save({ ...stored, workflow_state: WorkflowState.GeneratingImages });
    await expect(service.regenerate("sample", { approved: true })).rejects.toMatchObject({ response: { code: "STORY_REGENERATION_NOT_ALLOWED" } });
  });
});

describe("StoryPromptService real OpenAI generation", () => {
  it("calls the real adapter and persists its real model name and Story when a connected credential is configured", async () => {
    const { repository, service } = await setupWithConnectedOpenAi();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responsesBody(VALID_STORY)));
    vi.stubGlobal("fetch", fetchMock);
    const preview = await service.preview("sample");

    const approved = await service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: preview.preview.originalPrompt, approved: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(approved.project.workflowState).toBe(WorkflowState.WaitingForAssetMappingReview);
    const persisted = await repository.findById("sample");
    expect(persisted.story).toEqual(VALID_STORY);
    expect(persisted.lore_context).toMatchObject({ story_prompt_request: { model: "gpt-5.6-luna" } });
  });

  it("falls back to the local fake adapter, never calling fetch, when no OpenAI credential is configured", async () => {
    const { repository, service } = await setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const preview = await service.preview("sample");

    await service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: preview.preview.originalPrompt, approved: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect((await repository.findById("sample")).lore_context).toMatchObject({ story_prompt_request: { model: "local-fake-story-adapter" } });
  });

  it("falls back to the local fake adapter, never calling fetch, when the configured OpenAI credential is session-disconnected", async () => {
    const { repository, service, providerSettings } = await setupWithConnectedOpenAi();
    await providerSettings.disconnect("openai", {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const preview = await service.preview("sample");

    await service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: preview.preview.originalPrompt, approved: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect((await repository.findById("sample")).lore_context).toMatchObject({ story_prompt_request: { model: "local-fake-story-adapter" } });
  });

  it("blocks the real request and restores READY when the monthly budget is already spent", async () => {
    const { repository, service, budget } = await setupWithConnectedOpenAi();
    await budget.record("sample", "story", true, 10, new Date());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const preview = await service.preview("sample");

    await expect(service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: preview.preview.originalPrompt, approved: true }))
      .rejects.toMatchObject({ response: { code: "STORY_BUDGET_EXCEEDED" } });

    expect(fetchMock).not.toHaveBeenCalled();
    expect((await repository.findById("sample")).workflow_state).toBe(WorkflowState.Ready);
  });

  it("keeps the Story OpenAI was already paid for when the ledger goes unreadable, and says the month's total is short", async () => {
    // The Story is the most expensive thing here to lose: it is the whole run's output, and everything after it
    // is built on it. The ledger write sat in a `finally` around the paid call, so its throw discarded the Story
    // that had just come back and sent the person to READY — where the only thing to do is pay for it again.
    const { repository, service, root } = await setupWithConnectedOpenAi();
    const ledger = path.join(root, "api_budget_usage.json");
    // Broken from inside the provider call: after preflight let the request through, before record() writes it.
    const fetchMock = vi.fn(async () => {
      await fsPromises.writeFile(ledger, "{ not json", "utf8");
      return jsonResponse(200, responsesBody(VALID_STORY));
    });
    vi.stubGlobal("fetch", fetchMock);
    const preview = await service.preview("sample");

    const approved = await service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: preview.preview.originalPrompt, approved: true });

    expect(approved.project.workflowState).toBe(WorkflowState.WaitingForAssetMappingReview);
    const persisted = await repository.findById("sample");
    expect(persisted.story).toEqual(VALID_STORY);
    const warning = persisted.warnings.find((item) => item.includes("api_budget_usage.json"));
    expect(warning).toContain("다시 만들지 마시고");
    expect(await fsPromises.readFile(ledger, "utf8")).toBe("{ not json"); // never overwritten
  });

  it("classifies a real provider failure, records it as budget usage, and restores READY so the user can retry", async () => {
    const { repository, service, root } = await setupWithConnectedOpenAi();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: "invalid_api_key" } }));
    vi.stubGlobal("fetch", fetchMock);
    const preview = await service.preview("sample");

    await expect(service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: preview.preview.originalPrompt, approved: true }))
      .rejects.toMatchObject({ response: { code: "STORY_PROVIDER_ERROR", details: { category: "authentication" } } });

    expect((await repository.findById("sample")).workflow_state).toBe(WorkflowState.Ready);
    const usage = JSON.parse(await fsPromises.readFile(path.join(root, "api_budget_usage.json"), "utf8")) as Array<Record<string, unknown>>;
    expect(usage).toEqual([expect.objectContaining({ project_id: "sample", api_type: "story", succeeded: false })]);
  });
});

describe("local Story generator", () => {
  it("produces every strict Python STORY_SCHEMA field in six ordered scenes", () => {
    const stored = createStoredProject("story", "rain", "2026-08-22T00:00:00.000Z");
    const story = generateLocalStory(stored, "approved local prompt");
    validateStory(story);
    expect(Object.keys(story).sort()).toEqual(["ending", "scenes", "synopsis", "title"]);
    expect(story.scenes).toHaveLength(6);
    story.scenes.forEach((scene, index) => {
      expect(Object.keys(scene).sort()).toEqual([
        "camera_angle", "camera_motion", "composition", "continuity_hint", "description", "end_motion", "environment_motion", "expression_change", "focus_subject", "lens_feel", "main_motion", "motion_intensity", "motion_speed", "narration", "number", "shot_size", "start_motion", "visual_action",
      ]);
      expect(scene.number).toBe(index + 1);
    });
  });
  it("rejects unknown, incomplete, and out-of-order Story output", () => {
    const valid = generateLocalStory(createStoredProject("story", "rain", "2026-08-22T00:00:00.000Z"), "approved");
    expect(() => validateStory({ ...valid, extra: true })).toThrow();
    expect(() => validateStory({ ...valid, scenes: valid.scenes.slice(0, 5) })).toThrow();
    expect(() => validateStory({ ...valid, scenes: [{ ...valid.scenes[0]!, number: 2 }, ...valid.scenes.slice(1)] })).toThrow();
    const incomplete = { ...valid.scenes[0]! } as Record<string, unknown>; delete incomplete.camera_motion;
    expect(() => validateStory({ ...valid, scenes: [incomplete, ...valid.scenes.slice(1)] })).toThrow();
  });
  it("produces exactly as many scenes as the project's stored scene count, not always six", () => {
    const stored = createStoredProject("story", "rain", "2026-08-22T00:00:00.000Z");
    stored.lore_context = { scene_count: 4 };
    const story = generateLocalStory(stored, "approved local prompt");
    validateStory(story, 4);
    expect(story.scenes).toHaveLength(4);
    expect(story.scenes[3]!.number).toBe(4);
    expect(() => validateStory(story)).toThrow();
  });

  it("names one lead, not two, when a cast member is marked 대표", async () => {
    // The template asks the same question twice, three lines apart: `대표 캐릭터: $character` and then a cast
    // block that marks a member 구분: 대표 캐릭터. Nothing kept them in agreement, so a project with both could
    // hand the model two different leads — directly above the line telling it not to mix character names.
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "story-prompt-lead-")); roots.push(root);
    const templateRoot = path.join(root, "templates"); await fsPromises.mkdir(path.join(templateRoot, "story"), { recursive: true });
    await fsPromises.writeFile(path.join(templateRoot, "story", "story_generation.txt"), "lead=$character\ncast=$character_cast_metadata", "utf8");
    const assets = new LocalAssetsRepository(root);
    const folder = await assets.createFolder({ assetType: "character", displayName: "이배드" });
    const repository = new LocalProjectRepository(path.join(root, "projects"));
    const stored = createStoredProject("lead_check", "night sky", "2026-08-22T00:00:00.000Z");
    stored.character_profile = {
      name: "예전에 적어둔 다른 이름",
      cast: [{ asset_id: folder.asset_id, cast_role: "protagonist", story_role: "주인공" }],
    };
    await repository.create(stored);

    const { preview } = await new StoryPromptService(repository, templateRoot, undefined, undefined, undefined, assets).preview("lead_check");
    expect(preview.originalPrompt).toContain("lead=이배드");
    expect(preview.originalPrompt).not.toContain("예전에 적어둔 다른 이름");
  });


  /**
   * 캡틴D read the prompt of a 꽃말 reel before approving it and found the app arguing with itself: [2] said
   * 「등록된 Character Asset 없음」 and then ordered the model to keep 대표 캐릭터 at the centre of the whole
   * script, while [7] 피할 요소 began with 사람. Both halves went out on the same paid request. Those four
   * lines were flat template text, so nothing made them conditional and nothing here caught them — the suite
   * was fully green with the contradiction in it.
   *
   * The real template on purpose: the defect lived half in the file and half in the variable, and a hand-written
   * fixture would have proved only the half it spelled out.
   */
  it("does not order a lead kept at the centre of a project that has just been told it has no characters", async () => {
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "story-prompt-no-cast-")); roots.push(root);
    const repository = new LocalProjectRepository(path.join(root, "projects"));
    await repository.create(createStoredProject("no_cast", "빨간 장미의 꽃말", "2026-08-22T00:00:00.000Z"));

    const { preview } = await new StoryPromptService(repository).preview("no_cast");

    expect(preview.originalPrompt).toContain("등록된 Character Asset 없음");
    expect(preview.originalPrompt).not.toContain("대표 캐릭터는 대본 전체의 중심으로 유지하십시오.");
    expect(preview.originalPrompt).not.toContain("서로 다른 Character Asset의 이름, 외형과 역할을 섞지 마십시오.");
    // The conditional sentences of sections 3-6 stay. With no value they ask for nothing, so removing them
    // would be a rewrite of working text rather than the removal of a contradiction.
    expect(preview.originalPrompt).toContain("이전 장면이 연결된 경우");
  });

  it("still gives those instructions to a project that actually has a cast", async () => {
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "story-prompt-with-cast-")); roots.push(root);
    const assets = new LocalAssetsRepository(root);
    const folder = await assets.createFolder({ assetType: "character", displayName: "이배드" });
    const repository = new LocalProjectRepository(path.join(root, "projects"));
    const stored = createStoredProject("with_cast", "밤하늘", "2026-08-22T00:00:00.000Z");
    stored.character_profile = { name: "", cast: [{ asset_id: folder.asset_id, cast_role: "protagonist", story_role: "주인공" }] };
    await repository.create(stored);

    const { preview } = await new StoryPromptService(repository, undefined, undefined, undefined, undefined, assets).preview("with_cast");

    expect(preview.originalPrompt).toContain("대표 캐릭터는 대본 전체의 중심으로 유지하십시오.");
    expect(preview.originalPrompt).toContain("서로 다른 Character Asset의 이름, 외형과 역할을 섞지 마십시오.");
  });

  /** A typed name with no Asset behind it is still a named lead: the two lead sentences must survive where there is no cast block to carry them. */
  it("keeps the lead instructions for a name typed into settings with no Character Asset registered", async () => {
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "story-prompt-typed-lead-")); roots.push(root);
    const repository = new LocalProjectRepository(path.join(root, "projects"));
    const stored = createStoredProject("typed_lead", "밤하늘", "2026-08-22T00:00:00.000Z");
    stored.character_profile = { name: "이배드", cast: [] };
    await repository.create(stored);

    const { preview } = await new StoryPromptService(repository).preview("typed_lead");

    expect(preview.originalPrompt).toContain("대표 캐릭터: 이배드");
    expect(preview.originalPrompt).toContain("대표 캐릭터는 대본 전체의 중심으로 유지하십시오.");
    // No Character Asset exists, so there is nothing to keep apart and nothing to keep out of the wrong scene.
    expect(preview.originalPrompt).not.toContain("서로 다른 Character Asset의 이름, 외형과 역할을 섞지 마십시오.");
  });
  it("pays for one Story when two approvals arrive together, and refuses the second instead of queuing it", async () => {
    // The prompt hash guards against approving a *stale* prompt. It does nothing about two identical approvals
    // racing: both read READY, both decide they may run, and both pay.
    const { repository, service } = await setupWithConnectedOpenAi();
    const fetchMock = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return jsonResponse(200, responsesBody(VALID_STORY));
    });
    vi.stubGlobal("fetch", fetchMock);
    const preview = await service.preview("sample");
    const body = { originalPromptSha256: preview.preview.originalPromptSha256, prompt: preview.preview.originalPrompt, approved: true };

    const outcomes = await Promise.allSettled([service.approve("sample", body), service.approve("sample", body)]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const refused = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ response: { code: "PROJECT_LOCKED" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await repository.findById("sample")).story).toEqual(VALID_STORY);
  });

});

describe("the real template's scene field list", () => {
  /**
   * The response schema marks all eighteen `required` with `additionalProperties: false`, so a field deleted from
   * the template does not become a field the model may omit — it becomes one the model fills without having been
   * told what it is for. That passes validation and comes back as a wrong picture, which is worse than a failure
   * that stops. Nothing connected the two lists, so tidying the prompt could have cost a paid image call.
   */
  it("asks for exactly the fields the response schema requires, no more and no fewer", async () => {
    const template = await fsPromises.readFile(
      path.join(url.fileURLToPath(new URL("../../../../", import.meta.url)), "prompts", "story", "story_generation.txt"), "utf8");
    const asked = template.split(/\r?\n/).flatMap((line) => {
      const match = /^- ([a-z_]+):/.exec(line);
      return match ? [match[1]!] : [];
    });

    expect(asked).toEqual([...STORY_SCENE_FIELDS]);
  });

  /**
   * 캡틴D asked whether the fields not needed for a flower reel could be dropped; the answer was that none can,
   * and measuring that turned up the real defect — the descriptions assumed a person. 「자세·시선」, 「신체·소품」,
   * 「표정」 and 「인물」 name things a flower does not have, on a project whose [7] 피할 요소 begins with 사람, so
   * the model was being asked to describe a body in a video that must not contain one. Widening the subject costs
   * a project with people nothing — a person is a 피사체 too — which is why this is a rewording and not a removal.
   */
  it("describes those fields without assuming the subject is a person", async () => {
    const template = await fsPromises.readFile(
      path.join(url.fileURLToPath(new URL("../../../../", import.meta.url)), "prompts", "story", "story_generation.txt"), "utf8");
    const fieldLines = template.split(/\r?\n/).filter((line) => /^- [a-z_]+:/.test(line));

    for (const word of ["시선", "신체", "인물"]) {
      expect(fieldLines.filter((line) => line.includes(word))).toEqual([]);
    }
    // 표정 stays, because a face is a real thing to describe when there is one — what changed is that the line
    // now says what to write when there is not, instead of leaving the model to invent a face for a flower.
    const expression = fieldLines.find((line) => line.startsWith("- expression_change:")) ?? "";
    expect(expression).toContain("표정이 없는 피사체라면");
  });
});

