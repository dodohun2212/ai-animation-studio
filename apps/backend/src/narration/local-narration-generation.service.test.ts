import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { parseShortProjectSettings, applyShortProjectSettings, toShortProjectSettings } from "../projects/project-settings.js";
import { LocalNarrationGenerationService } from "./local-narration-generation.service.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const SETTINGS_REQUEST = {
  projectName: "narration test", topic: "topic", genre: "", mood: "", character: "", lore: "", fullStory: "",
  sceneCount: 3, clipDurationSeconds: 5, additionalNotes: "", styleNotes: {}, narrationEnabled: true,
};

async function setup(narrationEnabled = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-narration-")); roots.push(root);
  const projectsRoot = path.join(root, "learning_data", "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("narr", "topic", "2026-08-22T00:00:00.000Z");
  const settings = parseShortProjectSettings({ ...SETTINGS_REQUEST, narrationEnabled });
  const withSettings = applyShortProjectSettings(project, settings, "2026-08-22T00:00:00.000Z");
  withSettings.scenes = [1, 2, 3].map((number) => ({
    number, description: `scene ${number}`, narration: number === 2 ? "" : `narration line ${number}`,
  }));
  await projects.create(withSettings);
  return { root, projectsRoot, projects };
}

describe("provider-free local narration generation", () => {
  it("requires explicit approval and narrationEnabled", async () => {
    const { projectsRoot, projects } = await setup();
    const service = new LocalNarrationGenerationService(projects, projectsRoot);
    await expect(service.generate("narr", {})).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });

    const { projectsRoot: offRoot, projects: offProjects } = await setup(false);
    const offService = new LocalNarrationGenerationService(offProjects, offRoot);
    await expect(offService.generate("narr", { approved: true })).rejects.toMatchObject({ response: { code: "NARRATION_NOT_ENABLED" } });
  });

  it("synthesizes fake audio only for scenes with narration text, skipping the empty scene", async () => {
    const { projectsRoot, projects } = await setup();
    const service = new LocalNarrationGenerationService(projects, projectsRoot);
    const result = await service.generate("narr", { approved: true });
    expect(result.generatedSceneNumbers).toEqual([1, 3]);
    expect(result.reusedSceneNumbers).toEqual([]);
    expect(result.skippedSceneNumbers).toEqual([2]);
    expect(result.budget).toBeUndefined();

    const reloaded = await projects.findById("narr");
    expect(reloaded.generated_narrations[0]).toBe(service.narrationPath("narr", 1));
    expect(reloaded.generated_narrations[1]).toBeNull();
    expect(reloaded.generated_narrations[2]).toBe(service.narrationPath("narr", 3));
    await expect(fs.stat(service.narrationPath("narr", 1))).resolves.toMatchObject({ size: expect.any(Number) });
  });

  it("reuses already-generated audio on a second call instead of regenerating it", async () => {
    const { projectsRoot, projects } = await setup();
    const service = new LocalNarrationGenerationService(projects, projectsRoot);
    await service.generate("narr", { approved: true });
    const second = await service.generate("narr", { approved: true });
    expect(second.generatedSceneNumbers).toEqual([]);
    expect(second.reusedSceneNumbers).toEqual([1, 3]);
    expect(second.skippedSceneNumbers).toEqual([2]);
  });

  it("streams content only for a scene with valid generated audio", async () => {
    const { projectsRoot, projects } = await setup();
    const service = new LocalNarrationGenerationService(projects, projectsRoot);
    await expect(service.content("narr", "1")).rejects.toMatchObject({ response: { code: "NARRATION_CONTENT_UNAVAILABLE" } });
    await service.generate("narr", { approved: true });
    await expect(service.content("narr", "1")).resolves.toMatchObject({ extension: ".mp3" });
    await expect(service.content("narr", "2")).rejects.toMatchObject({ response: { code: "NARRATION_CONTENT_UNAVAILABLE" } });
  });

  it("never calls fetch and reports no budget when no OpenAI credential or budget is wired in", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { projectsRoot, projects } = await setup();
    const service = new LocalNarrationGenerationService(projects, projectsRoot);
    const result = await service.generate("narr", { approved: true });
    expect(result.budget).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("toShortProjectSettings narrationEnabled sanity", () => {
  it("round-trips narrationEnabled through applyShortProjectSettings", async () => {
    const { projects } = await setup();
    expect(toShortProjectSettings(await projects.findById("narr")).narrationEnabled).toBe(true);
  });
});
