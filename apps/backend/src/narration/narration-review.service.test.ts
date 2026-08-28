import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { parseShortProjectSettings, applyShortProjectSettings } from "../projects/project-settings.js";
import { LocalNarrationGenerationService } from "./local-narration-generation.service.js";
import { NarrationReviewService } from "./narration-review.service.js";
import type { probeAudioDurationSeconds } from "./audio-duration.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const SETTINGS_REQUEST = {
  projectName: "narration review test", topic: "topic", genre: "", mood: "", character: "", lore: "", fullStory: "",
  sceneCount: 2, clipDurationSeconds: 5, additionalNotes: "", styleNotes: {}, narrationEnabled: true, subtitlesEnabled: false,
};

async function setup(narrationEnabled = true, probeDuration: typeof probeAudioDurationSeconds = async () => undefined) {
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
  const reviews = new NarrationReviewService(projects, generation, undefined, undefined, probeDuration);
  return { root, projectsRoot, projects, generation, reviews };
}

describe("NarrationReviewService", () => {
  it("reports each scene's narration text and audio status without generating anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { reviews, generation } = await setup();
    const status = await reviews.getStatus("narr");
    expect(status.narrations).toEqual([
      { sceneNumber: 1, narration: "narration line 1", audio: "none" },
      { sceneNumber: 2, narration: "", audio: "none" },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();

    await generation.generate("narr", { approved: true });
    const after = await reviews.getStatus("narr");
    expect(after.narrations[0]).toMatchObject({ audio: "placeholder" });
    expect(after.narrations[1]).toMatchObject({ audio: "none" });
    expect(after.staleness).toEqual({ imageStale: [], videoStale: [], narrationStale: [] });
  });

  it("flags narrationStale once the scene's narration text is edited after audio was generated", async () => {
    const { reviews, generation, projects } = await setup();
    await generation.generate("narr", { approved: true });
    const project = await projects.findById("narr");
    project.scenes[0] = { ...(project.scenes[0] as Record<string, unknown>), narration: "고친 내레이션" };
    await projects.save(project);
    const status = await reviews.getStatus("narr");
    expect(status.staleness?.narrationStale).toEqual([1]);
  });

  it("regenerates one scene's fake audio and bumps its record", async () => {
    const { reviews, generation } = await setup();
    await generation.generate("narr", { approved: true });
    const result = await reviews.regenerate("narr", "1", { approved: true });
    expect(result.sceneNumber).toBe(1);
    expect(result.narrations[0]).toMatchObject({ audio: "placeholder" });
    expect(result.retryEstimate).toBeUndefined();
  });

  it("rejects regenerating a scene with no narration text", async () => {
    const { reviews } = await setup();
    await expect(reviews.regenerate("narr", "2", { approved: true })).rejects.toMatchObject({ response: { code: "NARRATION_MISSING_TEXT" } });
  });

  it("includes the measured audio length only for scenes that actually have audio", async () => {
    const probeDuration = vi.fn(async (file: string) => (file.endsWith("scene1.mp3") ? 4.2 : undefined));
    const { reviews, generation } = await setup(true, probeDuration);
    await generation.generate("narr", { approved: true });
    const status = await reviews.getStatus("narr");
    expect(status.narrations[0]).toMatchObject({ audio: "placeholder", audioDurationSeconds: 4.2 });
    expect(status.narrations[1]!.audioDurationSeconds).toBeUndefined();
    expect(probeDuration).toHaveBeenCalledTimes(1);
  });

  it("omits audioDurationSeconds when the file exists but its length can't be measured (e.g. ffprobe unavailable)", async () => {
    const { reviews, generation } = await setup();
    await generation.generate("narr", { approved: true });
    const status = await reviews.getStatus("narr");
    expect(status.narrations[0]).toMatchObject({ audio: "placeholder" });
    expect(status.narrations[0]!.audioDurationSeconds).toBeUndefined();
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
