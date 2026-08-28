import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const input = { projectId: "long_test", settings: { title: "A long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 3, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false } };
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

  it("rejects an episodeDurationSeconds other than 30 or 60 — the only durations 6 fixed scenes x Runway's 5s/10s clips can produce", async () => {
    const subject = await service();
    await expect(subject.create({ ...input, settings: { ...input.settings, episodeDurationSeconds: 45 as 30 } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const created = await subject.create(input);
    expect(created.project.settings.episodeDurationSeconds).toBe(30);
  });

  it("rejects a non-boolean narrationEnabled or subtitlesEnabled on create", async () => {
    const subject = await service();
    await expect(subject.create({ ...input, settings: { ...input.settings, narrationEnabled: "yes" as unknown as boolean } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(subject.create({ ...input, settings: { ...input.settings, subtitlesEnabled: 1 as unknown as boolean } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("falls back subtitlesEnabled to narrationEnabled's own value for a project stored before subtitlesEnabled existed", async () => {
    const subject = await service(); await subject.create(input);
    const file = path.join(root!, "projects", "long_test", "long_story", "project.json");
    const stored = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    stored.narration_enabled = true; delete stored.subtitles_enabled;
    await fs.writeFile(file, JSON.stringify(stored, null, 2), "utf8");
    const reloaded = new LongProjectsService(path.join(root!, "projects"));
    const settings = (await reloaded.get("long_test")).project.settings;
    expect(settings).toMatchObject({ narrationEnabled: true, subtitlesEnabled: true });
  });

  it("defaults both narrationEnabled and subtitlesEnabled to false for a project stored before either field existed", async () => {
    const subject = await service(); await subject.create(input);
    const file = path.join(root!, "projects", "long_test", "long_story", "project.json");
    const stored = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    delete stored.narration_enabled; delete stored.subtitles_enabled;
    await fs.writeFile(file, JSON.stringify(stored, null, 2), "utf8");
    const reloaded = new LongProjectsService(path.join(root!, "projects"));
    const settings = (await reloaded.get("long_test")).project.settings;
    expect(settings).toMatchObject({ narrationEnabled: false, subtitlesEnabled: false });
  });

  it("still loads a project stored before `platform` was removed, and no longer writes it back", async () => {
    const subject = await service(); await subject.create(input);
    const file = path.join(root!, "projects", "long_test", "long_story", "project.json");
    const stored = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    expect(stored).not.toHaveProperty("platform");
    stored.platform = "YouTube Shorts";
    await fs.writeFile(file, JSON.stringify(stored, null, 2), "utf8");
    const reloaded = new LongProjectsService(path.join(root!, "projects"));
    const settings = (await reloaded.get("long_test")).project.settings;
    expect(settings).not.toHaveProperty("platform");
    await reloaded.updateSettings("long_test", { settings: { ...input.settings, title: "renamed" } });
    const resaved = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    expect(resaved).not.toHaveProperty("platform");
  });

  it("requires an unchanged preview before local outline approval and creates no scripts or media", async () => {
    const subject = await service(); await subject.create(input); const preview = await subject.preview("long_test");
    await expect(subject.approve("long_test", { approved: true, promptSha256: "wrong", prompt: preview.preview.prompt })).rejects.toMatchObject({ response: { code: "LONG_OUTLINE_STALE" } });
    const result = await subject.approve("long_test", { approved: true, promptSha256: preview.preview.promptSha256, prompt: preview.preview.prompt });
    expect(result.project.outlineStatus).toBe("outline_ready");
    expect(result.project.episodes.every((episode) => episode.status === "outline_ready")).toBe(true);
    await expect(fs.access(path.join(root!, "projects", "long_test", "long_story", "episodes"))).rejects.toBeTruthy();
  });

  it("charges once when approve is pressed twice, even simultaneously", async () => {
    // 🔴 This really happened, twenty-three seconds apart and twice billed. The status check and the status
    // write sit on either side of the paid call, so a second press taken while the first was still generating
    // read "planned" and went ahead. Pressing again is what a person does when a slow step gives no sign of
    // life, so the app has to be the thing that refuses.
    //
    // The lock does not refuse the second press; it makes it wait, and by the time it runs the status is
    // already outline_ready. The refusal comes from the state rather than from timing.
    const subject = await service();
    await subject.create(input);
    const preview = await subject.preview("long_test");
    const approval = { approved: true as const, promptSha256: preview.preview.promptSha256, prompt: preview.preview.prompt };

    const [first, second] = await Promise.allSettled([
      subject.approve("long_test", approval),
      subject.approve("long_test", approval),
    ]);

    const fulfilled = [first, second].filter((outcome) => outcome.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const rejected = [first, second].find((outcome) => outcome.status === "rejected");
    expect(rejected).toMatchObject({ reason: { response: { code: "LONG_OUTLINE_NOT_ALLOWED" } } });
  });

  it("refuses a second approval once the outline exists, however long afterwards", async () => {
    const subject = await service();
    await subject.create(input);
    const preview = await subject.preview("long_test");
    const approval = { approved: true as const, promptSha256: preview.preview.promptSha256, prompt: preview.preview.prompt };
    await subject.approve("long_test", approval);

    await expect(subject.approve("long_test", approval)).rejects.toMatchObject({ response: { code: "LONG_OUTLINE_NOT_ALLOWED" } });
  });

  it("rejects unsafe IDs and skips corrupt projects when listing", async () => {
    const subject = await service(); await expect(subject.create({ ...input, projectId: "../bad" })).rejects.toMatchObject({ response: { code: "UNSAFE_PROJECT_ID" } });
    await fs.mkdir(path.join(root!, "projects", "broken", "long_story"), { recursive: true });
    await fs.writeFile(path.join(root!, "projects", "broken", "long_story", "project.json"), "{", "utf8");
    expect((await subject.list()).projects).toEqual([]);
  });
});
