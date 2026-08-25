import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { parseShortProjectSettings, applyShortProjectSettings } from "../projects/project-settings.js";
import { LocalNarrationGenerationService } from "./local-narration-generation.service.js";
import { NarrationReviewService } from "./narration-review.service.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const SETTINGS_REQUEST = {
  projectName: "narration review test", topic: "topic", genre: "", mood: "", character: "", lore: "", fullStory: "",
  sceneCount: 2, clipDurationSeconds: 5, additionalNotes: "", styleNotes: {}, narrationEnabled: true,
};

async function setup(narrationEnabled = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "narration-review-")); roots.push(root);
  const projectsRoot = path.join(root, "learning_data", "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("narr", "topic", "2026-08-22T00:00:00.000Z");
  const settings = parseShortProjectSettings({ ...SETTINGS_REQUEST, narrationEnabled });
  const withSettings = applyShortProjectSettings(project, settings, "2026-08-22T00:00:00.000Z");
  withSettings.scenes = [1, 2].map((number) => ({
    number, description: `scene ${number}`, narration: number === 2 ? "" : "narration line 1",
  }));
  await projects.create(withSettings);
  const generation = new LocalNarrationGenerationService(projects, projectsRoot);
  const reviews = new NarrationReviewService(projects, generation);
  return { root, projectsRoot, projects, generation, reviews };
}

describe("NarrationReviewService", () => {
  it("reports each scene's narration text and audio status without generating anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { reviews, generation } = await setup();
    const status = await reviews.getStatus("narr");
    expect(status.narrations).toEqual([
      { sceneNumber: 1, narration: "narration line 1", hasAudio: false },
      { sceneNumber: 2, narration: "", hasAudio: false },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();

    await generation.generate("narr", { approved: true });
    const after = await reviews.getStatus("narr");
    expect(after.narrations[0]).toMatchObject({ hasAudio: true });
    expect(after.narrations[1]).toMatchObject({ hasAudio: false });
  });

  it("regenerates one scene's fake audio and bumps its record", async () => {
    const { reviews, generation } = await setup();
    await generation.generate("narr", { approved: true });
    const result = await reviews.regenerate("narr", "1", { approved: true });
    expect(result.sceneNumber).toBe(1);
    expect(result.narrations[0]).toMatchObject({ hasAudio: true });
    expect(result.retryEstimate).toBeUndefined();
  });

  it("rejects regenerating a scene with no narration text", async () => {
    const { reviews } = await setup();
    await expect(reviews.regenerate("narr", "2", { approved: true })).rejects.toMatchObject({ response: { code: "NARRATION_MISSING_TEXT" } });
  });

  it("rejects regenerating when narrationEnabled is off", async () => {
    const { reviews } = await setup(false);
    await expect(reviews.regenerate("narr", "1", { approved: true })).rejects.toMatchObject({ response: { code: "NARRATION_NOT_ENABLED" } });
  });

  it("rejects a scene number outside the project's range and a missing approval body", async () => {
    const { reviews } = await setup();
    await expect(reviews.regenerate("narr", "99", { approved: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(reviews.regenerate("narr", "1", {})).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });
});
