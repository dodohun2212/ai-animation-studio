import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { StoryPromptService, renderTemplate } from "./story-prompt.service.js";

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
  return { repository, service: new StoryPromptService(repository, templateRoot) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fsPromises.rm(root, { recursive: true, force: true }))); });

describe("StoryPromptService", () => {
  it("renders an exact local preview with six scenes and no provider call", async () => {
    const { service } = await setup();
    const result = await service.preview("sample");
    expect(result.preview).toMatchObject({ projectId: "sample", originalPrompt: "name=Stars topic=night sky count=6 literal=$ missing=$missing", characterCount: 1, sceneCount: 6 });
    expect(result.preview.originalPromptSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("persists only the approved exact text and detects a stale preview", async () => {
    const { repository, service } = await setup(); const preview = await service.preview("sample");
    const approved = await service.approve("sample", { originalPromptSha256: preview.preview.originalPromptSha256, prompt: "  edited prompt  ", approved: true });
    expect(approved).toMatchObject({ prompt: "edited prompt", modified: true });
    expect((await repository.findById("sample")).lore_context).toMatchObject({ story_prompt_request: { actual_prompt: "edited prompt", original_prompt: preview.preview.originalPrompt, modified: true, model: "local-fake-story-adapter" } });
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
});
