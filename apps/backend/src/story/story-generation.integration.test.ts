import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectAssetMappingsService } from "../mappings/mappings.service.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { StoryPromptService } from "./story-prompt.service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsPromises.rm(root, { recursive: true, force: true })));
});

describe("local Story generation persistence", () => {
  it("writes Python-compatible snake_case Story/scenes and starts mapping review without a provider", async () => {
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "story-generation-"));
    roots.push(root);
    const projectsRoot = path.join(root, "learning_data", "projects");
    const templateRoot = path.join(root, "prompts");
    await fsPromises.mkdir(path.join(templateRoot, "story"), { recursive: true });
    await fsPromises.writeFile(path.join(templateRoot, "story", "story_generation.txt"), "topic=$topic", "utf8");
    const projects = new LocalProjectRepository(projectsRoot);
    await projects.create(createStoredProject("six_scenes", "rainy night", "2026-08-22T00:00:00.000Z"));
    const mappingRepository = new LocalProjectAssetMappingsRepository(projectsRoot);
    const mappings = new ProjectAssetMappingsService(mappingRepository, {} as never);
    const service = new StoryPromptService(projects, templateRoot, mappings);

    const preview = await service.preview("six_scenes");
    await service.approve("six_scenes", {
      originalPromptSha256: preview.preview.originalPromptSha256,
      prompt: preview.preview.originalPrompt,
      approved: true,
    });

    const raw = JSON.parse(await fsPromises.readFile(path.join(projectsRoot, "six_scenes", "project.json"), "utf8")) as Record<string, unknown>;
    expect(raw).toMatchObject({ workflow_state: "WAITING_FOR_ASSET_MAPPING_REVIEW", script_revision: 1, mapping_revision: 1 });
    expect(raw.story).toMatchObject({ title: "rainy night — Local Story" });
    expect(raw.scenes).toHaveLength(6);
    expect((raw.scenes as Array<Record<string, unknown>>).map((scene) => scene.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await mappingRepository.loadReview("six_scenes")).toMatchObject({ mapping_revision: 1, script_revision: 1, status: "waiting" });
  });
});
