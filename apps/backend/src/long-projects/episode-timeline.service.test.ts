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
    await new EpisodeScriptsService(projectsRoot).generate("timeline_test", 1, { userRequestId: "episode-timeline.service-script-1" });
    await expect(timeline.add("timeline_test", {})).rejects.toMatchObject({ response: { code: "LONG_EPISODE_TIMELINE_NOT_ALLOWED" } });
  });

  describe("updateOutline", () => {
    it("edits an Episode's outline fields while still planned (before whole-project outline approval)", async () => {
      const { timeline } = await services();
      const result = await timeline.updateOutline("timeline_test", 1, { outline: { title: "  다시 쓴 제목  ", cliffhanger: "새 클리프행어" } });
      expect(result.episode).toMatchObject({ episodeNumber: 1, title: "다시 쓴 제목", cliffhanger: "새 클리프행어", status: "planned" });
      expect(result.episode.summary).toBe("");
      expect(result.project.episodes[0]).toMatchObject({ title: "다시 쓴 제목", cliffhanger: "새 클리프행어" });
    });

    it("edits an Episode's outline fields once outline_ready (after whole-project outline approval), and persists to disk", async () => {
      const { projectsRoot, projects, timeline } = await services();
      const preview = await projects.preview("timeline_test");
      await projects.approve("timeline_test", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
      const result = await timeline.updateOutline("timeline_test", 2, { outline: { summary: "수정된 요약", mainEvent: "수정된 핵심 사건", conflict: "수정된 갈등", nextEpisodeHook: "수정된 다음 화 연결" } });
      expect(result.episode).toMatchObject({ episodeNumber: 2, summary: "수정된 요약", mainEvent: "수정된 핵심 사건", conflict: "수정된 갈등", nextEpisodeHook: "수정된 다음 화 연결", status: "outline_ready" });
      const stored = JSON.parse(await fs.readFile(path.join(projectsRoot, "timeline_test", "long_story", "episode_outlines.json"), "utf8")) as Array<Record<string, unknown>>;
      expect(stored[1]).toMatchObject({ summary: "수정된 요약", main_event: "수정된 핵심 사건", conflict: "수정된 갈등", next_episode_hook: "수정된 다음 화 연결" });
    });

    it("blocks editing one Episode's outline once its own script workflow has started, but not a sibling Episode still outline_ready", async () => {
      const { projectsRoot, projects, timeline } = await services();
      const preview = await projects.preview("timeline_test");
      await projects.approve("timeline_test", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
      await new EpisodeScriptsService(projectsRoot).generate("timeline_test", 1, { userRequestId: "episode-timeline.service-script-2" });
      await expect(timeline.updateOutline("timeline_test", 1, { outline: { title: "너무 늦음" } })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_TIMELINE_NOT_ALLOWED" } });
      const stillEditable = await timeline.updateOutline("timeline_test", 2, { outline: { title: "아직 됨" } });
      expect(stillEditable.episode.title).toBe("아직 됨");
    });

    it("rejects an unknown episode number, an unknown field, and a blank value", async () => {
      const { timeline } = await services();
      await expect(timeline.updateOutline("timeline_test", 3, { outline: { title: "x" } })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_NOT_FOUND" } });
      await expect(timeline.updateOutline("timeline_test", 1, { outline: { status: "outline_ready" } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
      await expect(timeline.updateOutline("timeline_test", 1, { outline: { title: "   " } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
      await expect(timeline.updateOutline("timeline_test", 1, { outline: {} })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    });
  });
});
