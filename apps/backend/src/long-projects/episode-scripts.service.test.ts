import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, episodeDurationSeconds: 30, platform: "YouTube Shorts" as const, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "" };
async function setup(episodeDurationSeconds: 30 | 60 = 30) { root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-script-")); const projects = new LongProjectsService(path.join(root, "projects")); await projects.create({ projectId: "long", settings: { ...settings, episodeDurationSeconds } }); const preview = await projects.preview("long"); await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 }); return new EpisodeScriptsService(path.join(root, "projects")); }
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

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

  it("snapshots the project's real episodeDurationSeconds onto a newly created episode, not a hardcoded 30", async () => {
    const subject = await setup(60);
    await subject.generate("long", 1, {});
    const stored = JSON.parse(await fs.readFile(path.join(root!, "projects", "long", "long_story", "Episode01", "project.json"), "utf8")) as { duration_seconds: number };
    expect(stored.duration_seconds).toBe(60);
  });

  it("rejects malformed user edits and never imports a provider or media runner", async () => {
    const subject = await setup(); await subject.generate("long", 1, {});
    await expect(subject.update("long", 1, { script: { title: "x", synopsis: "x", ending: "x", scenes: [] } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const source = await fs.readFile(path.join(process.cwd(), "src", "long-projects", "episode-scripts.service.ts"), "utf8");
    expect(source).not.toMatch(/openai|runway|ffmpeg|child_process|fetch\s*\(/i);
  });
});
