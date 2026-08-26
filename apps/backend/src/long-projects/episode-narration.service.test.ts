import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EpisodeNarrationService } from "./episode-narration.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 4, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: true, subtitlesEnabled: false };

async function setup(narrationEnabled = true) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-narration-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings: { ...settings, narrationEnabled } });
  const preview = await projects.preview("long");
  await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot);
  await scripts.generate("long", 1, {});
  const narration = new EpisodeNarrationService(projectsRoot);
  return { projectsRoot, projects, scripts, narration };
}
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("EpisodeNarrationService", () => {
  it("reports each scene's template narration text and audio status without generating anything", async () => {
    const { narration } = await setup();
    const status = await narration.get("long", 1);
    expect(status.narrations).toEqual([
      { sceneNumber: 1, narration: "Scene 1 narration for Episode 1: Long story.", hasAudio: false },
      { sceneNumber: 2, narration: "Scene 2 narration for Episode 1: Long story.", hasAudio: false },
      { sceneNumber: 3, narration: "Scene 3 narration for Episode 1: Long story.", hasAudio: false },
      { sceneNumber: 4, narration: "Scene 4 narration for Episode 1: Long story.", hasAudio: false },
    ]);
  });

  it("rejects narration work before the Episode has a script", async () => {
    const { narration } = await setup();
    await expect(narration.get("long", 2)).rejects.toMatchObject({ response: { code: "LONG_EPISODE_NARRATION_NOT_ALLOWED" } });
    await expect(narration.generate("long", 2, { approved: true })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_NARRATION_NOT_ALLOWED" } });
  });

  it("generates local-fake audio for every scene, then reuses it on a second call", async () => {
    const { narration } = await setup();
    const started = await narration.generate("long", 1, { approved: true });
    expect(started.generatedSceneNumbers).toEqual([1, 2, 3, 4]);
    expect(started.reusedSceneNumbers).toEqual([]);
    expect(started.skippedSceneNumbers).toEqual([]);
    const status = await narration.get("long", 1);
    expect(status.narrations.every((item) => item.hasAudio)).toBe(true);

    const again = await narration.generate("long", 1, { approved: true });
    expect(again.generatedSceneNumbers).toEqual([]);
    expect(again.reusedSceneNumbers).toEqual([1, 2, 3, 4]);
  });

  it("skips a scene with no narration text instead of failing the whole batch", async () => {
    const { narration, scripts } = await setup();
    const episode = await scripts.get("long", 1);
    const script = episode.episode.script!;
    script.scenes[1] = { ...script.scenes[1]!, narration: "" };
    await scripts.update("long", 1, { script });
    const started = await narration.generate("long", 1, { approved: true });
    expect(started.generatedSceneNumbers).toEqual([1, 3, 4]);
    expect(started.skippedSceneNumbers).toEqual([2]);
  });

  it("rejects generation when narrationEnabled is off", async () => {
    const { narration } = await setup(false);
    await expect(narration.generate("long", 1, { approved: true })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_NARRATION_NOT_ENABLED" } });
  });

  it("regenerates one scene's fake audio and marks the record regenerated", async () => {
    const { narration } = await setup();
    await narration.generate("long", 1, { approved: true });
    const result = await narration.regenerate("long", 1, "2", { approved: true });
    expect(result.sceneNumber).toBe(2);
    expect(result.narrations[1]).toMatchObject({ hasAudio: true });
    expect(result.retryEstimate).toBeUndefined();
    const records = JSON.parse(await fs.readFile(path.join(root!, "projects", "long", "long_story", "Episode01", "narration_generation_records.json"), "utf8")) as Array<{ scene_number: number; regenerated?: boolean }>;
    expect(records.find((item) => item.scene_number === 2)?.regenerated).toBe(true);
  });

  it("rejects regenerating a scene with no narration text, and a scene number outside the Episode's own range", async () => {
    const { narration, scripts } = await setup();
    const episode = await scripts.get("long", 1);
    const script = episode.episode.script!;
    script.scenes[0] = { ...script.scenes[0]!, narration: "" };
    await scripts.update("long", 1, { script });
    await expect(narration.regenerate("long", 1, "1", { approved: true })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_NARRATION_MISSING_TEXT" } });
    await expect(narration.regenerate("long", 1, "99", { approved: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(narration.regenerate("long", 1, "1", {})).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("serves generated audio content only once it exists, by scene number bounded to the Episode's own scene count", async () => {
    const { narration } = await setup();
    await expect(narration.content("long", 1, "1")).rejects.toMatchObject({ response: { code: "LONG_EPISODE_NARRATION_CONTENT_UNAVAILABLE" } });
    await expect(narration.content("long", 1, "99")).rejects.toMatchObject({ response: { code: "LONG_EPISODE_NARRATION_CONTENT_UNAVAILABLE" } });
    await narration.generate("long", 1, { approved: true });
    const content = await narration.content("long", 1, "1");
    expect(content.extension).toBe(".mp3");
    await expect(fs.access(content.path)).resolves.toBeUndefined();
  });

  it("never imports a provider, network client, FFmpeg, or subprocess", async () => {
    const source = await fs.readFile(path.join(process.cwd(), "src", "long-projects", "episode-narration.service.ts"), "utf8");
    expect(source).not.toMatch(/runway|ffmpeg|child_process/i);
  });
});
