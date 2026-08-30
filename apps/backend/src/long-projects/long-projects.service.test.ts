import * as fs from "node:fs/promises";
import { withProjectLock } from "../videos/project-lock.js";
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

  /**
   * Whether each Episode has a continuity memo, per Episode.
   *
   * The memo is written by hand and nothing writes it automatically, and a later Episode's script prompt reads
   * every earlier memo while silently skipping the absent ones. So an Episode without one contributes nothing
   * to any script written after it, and the only way to notice was to read the finished script — after paying
   * for it. The timeline could not say so: an outline carried no fact about the memo, and asking per Episode
   * meant one request per row.
   *
   * Asserted across two Episodes at once on purpose. A single row would pass for an implementation that
   * answers the same thing for every Episode, which is the shape this would most plausibly be got wrong in.
   */
  it("reports a continuity memo per Episode, so the timeline does not have to ask once per row", async () => {
    const subject = await service();
    await subject.create(input);
    const episodeOne = path.join(root!, "projects", "long_test", "long_story", "Episode01");
    await fs.mkdir(episodeOne, { recursive: true });
    await fs.writeFile(path.join(episodeOne, "continuity.json"), JSON.stringify({ episode_number: 1, episode_summary: "she finds the tape" }), "utf8");

    const episodes = (await subject.get("long_test")).project.episodes;

    expect(episodes.map((episode) => episode.continuitySaved)).toEqual([true, false, false]);
  });

  it("moves the outline list with the episode count instead of leaving a project that cannot be opened", async () => {
    // Changing the number wrote project.json and left the outline list at its old length. Every read checks that
    // the two match, so the save itself reported LONG_PROJECT_DATA_INVALID — after having already written — and
    // so did every read afterwards. A number typed on the settings screen made the project unreachable from
    // inside the app, with no way back to it.
    const subject = await service();
    await subject.create(input);

    const grown = await subject.updateSettings("long_test", { settings: { ...input.settings, episodeCount: 5 } });
    expect(grown.project.episodes).toHaveLength(5);
    expect(grown.project.episodes[4]).toMatchObject({ episodeNumber: 5, status: "planned" });
    // Readable afterwards, which is the part that was broken.
    expect((await subject.get("long_test")).project.episodes).toHaveLength(5);

    const shrunk = await subject.updateSettings("long_test", { settings: { ...input.settings, episodeCount: 2 } });
    expect(shrunk.project.episodes.map((episode) => episode.episodeNumber)).toEqual([1, 2]);
  });

  it("refuses to drop an Episode that has been worked on, rather than losing what was paid for", async () => {
    // Shrinking is only safe while the Episodes going away are untouched. Their scripts and images stay on disk,
    // so dropping the outline entry would leave paid work with nothing pointing at it.
    const subject = await service();
    await subject.create(input);
    const outlines = path.join(root!, "projects", "long_test", "long_story", "episode_outlines.json");
    const stored = JSON.parse(await fs.readFile(outlines, "utf8")) as Array<Record<string, unknown>>;
    stored[2] = { ...stored[2], status: "images_review" };
    await fs.writeFile(outlines, JSON.stringify(stored), "utf8");

    await expect(subject.updateSettings("long_test", { settings: { ...input.settings, episodeCount: 2 } }))
      .rejects.toMatchObject({ response: { code: "LONG_PROJECT_EPISODE_COUNT_LOCKED", details: { episodeNumber: 3 } } });
    expect((await subject.get("long_test")).project.episodes).toHaveLength(3);
  });

  it("does not send the model both the current title and the one it replaced", async () => {
    // create() copies eight settings fields into the Story Bible's `basic`, and updateSettings() writes only
    // project.json — so the copy goes stale the first time anything is renamed. Both prompt paths carry the
    // Bible next to the settings, which means the model is handed the new title and the old one together and
    // has to guess. Invisible on a fresh project, because the two agree until something is edited.
    const subject = await service();
    await subject.create(input);
    await subject.updateSettings("long_test", { settings: { ...input.settings, title: "새 제목", logline: "새 한 줄" } });

    const { preview } = await subject.preview("long_test");
    expect(preview.prompt).toContain("새 제목");
    expect(preview.prompt).not.toContain(input.settings.title);
    expect(preview.prompt).not.toContain(input.settings.logline);

    // Two separate repairs, and the prompt above only proves the first. The filter is what keeps an older
    // project's stale copy out; this is the other half — a new project is not given one to go stale.
    const bible = JSON.parse(await fs.readFile(path.join(root!, "projects", "long_test", "long_story", "story_bible.json"), "utf8")) as { basic: Record<string, unknown> };
    expect(bible.basic).toEqual({});
  });

  it("refuses an aspect ratio change once an Episode has images, while every other setting stays editable", async () => {
    // Images, video generation and the merge each read the project's ratio when they run. Change it midway and
    // portrait images get sent to Runway asking for landscape video, which the merge then pads to the new shape
    // — all paid, none of it matching. This repository has already shipped a project generated, billed and
    // merged in the wrong orientation once; this is the version a settings save can cause.
    const subject = await service();
    await subject.create(input);
    const outlines = path.join(root!, "projects", "long_test", "long_story", "episode_outlines.json");

    // Before any images, changing it is ordinary — and the settings GET says so, with no Episode named.
    const open = await subject.getSettings("long_test");
    expect(open.aspectRatioChangeable).toBe(true);
    expect(open.aspectRatioLockedByEpisodeNumber).toBeUndefined();
    const flipped = { ...input.settings, aspectRatio: "16:9" as const };
    await subject.updateSettings("long_test", { settings: flipped });
    expect((await subject.getSettings("long_test")).settings.aspectRatio).toBe("16:9");

    const stored = JSON.parse(await fs.readFile(outlines, "utf8")) as Array<Record<string, unknown>>;
    stored[1] = { ...stored[1], status: "images_review" };
    await fs.writeFile(outlines, JSON.stringify(stored), "utf8");

    await expect(subject.updateSettings("long_test", { settings: input.settings }))
      .rejects.toMatchObject({ response: { code: "LONG_PROJECT_ASPECT_RATIO_LOCKED", details: { episodeNumber: 2 } } });
    expect((await subject.getSettings("long_test")).settings.aspectRatio).toBe("16:9");

    // The settings GET says the same thing the save just did, from the same code — and names the Episode that
    // closed it, because "you cannot change this any more" without "which one did it" only raises the question.
    // The screen must never re-derive this: two copies of the rule is two answers about paid work.
    expect(await subject.getSettings("long_test")).toMatchObject({
      aspectRatioChangeable: false, aspectRatioLockedByEpisodeNumber: 2,
    });

    // The rest of the form still saves — including the scene count, which is only a default for new Episodes now.
    const renamed = await subject.updateSettings("long_test", { settings: { ...flipped, title: "다른 제목", sceneCount: 8 } });
    expect(renamed.project.settings).toMatchObject({ title: "다른 제목", sceneCount: 8, aspectRatio: "16:9" });
  });

  it("derives episodeDurationSeconds from the scene count and clip length, and refuses to be told one", async () => {
    // Named for a rule that stopped existing: it said 30 or 60 were the only durations "6 fixed scenes x
    // Runway's 5s/10s clips" could produce, from when the scene count was fixed at six. The value is derived
    // now, so what is actually worth holding is that it is derived and that supplying one is refused — which is
    // also the only reason the old assertion still passed, since 45 was rejected as an unknown field rather
    // than as a disallowed duration.
    const subject = await service();
    await expect(subject.create({ ...input, settings: { ...input.settings, episodeDurationSeconds: 45 } as never }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });

    const created = await subject.create(input);
    expect(created.project.settings.episodeDurationSeconds).toBe(input.settings.sceneCount * input.settings.clipDurationSeconds);
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

    expect([first, second].filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);

    // Which refusal the loser gets depends on whether the two actually overlapped, and that is a matter of
    // timing rather than of correctness: PROJECT_LOCKED means it arrived while the first was still generating,
    // LONG_OUTLINE_NOT_ALLOWED means it arrived after. Both mean it did not reach the paid call, which is the
    // thing under test — pinning one of them would make this pass or fail on machine speed.
    const rejected = [first, second].find((outcome) => outcome.status === "rejected");
    const code = (rejected as PromiseRejectedResult).reason.response.code as string;
    expect(["PROJECT_LOCKED", "LONG_OUTLINE_NOT_ALLOWED"]).toContain(code);
  });

  it("refuses at once while an approval is genuinely in flight, instead of waiting out the lock", async () => {
    // The previous test passes without ever reaching the lock: in fake mode the first approval finishes before
    // the second starts, so the refusal comes from the state. This one holds the lock for real.
    //
    // Waiting is the wrong default here. The holder takes as long as the model does, so the ten-second wait is
    // spent to arrive at a refusal that was certain from the start — by the time the holder finishes, the
    // outline exists and this call is invalid. The screen would sit frozen through it and then show an error.
    const subject = await service();
    await subject.create(input);
    const preview = await subject.preview("long_test");
    const approval = { approved: true as const, promptSha256: preview.preview.promptSha256, prompt: preview.preview.prompt };
    const projectDirectory = path.join(root!, "projects", "long_test");

    let refusal: unknown;
    const startedAt = Date.now();
    await withProjectLock(projectDirectory, "long_test:long-outline", async () => {
      refusal = await subject.approve("long_test", approval).catch((error: unknown) => error);
    });

    expect(refusal).toMatchObject({ response: { code: "PROJECT_LOCKED" } });
    // Nowhere near the ten seconds the default would have spent.
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    // And nothing was generated: the outline is still waiting to be approved.
    expect((await subject.get("long_test")).project.outlineStatus).toBe("planned");
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
