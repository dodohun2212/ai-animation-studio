import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const input = { projectId: "long_test", settings: { title: "A long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 3, episodeDurationSeconds: 30, platform: "YouTube Shorts" as const, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "" } };
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });
async function service(): Promise<LongProjectsService> { root = await fs.mkdtemp(path.join(os.tmpdir(), "long-project-")); return new LongProjectsService(path.join(root, "projects")); }

describe("LongProjectsService", () => {
  it("stores a separate planned long project and reloads it from a fresh service", async () => {
    const first = await service(); const created = await first.create(input);
    expect(created.project.episodes).toHaveLength(3);
    expect(created.project.episodes.every((episode) => episode.status === "planned")).toBe(true);
    const second = new LongProjectsService(path.join(root!, "projects"));
    expect((await second.get("long_test")).project.settings.title).toBe("A long story");
    expect(await fs.stat(path.join(root!, "projects", "long_test", "long_story", "story_bible.json"))).toBeTruthy();
  });

  it("requires an unchanged preview before local outline approval and creates no scripts or media", async () => {
    const subject = await service(); await subject.create(input); const preview = await subject.preview("long_test");
    await expect(subject.approve("long_test", { approved: true, promptSha256: "wrong", prompt: preview.preview.prompt })).rejects.toMatchObject({ response: { code: "LONG_OUTLINE_STALE" } });
    const result = await subject.approve("long_test", { approved: true, promptSha256: preview.preview.promptSha256, prompt: preview.preview.prompt });
    expect(result.project.outlineStatus).toBe("outline_ready");
    expect(result.project.episodes.every((episode) => episode.status === "outline_ready")).toBe(true);
    await expect(fs.access(path.join(root!, "projects", "long_test", "long_story", "episodes"))).rejects.toBeTruthy();
  });

  it("rejects unsafe IDs and skips corrupt projects when listing", async () => {
    const subject = await service(); await expect(subject.create({ ...input, projectId: "../bad" })).rejects.toMatchObject({ response: { code: "UNSAFE_PROJECT_ID" } });
    await fs.mkdir(path.join(root!, "projects", "broken", "long_story"), { recursive: true });
    await fs.writeFile(path.join(root!, "projects", "broken", "long_story", "project.json"), "{", "utf8");
    expect((await subject.list()).projects).toEqual([]);
  });
});
