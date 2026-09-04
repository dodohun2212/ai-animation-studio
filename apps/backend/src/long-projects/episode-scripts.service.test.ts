import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { LongProjectsService } from "./long-projects.service.js";
import { withProjectLock } from "../videos/project-lock.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
async function setup(episodeDurationSeconds: 30 | 60 = 30, sceneCount = 6) { root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-script-")); const projects = new LongProjectsService(path.join(root, "projects")); await projects.create({ projectId: "long", settings: { ...settings, sceneCount, clipDurationSeconds: episodeDurationSeconds === 60 ? 10 : 5 } }); const preview = await projects.preview("long"); await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 }); return new EpisodeScriptsService(path.join(root, "projects")); }
afterEach(async () => { vi.unstubAllGlobals(); if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("EpisodeScriptsService", () => {
  it("starts an Episode from the project's values and lets it be given its own, which the script is then written to", async () => {
    // The point of the write path, and the only assertion that proves it is worth having: the pipeline already
    // read the Episode's own copy rather than the project's, so what was missing was any way to change that
    // copy. Generating afterwards and counting the scenes is what shows the change reached the work.
    const subject = await setup(30, 6);
    const before = await subject.settings("long", 1);
    expect(before.settings).toEqual({ sceneCount: 6, clipDurationSeconds: 5, episodeDurationSeconds: 30 });
    expect(before.projectDefaults).toEqual(before.settings);
    expect(before.changeable).toBe(true);

    const updated = await subject.updateSettings("long", 1, { sceneCount: 4, clipDurationSeconds: 10 });
    expect(updated.settings).toEqual({ sceneCount: 4, clipDurationSeconds: 10, episodeDurationSeconds: 40 });

    const after = await subject.settings("long", 1);
    expect(after.settings.sceneCount).toBe(4);
    // The project's own settings are untouched: they are what a new Episode starts from, not what this one uses.
    expect(after.projectDefaults).toEqual({ sceneCount: 6, clipDurationSeconds: 5, episodeDurationSeconds: 30 });

    const generated = await subject.generate("long", 1, { userRequestId: "settings-intent" });
    expect(generated.episode.script?.scenes.map((scene) => scene.number)).toEqual([1, 2, 3, 4]);
    expect((await subject.settings("long", 1)).changeable).toBe(false);
  });

  it("refuses to change them once a script exists, rather than leaving one written for other numbers", async () => {
    // A script is written *for* a scene count and a clip length — both go into the prompt. Changing them
    // afterwards would leave the script describing something else, so regenerating is the way, and that is a
    // paid step someone chooses. `changeable` says so ahead of time; this is the server refusing anyway.
    const subject = await setup(30, 6);
    await subject.generate("long", 1, { userRequestId: "before-settings" });

    await expect(subject.updateSettings("long", 1, { sceneCount: 4, clipDurationSeconds: 5 }))
      .rejects.toMatchObject({ response: { code: "LONG_EPISODE_SETTINGS_NOT_ALLOWED" } });
    expect((await subject.settings("long", 1)).settings.sceneCount).toBe(6);
  });

  it("refuses a scene count or clip length the rest of the pipeline cannot honour", async () => {
    // Runway offers two clip lengths and the scene count has bounds; a value outside either would be accepted
    // here and then fail somewhere far away, at a step that costs money.
    const subject = await setup(30, 6);
    for (const invalid of [{ sceneCount: 1, clipDurationSeconds: 5 }, { sceneCount: 13, clipDurationSeconds: 5 }, { sceneCount: 6, clipDurationSeconds: 7 }]) {
      await expect(subject.updateSettings("long", 1, invalid)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    }
    // And it does not accept a duration it is supposed to derive.
    await expect(subject.updateSettings("long", 1, { sceneCount: 4, clipDurationSeconds: 5, episodeDurationSeconds: 20 } as never))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("answers a repeated regeneration with what the first one made, and a fresh intent with a new script", async () => {
    // The lock stops presses that overlap. It cannot stop the one that arrives after the first finished, and a
    // regeneration is a legal repeat the state gate lets through — so a person who waited with nothing on screen
    // and pressed again paid twice. Both halves are asserted: repeating must cost nothing, and a genuinely new
    // intent must still work, since a guard that refused every repeat would satisfy the first alone.
    const subject = await setup();
    const first = await subject.generate("long", 1, { userRequestId: "intent-a" });
    const repeat = await subject.generate("long", 1, { regenerate: true, userRequestId: "intent-a" });
    expect(repeat.episode.scriptRevision).toBe(first.episode.scriptRevision);
    expect(repeat.episode.scriptHistoryCount).toBe(first.episode.scriptHistoryCount);

    const again = await subject.generate("long", 1, { regenerate: true, userRequestId: "intent-b" });
    expect(again.episode.scriptRevision).toBe(first.episode.scriptRevision + 1);

    // Survives a reload: the id lives with the Episode, not in this instance.
    const reloaded = new EpisodeScriptsService(path.join(root!, "projects"));
    const afterReload = await reloaded.generate("long", 1, { regenerate: true, userRequestId: "intent-b" });
    expect(afterReload.episode.scriptRevision).toBe(again.episode.scriptRevision);
  });

  it("refuses a generation with no userRequestId rather than treating it as a fresh intent", async () => {
    // Absent would mean "no protection", quietly, for any caller that forgot — the shape that cost real money
    // on the login flow's `flow` default (D-014).
    const subject = await setup();
    await expect(subject.generate("long", 1, {} as never)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("refuses a second script generation while one is running, at once rather than after a wait", async () => {
    // Holding the lock for real, because a test that merely calls generate() twice proves nothing here: the
    // local-fake path finishes before a second call starts, so both refusals come from the state and the lock is
    // never reached. That is how this guard could be removed without a single test noticing.
    const subject = await setup();
    const projectDirectory = path.join(root!, "projects", "long");
    const startedAt = Date.now();
    let refusal: unknown;
    await withProjectLock(projectDirectory, "long:episode-1:script", async () => {
      refusal = await subject.generate("long", 1, { userRequestId: "episode-scripts.service-script-1" }).catch((error: unknown) => error);
    });

    expect(refusal).toMatchObject({ response: { code: "PROJECT_LOCKED" } });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    // get() answers from the outline when no script file exists, so "not found" is the wrong question — ask
    // whether a script was written, which is what a refused generation must not have done.
    expect((await subject.get("long", 1)).episode.script).toBeUndefined();
  });

  it("creates, edits, preserves history, and approves one six-scene local episode script", async () => {
    const subject = await setup();
    await expect(subject.get("long", 3)).rejects.toMatchObject({ response: { code: "LONG_EPISODE_NOT_FOUND" } });
    const generated = await subject.generate("long", 1, { userRequestId: "episode-scripts.service-script-2" });
    expect(generated.episode).toMatchObject({ status: "script_review", approved: false, scriptRevision: 1 });
    expect(generated.episode.script?.scenes.map((scene) => scene.number)).toEqual([1, 2, 3, 4, 5, 6]);
    await expect(subject.generate("long", 1, { userRequestId: "episode-scripts.service-script-3" })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_SCRIPT_EXISTS" } });
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
    const generated = await subject.generate("long", 1, { userRequestId: "episode-scripts.service-script-4" });
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
    await subject.generate("long", 1, { userRequestId: "episode-scripts.service-script-5" });
    const stored = JSON.parse(await fs.readFile(path.join(root!, "projects", "long", "long_story", "Episode01", "project.json"), "utf8")) as { duration_seconds: number };
    expect(stored.duration_seconds).toBe(60);
  });

  it("generates and edits a script sized to the project's own scene count, not a hardcoded six", async () => {
    const subject = await setup(30, 9);
    const generated = await subject.generate("long", 1, { userRequestId: "episode-scripts.service-script-6" });
    expect(generated.episode.script?.scenes.map((scene) => scene.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const script = generated.episode.script!;
    const edited = await subject.update("long", 1, { script });
    expect(edited.episode.script?.scenes).toHaveLength(9);
    await expect(subject.update("long", 1, { script: { ...script, scenes: script.scenes.slice(0, 6) } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("rejects malformed user edits", async () => {
    const subject = await setup(); await subject.generate("long", 1, { userRequestId: "episode-scripts.service-script-7" });
    await expect(subject.update("long", 1, { script: { title: "x", synopsis: "x", ending: "x", scenes: [] } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("never calls fetch when no OpenAI credential/budget is wired in", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const subject = await setup();
    await subject.generate("long", 1, { userRequestId: "episode-scripts.service-script-8" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * A script save keeps the parts of the Episode's record this service does not own.
   *
   * `save()` writes the parsed object straight back, so every field `parseStored` failed to name was deleted
   * from disk by the next unrelated save — silently, with nothing reporting a loss. Two were really being lost
   * on 캡틴D's Episodes: `previous_instagram_posts`, whose own doc comment calls it the only memory this app has
   * of an action it cannot undo, and `mapping_revision`, which episode-mapping-owner.ts writes.
   *
   * Asserted as a rule rather than as a list, because a list is what failed: an unknown key is another module's
   * record, and this parser is not the one to decide it does not exist.
   */
  it("keeps another module's fields on the Episode through a script save", async () => {
    const subject = await setup();
    await subject.generate("long", 1, { userRequestId: "episode-scripts.service-preserve-1" });
    const file = path.join(root!, "projects", "long", "long_story", "Episode01", "project.json");
    const stored = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    const forgotten = [{ media_id: "18127867426747808", ig_user_id: "1784", published_at: "2026-09-04T05:02:51.319Z", caption: "지운 게시물" }];
    await fs.writeFile(file, JSON.stringify({ ...stored, previous_instagram_posts: forgotten, mapping_revision: 10, some_future_field: { kept: true } }, null, 2), "utf8");

    await subject.generate("long", 1, { userRequestId: "episode-scripts.service-preserve-2", regenerate: true });

    const after = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    expect(after.previous_instagram_posts, "the only memory of a post that may still be public").toEqual(forgotten);
    expect(after.mapping_revision).toBe(10);
    expect(after.some_future_field).toEqual({ kept: true });
    // And the fields this service does own still went through their checks.
    expect(after.script_revision).toBe(2);
  });

  /**
   * And the record reaches the screen, which is the half its doc comment promises.
   *
   * "carried out to the screen rather than only written to disk — a record nothing reads is a record that
   * quietly stops being kept correctly." Episode 4 of 캡틴D's project had three such posts on disk and the API
   * answered with none, because the field never survived the read.
   */
  it("reports the posts an Episode has published and forgotten", async () => {
    const subject = await setup();
    await subject.generate("long", 1, { userRequestId: "episode-scripts.service-preserve-3" });
    const file = path.join(root!, "projects", "long", "long_story", "Episode01", "project.json");
    const stored = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    await fs.writeFile(file, JSON.stringify({ ...stored, previous_instagram_posts: [
      { media_id: "18127867426747808", ig_user_id: "1784", published_at: "2026-09-04T05:02:51.319Z", caption: "첫 번째" },
      { media_id: "18138514609608189", ig_user_id: "1784", published_at: "2026-09-04T05:16:52.214Z", caption: "두 번째" },
    ] }, null, 2), "utf8");

    const episode = (await subject.get("long", 1)).episode;

    expect(episode.previousInstagramPosts?.map((post) => post.mediaId)).toEqual(["18127867426747808", "18138514609608189"]);
  });
});

/** One Episode already on disk, so `get` reads a stored record rather than rebuilding one from the project. */
async function writeStoredEpisode(overrides: Record<string, unknown> = {}): Promise<void> {
  const file = path.join(root!, "projects", "long", "long_story", "Episode01", "project.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({
    episode_id: "long-episode-1", number: 1, title: "t", summary: "s", core_event: "c", conflict: "x",
    cliffhanger: "y", next_connection: "z", duration_seconds: 30, scene_count: 6, approved: false, state: "planned",
    script: {}, script_history: [], script_revision: 0, updated_at: "2026-08-27T00:00:00.000Z",
    outline: { episode_number: 1, title: "t", summary: "s", main_event: "c", conflict: "x", cliffhanger: "y", next_episode_hook: "z" },
    ...overrides,
  }, null, 2));
}

describe("EpisodeScriptsService.get — what the Episode says about itself", () => {
  /**
   * Three screens each assumed "9:16". The one warning worth raising about this setting — that changing it
   * leaves every image already paid for in the wrong shape — cannot stand on an assumption, or the warning is
   * the assumption.
   */
  it("says which shape it is rendered in, read from the project rather than assumed", async () => {
    const service = await setup();
    const wide = new LongProjectsService(path.join(root!, "projects"));
    await wide.updateSettings("long", { settings: { ...settings, aspectRatio: "16:9" } });

    expect((await service.get("long", 1)).episode.aspectRatio).toBe("16:9");
  });

  it("carries a failed Episode's reasons and a finished one's video path, both of which were already on disk", async () => {
    const service = await setup();
    await writeStoredEpisode({ state: "failed", errors: ["Episode video rendering failed."], final_video_path: "videos/final/instagram_reel.mp4" });

    const { episode } = await service.get("long", 1);

    expect(episode.errors).toEqual(["Episode video rendering failed."]);
    expect(episode.finalVideoPath).toBe("videos/final/instagram_reel.mp4");
  });

  it("still answers when the project file beside it cannot be read, without the shape", async () => {
    // One display field is not worth trading a readable Episode for.
    const service = await setup();
    await writeStoredEpisode();
    await fs.rm(path.join(root!, "projects", "long", "long_story", "project.json"));

    const { episode } = await service.get("long", 1);

    expect(episode.aspectRatio).toBeUndefined();
    expect(episode.episodeNumber).toBe(1);
  });

  it("says nothing rather than nothing-happened: no errors key on a healthy Episode", async () => {
    // `errors: []` on every Episode would read as "we checked and it is fine", which is a larger claim than a
    // field that was simply never written.
    const service = await setup();
    const { episode } = await service.get("long", 1);
    expect(episode.errors).toBeUndefined();
    expect(episode.finalVideoPath).toBeUndefined();
  });
});
