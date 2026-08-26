import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EpisodeTimelineService } from "./episode-timeline.service.js";
import { LongProjectsService } from "./long-projects.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";

let root: string | undefined;
const input = { projectId: "timeline_test", settings: { title: "Timeline story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false } };
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });
async function services() { root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-timeline-")); const projectsRoot = path.join(root, "projects"); const projects = new LongProjectsService(projectsRoot); await projects.create(input); return { projectsRoot, projects, timeline: new EpisodeTimelineService(projectsRoot) }; }

describe("EpisodeTimelineService", () => {
  it("appends a blank planned Episode and persists its project, outline, and dense index", async () => {
    const { projectsRoot, timeline } = await services();
    const result = await timeline.add("timeline_test", { title: "  새 회차  " });
    expect(result.episode).toMatchObject({ episodeNumber: 3, title: "새 회차", status: "planned" });
    expect(result.project.episodeCount).toBe(3);
    const rootPath = path.join(projectsRoot, "timeline_test", "long_story");
    expect(JSON.parse(await fs.readFile(path.join(rootPath, "episode_outlines.json"), "utf8"))).toHaveLength(3);
    expect(JSON.parse(await fs.readFile(path.join(rootPath, "Episode03", "project.json"), "utf8"))).toMatchObject({ number: 3, state: "planned", script: {} });
  });

  it("duplicates only outline metadata into a fresh planned Episode", async () => {
    const { timeline } = await services();
    const result = await timeline.duplicate("timeline_test", 1);
    expect(result.episode).toMatchObject({ episodeNumber: 3, title: "Episode 1 복사본", status: "planned" });
    expect(result.project.episodes).toHaveLength(3);
  });

  it("archives only the final draft Episode and leaves a recoverable directory", async () => {
    const { projectsRoot, timeline } = await services();
    await timeline.add("timeline_test", {});
    const result = await timeline.archive("timeline_test", 3, { approved: true });
    expect(result.project.episodeCount).toBe(2);
    await expect(fs.access(path.join(projectsRoot, "timeline_test", "long_story", "Episode03"))).rejects.toBeTruthy();
    expect((await fs.readdir(path.join(projectsRoot, "timeline_test", "long_story", "episode_archives"))).some((item) => item.startsWith("Episode03-"))).toBe(true);
    await expect(timeline.archive("timeline_test", 1, { approved: true })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_TIMELINE_NOT_ALLOWED" } });
  });

  it("blocks timeline changes once a script workflow has started", async () => {
    const { projectsRoot, projects, timeline } = await services();
    const preview = await projects.preview("timeline_test");
    await projects.approve("timeline_test", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
    await new EpisodeScriptsService(projectsRoot).generate("timeline_test", 1, {});
    await expect(timeline.add("timeline_test", {})).rejects.toMatchObject({ response: { code: "LONG_EPISODE_TIMELINE_NOT_ALLOWED" } });
  });
});
