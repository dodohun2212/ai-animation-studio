import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { approveEpisodeMappingReview } from "./episode-mapping-test-fixtures.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { EpisodeVideosService } from "./episode-videos.service.js";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
async function setup(episodeDurationSeconds: 30 | 60 = 30, aspectRatio: "9:16" | "16:9" = "9:16") {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-videos-")); const projectsRoot = path.join(root, "projects"); const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings: { ...settings, clipDurationSeconds: episodeDurationSeconds === 60 ? 10 : 5, aspectRatio } }); const outline = await projects.preview("long"); await projects.approve("long", { approved: true, prompt: outline.preview.prompt, promptSha256: outline.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot); await scripts.generate("long", 1, { userRequestId: "episode-videos.service-script-1" }); await scripts.approve("long", 1, { approved: true });
  await approveEpisodeMappingReview(projectsRoot, root, "long", 1);
  const images = new EpisodeImagesService(projectsRoot); await images.generate("long", 1, { approved: true }); for (const number of [1, 2, 3, 4, 5, 6] as const) await images.approve("long", 1, String(number), { approved: true });
  return { videos: new EpisodeVideosService(projectsRoot), projectsRoot };
}
afterEach(async () => { vi.unstubAllGlobals(); if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("EpisodeVideosService", () => {
  it("turns a second start away on the state, and answers a resent one with the job it already made", async () => {
    // Which of the two refuses matters, because they are not the same protection. The state gate is what stops a
    // second paid job from starting: the Episode is already generating, so any start is refused regardless of the
    // request id. The id does something else — a start that is *re-sent* (a timed-out client retrying the same
    // thing) gets the existing job back instead of that refusal.
    //
    // Written after reporting the opposite: the id was described as the thing holding the money, and it is not.
    const { videos } = await setup();
    const preview = await videos.preview("long", 1);
    const prompts = preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt }));
    const first = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "intent-a", prompts });

    const resent = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "intent-a", prompts });
    expect(resent.jobId).toBe(first.jobId);

    await expect(videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "intent-b", prompts }))
      .rejects.toMatchObject({ response: { code: "LONG_EPISODE_VIDEOS_NOT_ALLOWED" } });
  });

  it("does not call a job succeeded while the Episode is still being moved to review", async () => {
    // The two facts land one write apart: the last scene's record is saved as succeeded, then the Episode state
    // moves to videos_review. A poll in between used to answer "succeeded" — and the screen opens its review on
    // exactly that word, which the server then refuses because the state has not moved yet. Reproduced here by
    // putting the state back, which is the same shape as arriving early.
    const { videos, projectsRoot } = await setup();
    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);
    expect((await videos.progress("long", 1, started.jobId)).status).toBe("succeeded");

    const episodeFile = path.join(projectsRoot, "long", "long_story", "Episode01", "project.json");
    const episode = JSON.parse(await fs.readFile(episodeFile, "utf8")) as Record<string, unknown>;
    episode.state = "videos_generating";
    await fs.writeFile(episodeFile, JSON.stringify(episode), "utf8");

    const midway = await videos.progress("long", 1, started.jobId);
    expect(midway.status).toBe("running");
    expect(midway.completedSceneNumbers).toHaveLength(6);
    // And the refusal the screen would have hit is still there, which is why the word had to change.
    await expect(videos.review("long", 1, started.jobId)).rejects.toMatchObject({ response: { code: "LONG_EPISODE_VIDEOS_NOT_ALLOWED" } });
  });

  it("generates from the prompt the person edited, not the one it previewed", async () => {
    // 🔴 The box on the screen is editable. It used to have to come back byte for byte identical, so every edit
    // was refused with "확인해 주세요" and nothing saying what was wrong — and the short project has always
    // accepted an edited prompt. Two halves had to move: accepting it, and then actually using it. Accepting it
    // without using it would have been worse than the refusal, because the video would quietly not be the one
    // asked for.
    const { videos, projectsRoot } = await setup();
    const preview = await videos.preview("long", 1);
    const edited = preview.scenes.map(({ sceneNumber }, index) => ({ sceneNumber, prompt: `내가 직접 쓴 프롬프트 ${index + 1}` }));

    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "edited_1", prompts: edited });

    const records = JSON.parse(await fs.readFile(path.join(projectsRoot, "long", "long_story", "Episode01", "video_generation_records.json"), "utf8")) as Array<{ job_id: string; prompt: string }>;
    const stored = records.filter((item) => item.job_id === started.jobId).map((item) => item.prompt);
    expect(stored).toEqual(edited.map((item) => item.prompt));
  });

  it("still refuses a confirmation that no longer describes this Episode", async () => {
    // Relaxing the prompt did not relax the staleness guard: confirmationId is derived from the scenes, so a
    // script that moved underneath is still caught. That is the thing the check was really for.
    const { videos } = await setup();
    const preview = await videos.preview("long", 1);

    await expect(videos.start("long", 1, { approved: true, confirmationId: "not-the-one", userRequestId: "stale_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("refuses a prompt that is empty or longer than Runway accepts", async () => {
    // Nothing checked the shape at all before, because nothing needed to while the text had to match the
    // server's own. Accepting an edit without this would open an unchecked field straight into a paid call.
    const { videos } = await setup();
    const preview = await videos.preview("long", 1);
    const withFirst = (prompt: string) => preview.scenes.map(({ sceneNumber }, index) => ({ sceneNumber, prompt: index === 0 ? prompt : "ok" }));

    for (const [name, prompt] of [["empty", ""], ["blank", "   "], ["too long", "가".repeat(1001)]] as const) {
      await expect(videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: `shape_${name}`, prompts: withFirst(prompt) }))
        .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    }
  });


  /**
   * The short project's preview has named the sections it had to cut since it shipped. The Episode's threw the
   * list away, so a scene could lose its pacing or performance direction and the only way to find out was a
   * finished clip that was wrong — after paying for it.
   *
   * The Episode is also the side that will hit the limit first: measured on the real data, its prompts run
   * 493-902 characters against the 1,000 limit while the short project's run 599-732.
   */
  it("names the sections it had to cut to fit the prompt limit, and says nothing when it cut none", async () => {
    const { videos, projectsRoot } = await setup();
    expect((await videos.preview("long", 1)).scenes.every((scene) => scene.omittedSections === undefined), "nothing was cut from these").toBe(true);

    // One scene's environment description grown past what the limit can hold, the way a long script would do it.
    const file = path.join(projectsRoot, "long", "long_story", "Episode01", "project.json");
    const episode = JSON.parse(await fs.readFile(file, "utf8")) as { script: { scenes: Record<string, unknown>[] } };
    // Grown in main_motion, which is not on the removable list — so the only way back under the limit is to drop
    // a removable section, and Pacing is the first one the server reaches for.
    episode.script.scenes[1]!.main_motion = "골목을 가로질러 달린다 ".repeat(34);
    await fs.writeFile(file, JSON.stringify(episode, null, 2));

    const scene = (await videos.preview("long", 1)).scenes.find((item) => item.sceneNumber === 2);
    // The first name, not the whole list: how much has to go depends on the prompt's exact wording, and a test
    // that pinned the count would go red the next time a label changes without anything being wrong.
    expect(scene?.omittedSections?.[0], "Pacing goes first, the same order the short project reports").toBe("Pacing");
    expect(scene?.prompt).not.toContain("Pacing:");
  });

  it("keeps preview provider-free, requires its exact approval snapshot, and produces six local fake clips sequentially", async () => {
    const { videos, projectsRoot } = await setup(); const preview = await videos.preview("long", 1);
    expect(preview).toMatchObject({ model: "gen4_turbo", ratio: "720:1280", durationSecondsPerScene: 5, executionMode: "sequential", estimatedCostUsd: 1.5 });
    await expect(videos.start("long", 1, { approved: true, confirmationId: "old", userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) }); await videos.run("long", 1, started.jobId);
    expect(started.episode.status).toBe("videos_generating"); const localFakeProgress = await videos.progress("long", 1, started.jobId); expect(localFakeProgress.completedSceneNumbers).toEqual([1, 2, 3, 4, 5, 6]); expect(localFakeProgress.retryEstimate).toBeUndefined();
    await expect(fs.access(path.join(projectsRoot, "long", "long_story", "Episode01", "videos", "scene6.mp4"))).resolves.toBeUndefined();
    const repeated = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) }); expect(repeated.jobId).toBe(started.jobId);
  });

  it("derives ratio from the project's own aspectRatio setting (16:9 -> 1280:720) instead of always hardcoding vertical, and the prompt's orientation line follows it", async () => {
    const { videos } = await setup(30, "16:9");
    const preview = await videos.preview("long", 1);
    expect(preview.ratio).toBe("1280:720");
    expect(preview.scenes[0]!.prompt).toContain("horizontal");
  });

  it("includes motion_speed, motion_intensity, and expression_change in the video prompt — previously generated and stored but never read by any prompt builder", async () => {
    const { videos } = await setup();
    const preview = await videos.preview("long", 1);
    const prompt = preview.scenes[0]!.prompt;
    expect(prompt).toContain("Pacing: motion speed normal; intensity moderate");
    expect(prompt).toContain("Performance: focused to hopeful");
  });

  it("derives durationSecondsPerScene from the project's episodeDurationSeconds setting (60s project -> 10s/scene, matching Runway's only two valid clip lengths)", async () => {
    const { videos } = await setup(60);
    const preview = await videos.preview("long", 1);
    expect(preview.durationSecondsPerScene).toBe(10);
    expect(preview.scenes[0]!.prompt).toContain("10-second");
  });

  it("requires all video reviews and regenerates one scene while preserving the other approvals and history", async () => {
    const { videos, projectsRoot } = await setup(); const preview = await videos.preview("long", 1); const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_2", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) }); await videos.run("long", 1, started.jobId);
    for (const number of [1, 2, 3, 4, 5] as const) await videos.approve("long", 1, started.jobId, String(number), { approved: true });
    expect((await videos.review("long", 1, started.jobId)).episode.status).toBe("videos_review"); await videos.approve("long", 1, started.jobId, "6", { approved: true }); expect((await videos.review("long", 1, started.jobId)).episode.status).toBe("videos_approved");
    const regenerated = await videos.regenerate("long", 1, started.jobId, "3", { approved: true }); expect(regenerated.regeneratedSceneNumbers).toEqual([3]); expect((await videos.review("long", 1, started.jobId)).reviews.find((item) => item.sceneNumber === 3)?.status).toBe("pending");
    await expect(fs.readdir(path.join(projectsRoot, "long", "long_story", "Episode01", "videos", "history"))).resolves.toHaveLength(1);
  });

  /**
   * A clip is only worth what the script it was made from is still worth. Editing a scene after paying for its
   * video left no sign anywhere: the clip stayed in the review screen looking approved-and-current, and the
   * only way to find out was to watch the merged Episode.
   */
  it("names the scenes whose paid-for clips were made from a script that has since changed", async () => {
    const { videos, projectsRoot } = await setup();
    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_2", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);
    expect((await videos.review("long", 1, started.jobId)).staleness.videoStale).toEqual([]);

    // Edit scene 2's main motion on disk, the way a script revision would.
    const file = path.join(projectsRoot, "long", "long_story", "Episode01", "project.json");
    const episode = JSON.parse(await fs.readFile(file, "utf8")) as { script: { scenes: Record<string, unknown>[] } };
    episode.script.scenes[1]!.main_motion = "the hero turns and runs the other way";
    await fs.writeFile(file, JSON.stringify(episode, null, 2));

    const { staleness } = await videos.review("long", 1, started.jobId);
    expect(staleness.videoStale).toContain(2);
  });

  it("carries an edit forward to the next scene's clip, which was built partly from it", async () => {
    // promptFor reads the previous scene for its continuity cue, so scene 3's clip is behind after scene 2 is
    // edited even though scene 3 was not touched. Falls out of recomputing; there is no propagation code.
    const { videos, projectsRoot } = await setup();
    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_2", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);

    const file = path.join(projectsRoot, "long", "long_story", "Episode01", "project.json");
    const episode = JSON.parse(await fs.readFile(file, "utf8")) as { script: { scenes: Record<string, unknown>[] } };
    episode.script.scenes[1]!.end_motion = "the camera whips left";
    await fs.writeFile(file, JSON.stringify(episode, null, 2));

    expect((await videos.review("long", 1, started.jobId)).staleness.videoStale).toContain(3);
  });

  /**
   * The Episode's clip regeneration had no request type at all beyond approval — the one place a person could
   * say "same scene, but slower" was missing while the short project and the Episode's narration both had it.
   */
  it("carries one-off direction into the re-submitted clip's prompt, and leaves the baseline alone", async () => {
    const { videos, projectsRoot } = await setup();
    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_2", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);

    await videos.regenerate("long", 1, started.jobId, "3", { approved: true, additionalInstruction: "카메라를 더 천천히" });

    const file = path.join(projectsRoot, "long", "long_story", "Episode01", "video_generation_records.json");
    const records = JSON.parse(await fs.readFile(file, "utf8")) as Array<{ scene_number: number; prompt: string; base_prompt?: string }>;
    const third = records.find((record) => record.scene_number === 3)!;
    expect(third.prompt.endsWith("카메라를 더 천천히")).toBe(true);
    expect(third.base_prompt).toBe(preview.scenes.find((item) => item.sceneNumber === 3)!.prompt);
    // And the clip is not reported as behind its script: the baseline is what staleness reads.
    expect((await videos.review("long", 1, started.jobId)).staleness.videoStale).toEqual([]);
  });

  it("refuses a regeneration body carrying anything else", async () => {
    const { videos } = await setup();
    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_2", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);

    await expect(videos.regenerate("long", 1, started.jobId, "3", { approved: true, additionalInstruction: 5 } as never))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(videos.regenerate("long", 1, started.jobId, "3", { approved: true, other: "x" } as never))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  /**
   * A twelve-scene Episode whose script changed meant twelve presses, and the twelfth is where a person stops
   * reading what they are approving. The short project has had one press for this since its own review screen
   * existed.
   */
  it("re-buys every scene of the job in one press, archiving each clip it displaces", async () => {
    const { videos, projectsRoot } = await setup();
    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_2", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);

    const result = await videos.regenerateAll("long", 1, started.jobId, { approved: true });

    expect(result.regeneratedSceneNumbers).toEqual([1, 2, 3, 4, 5, 6]);
    // Every displaced clip kept, not just the first: a bulk action must not be the cheap way to lose work.
    const history = await fs.readdir(path.join(projectsRoot, "long", "long_story", "Episode01", "videos", "history"));
    expect(history.filter((name) => name.endsWith("_v001.mp4")).length).toBe(6);
  });

  it("refuses a whole-Episode re-buy while a generation is still running", async () => {
    // One failed scene may be retried mid-run. All of them may not: the scenes still running would be paid for
    // a second time, and this is the only route where that mistake is a single press.
    const { videos, projectsRoot } = await setup();
    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_2", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);
    const file = path.join(projectsRoot, "long", "long_story", "Episode01", "project.json");
    const stored = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    await fs.writeFile(file, JSON.stringify({ ...stored, state: "videos_generating" }));
    // Scene 1 failed mid-run — the one case a retry *is* allowed while generating. Retrying that single scene
    // stays open; re-buying all six does not, and that difference is the whole point of the guard.
    const recordsFile = path.join(projectsRoot, "long", "long_story", "Episode01", "video_generation_records.json");
    const records = JSON.parse(await fs.readFile(recordsFile, "utf8")) as Array<Record<string, unknown>>;
    records[0] = { ...records[0], status: "failed" };
    await fs.writeFile(recordsFile, JSON.stringify(records));

    await expect(videos.regenerateAll("long", 1, started.jobId, { approved: true }))
      .rejects.toMatchObject({ response: { code: "LONG_EPISODE_VIDEOS_NOT_ALLOWED" } });
    await expect(videos.regenerate("long", 1, started.jobId, "1", { approved: true })).resolves.toBeDefined();
  });

  it("carries one-off direction to every scene it re-buys", async () => {
    const { videos, projectsRoot } = await setup();
    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_2", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);

    await videos.regenerateAll("long", 1, started.jobId, { approved: true, additionalInstruction: "전체적으로 더 어둡게" });

    const records = JSON.parse(await fs.readFile(path.join(projectsRoot, "long", "long_story", "Episode01", "video_generation_records.json"), "utf8")) as Array<{ prompt: string; base_prompt?: string }>;
    expect(records.every((record) => record.prompt.endsWith("전체적으로 더 어둡게"))).toBe(true);
    expect(records.every((record) => typeof record.base_prompt === "string")).toBe(true);
    // And none of them read as behind the script afterwards — the baseline is what staleness compares against.
    expect((await videos.review("long", 1, started.jobId)).staleness.videoStale).toEqual([]);
  });

  it("never calls fetch across preview, start, run, progress, regenerate, and approve when no Runway credential/budget is wired in", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { videos } = await setup();
    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_3", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
    await videos.run("long", 1, started.jobId);
    await videos.progress("long", 1, started.jobId);
    await videos.regenerate("long", 1, started.jobId, "2", { approved: true });
    for (const number of [1, 2, 3, 4, 5, 6] as const) await videos.approve("long", 1, started.jobId, String(number), { approved: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
