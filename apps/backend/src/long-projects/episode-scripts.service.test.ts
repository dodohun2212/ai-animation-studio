import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, platform: "YouTube Shorts" as const, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
async function setup(episodeDurationSeconds: 30 | 60 = 30, sceneCount = 6) { root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-script-")); const projects = new LongProjectsService(path.join(root, "projects")); await projects.create({ projectId: "long", settings: { ...settings, sceneCount, clipDurationSeconds: episodeDurationSeconds === 60 ? 10 : 5 } }); const preview = await projects.preview("long"); await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 }); return new EpisodeScriptsService(path.join(root, "projects")); }
afterEach(async () => { vi.unstubAllGlobals(); if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("EpisodeScriptsService", () => {
  it("creates, edits, preserves history, and approves one six-scene local episode script", async () => {
    const subject = await setup();
    await expect(subject.get("long", 3)).rejects.toMatchObject({ response: { code: "LONG_EPISODE_NOT_FOUND" } });
    const generated = await subject.generate("long", 1, {});
    expect(generated.episode).toMatchObject({ status: "script_review", approved: false, scriptRevision: 1 });
    expect(generated.episode.script?.scenes.map((scene) => scene.number)).toEqual([1, 2, 3, 4, 5, 6]);
    await expect(subject.generate("long", 1, {})).rejects.toMatchObject({ response: { code: "LONG_EPISODE_SCRIPT_EXISTS" } });
    const script = generated.episode.script!; script.title = "Edited";
    const edited = await subject.update("long", 1, { script });
    expect(edited.episode).toMatchObject({ scriptRevision: 2, scriptHistoryCount: 2 });
    const approved = await subject.approve("long", 1, { approved: true });
    expect(approved.episode).toMatchObject({ status: "script_approved", approved: true });
    const reloaded = new EpisodeScriptsService(path.join(root!, "projects"));
    expect((await reloaded.get("long", 1)).episode.script?.title).toBe("Edited");
    await expect(fs.access(path.join(root!, "projects", "long", "long_story", "Episode01", "script.json"))).resolves.toBeUndefined();
  });

  it("generates a template narration sentence for every scene, round-trips an edit, and rejects a non-string narration", async () => {
    const subject = await setup();
    const generated = await subject.generate("long", 1, {});
    expect(generated.episode.script?.scenes.every((scene) => typeof scene.narration === "string" && scene.narration.length > 0)).toBe(true);
    const script = generated.episode.script!;
    script.scenes[0] = { ...script.scenes[0]!, narration: "고친 내레이션" };
    const edited = await subject.update("long", 1, { script });
    expect(edited.episode.script?.scenes[0]?.narration).toBe("고친 내레이션");
    const reloaded = new EpisodeScriptsService(path.join(root!, "projects"));
    expect((await reloaded.get("long", 1)).episode.script?.scenes[0]?.narration).toBe("고친 내레이션");
    await expect(subject.update("long", 1, { script: { ...script, scenes: [{ ...script.scenes[0]!, narration: 5 as unknown as string }, ...script.scenes.slice(1)] } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("snapshots the project's real episodeDurationSeconds onto a newly created episode, not a hardcoded 30", async () => {
    const subject = await setup(60);
    await subject.generate("long", 1, {});
    const stored = JSON.parse(await fs.readFile(path.join(root!, "projects", "long", "long_story", "Episode01", "project.json"), "utf8")) as { duration_seconds: number };
    expect(stored.duration_seconds).toBe(60);
  });

  it("generates and edits a script sized to the project's own scene count, not a hardcoded six", async () => {
    const subject = await setup(30, 9);
    const generated = await subject.generate("long", 1, {});
    expect(generated.episode.script?.scenes.map((scene) => scene.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const script = generated.episode.script!;
    const edited = await subject.update("long", 1, { script });
    expect(edited.episode.script?.scenes).toHaveLength(9);
    await expect(subject.update("long", 1, { script: { ...script, scenes: script.scenes.slice(0, 6) } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("rejects malformed user edits", async () => {
    const subject = await setup(); await subject.generate("long", 1, {});
    await expect(subject.update("long", 1, { script: { title: "x", synopsis: "x", ending: "x", scenes: [] } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("never calls fetch when no OpenAI credential/budget is wired in", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const subject = await setup();
    await subject.generate("long", 1, {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
