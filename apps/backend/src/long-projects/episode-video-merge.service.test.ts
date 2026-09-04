import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MediaToolError, type MediaCommandRunner } from "../videos/ffmpeg-merge.service.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { approveEpisodeMappingReview } from "./episode-mapping-test-fixtures.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { EpisodeVideoMergeService } from "./episode-video-merge.service.js";
import { AudioLibraryService } from "../audio/audio-library.service.js";
import { EpisodeVideosService } from "./episode-videos.service.js";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };

/**
 * Snapshots the subtitle files each ffmpeg call can see, at the moment it runs.
 *
 * The merge deletes `normalized/` once the final file exists — it is a cache, and a second full-size copy of
 * every finished video is not something to leave in a person's data folder. Reading a .ass file after the merge
 * depended on that debris surviving; this reads the same content at the only moment it is actually there.
 */
async function captureAss(target: string, into: Map<string, string>): Promise<void> {
  const directory = path.dirname(target);
  const names = await fs.readdir(directory).catch(() => [] as string[]);
  for (const name of names.filter((item) => item.endsWith(".ass"))) {
    into.set(name, await fs.readFile(path.join(directory, name), "utf8"));
  }
}

function runner(options: { invalidProbe?: boolean; unavailable?: boolean; noOutput?: boolean } = {}, calls: string[][] = [], ass: Map<string, string> = new Map()): MediaCommandRunner {
  return async (arguments_) => {
    const args = [...arguments_]; calls.push(args);
    if (options.unavailable) throw new MediaToolError("unavailable", "not installed");
    if (args[0] === "ffprobe") return { stdout: JSON.stringify(options.invalidProbe ? { streams: [], format: { duration: "0" } } : { streams: [{ codec_type: "video" }], format: { duration: "5" } }), stderr: "" };
    await captureAss(args.at(-1)!, ass);
    if (!options.noOutput) await fs.writeFile(args.at(-1)!, "rendered");
    return { stdout: "", stderr: "" };
  };
}

/** Everything up to approved images — where a video submission becomes possible, and where the race lives. */
async function setupToApprovedImages() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-video-merge-")); const projectsRoot = path.join(root, "projects");
  const projects = new LongProjectsService(projectsRoot); await projects.create({ projectId: "long", settings });
  const outline = await projects.preview("long"); await projects.approve("long", { approved: true, prompt: outline.preview.prompt, promptSha256: outline.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot); await scripts.generate("long", 1, { userRequestId: "episode-video-merge.service-script-1" }); await scripts.approve("long", 1, { approved: true });
  await approveEpisodeMappingReview(projectsRoot, root, "long", 1);
  const images = new EpisodeImagesService(projectsRoot); await images.generate("long", 1, { approved: true }); for (const number of [1, 2, 3, 4, 5, 6] as const) await images.approve("long", 1, String(number), { approved: true });
  return { projectsRoot };
}

async function setup() {
  const { projectsRoot } = await setupToApprovedImages();
  const videos = new EpisodeVideosService(projectsRoot); const preview = await videos.preview("long", 1); const started = await videos.start("long", 1, { approved: true, confirmationId: preview.confirmationId, userRequestId: "request_1", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) }); await videos.run("long", 1, started.jobId); for (const number of [1, 2, 3, 4, 5, 6] as const) await videos.approve("long", 1, started.jobId, String(number), { approved: true });
  return { projectsRoot };
}
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

/**
 * Two presses at once, from two clients — the Episode half of the same race the short project had.
 *
 * `start()` read the records file, checked the Episode's state, then wrote both, with nothing serializing it.
 * Measured before the fix: both callers came back with a job id and only one of those jobs was on disk, so the
 * loser asked about its job forever and got LONG_EPISODE_VIDEO_JOB_NOT_FOUND after being told the run started.
 *
 * Both halves are asserted, and only one is about money. Exactly one job may exist — the state gate doing what
 * docs/04_INTERNAL_API_CONTRACT.md says is its job and not `userRequestId`'s — and the loser must be refused
 * rather than handed an id. Reuses this file's setup, which already carries an Episode to approved images.
 */
describe("two simultaneous Episode video submissions", () => {
  it("refuses the second instead of handing out a job that is never written", async () => {
    const { projectsRoot } = await setupToApprovedImages();
    const videos = new EpisodeVideosService(projectsRoot);
    const preview = await videos.preview("long", 1);
    const body = (userRequestId: string) => ({ approved: true as const, confirmationId: preview.confirmationId, userRequestId, prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });

    const outcomes = await Promise.allSettled([videos.start("long", 1, body("request_a")), videos.start("long", 1, body("request_b"))]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({ reason: { response: { code: "LONG_EPISODE_VIDEOS_NOT_ALLOWED" } } });
    const raw = JSON.parse(await fs.readFile(path.join(projectsRoot, "long", "long_story", "Episode01", "video_generation_records.json"), "utf8")) as Array<{ job_id: string }>;
    expect(raw).toHaveLength(6);
    expect(new Set(raw.map((record) => record.job_id)).size).toBe(1);
  });

  /** The counterpart: serializing must not turn one person's repeated press into a refusal. */
  it("still returns the same job when the same request ID is submitted twice", async () => {
    const { projectsRoot } = await setupToApprovedImages();
    const videos = new EpisodeVideosService(projectsRoot);
    const preview = await videos.preview("long", 1);
    const body = { approved: true as const, confirmationId: preview.confirmationId, userRequestId: "request_same", prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) };
    const accepted = await videos.start("long", 1, body);

    await expect(videos.start("long", 1, body)).resolves.toMatchObject({ jobId: accepted.jobId });
  });
});

describe("EpisodeVideoMergeService", () => {
  /**
   * The Episode half of the same wrong sentence. A completed Episode has every scene video approved, and asking
   * it for approvals is pointing the person at work they finished — the short project's videoMergeAlreadyCompleted
   * doc has the measurement. Both ends here too: an implementation that always claimed "already rendered" would
   * be just as wrong for an Episode that really has nothing approved.
   */
  it("tells a completed Episode it is already rendered, and an unapproved one that it is not approved", async () => {
    const { projectsRoot } = await setup();
    await new EpisodeVideoMergeService(projectsRoot, runner({})).merge("long", 1);
    await expect(new EpisodeVideoMergeService(projectsRoot, runner({})).merge("long", 1))
      .rejects.toMatchObject({ response: { code: "LONG_EPISODE_MERGE_ALREADY_COMPLETED" } });

    const { projectsRoot: fresh } = await setupToApprovedImages();
    await expect(new EpisodeVideoMergeService(fresh, runner({})).merge("long", 1))
      .rejects.toMatchObject({ response: { code: "LONG_EPISODE_MERGE_NOT_ALLOWED" } });
  });

  it("probes, normalizes, and concatenates the current six approved Episode clips in scene order without exposing disk paths", async () => {
    const { projectsRoot } = await setup(); const calls: string[][] = [];
    const result = await new EpisodeVideoMergeService(projectsRoot, runner({}, calls)).merge("long", 1);
    expect(result).toMatchObject({ finalVideoPath: "videos/final/instagram_reel.mp4", episode: { status: "completed" } });
    expect(JSON.stringify(result)).not.toContain(projectsRoot);
    expect(calls.filter((args) => args[0] === "ffprobe")).toHaveLength(6);
    expect(calls.filter((args) => args[0] === "ffmpeg")).toHaveLength(7);
    expect(calls.filter((args) => args[0] === "ffprobe").map((args) => path.basename(args.at(-1)!))).toEqual(["scene1.mp4", "scene2.mp4", "scene3.mp4", "scene4.mp4", "scene5.mp4", "scene6.mp4"]);
    expect(calls.find((args) => args.includes("-vf"))!).toContain("scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p");
    await expect(fs.readFile(path.join(projectsRoot, "long", "long_story", "Episode01", "videos", "final", "instagram_reel.mp4"), "utf8")).resolves.toBe("rendered");
  });

  it("requires one persisted current job and all six explicit approvals before changing the Episode state", async () => {
    const { projectsRoot } = await setup(); const reviews = path.join(projectsRoot, "long", "long_story", "Episode01", "generated_video_reviews.json");
    const values = JSON.parse(await fs.readFile(reviews, "utf8")) as Array<Record<string, unknown>>; values[5]!.status = "pending"; await fs.writeFile(reviews, JSON.stringify(values), "utf8");
    await expect(new EpisodeVideoMergeService(projectsRoot, runner()).merge("long", 1)).rejects.toMatchObject({ response: { code: "LONG_EPISODE_MERGE_CLIPS_INVALID" } });
    const project = JSON.parse(await fs.readFile(path.join(projectsRoot, "long", "long_story", "Episode01", "project.json"), "utf8")) as { state: string }; expect(project.state).toBe("videos_approved");
    await expect(new EpisodeVideoMergeService(projectsRoot, runner()).merge("../long", 1)).rejects.toMatchObject({ response: { code: "UNSAFE_PROJECT_ID" } });
  });

  it("keeps approved clips and records a recoverable failed state when the mock media runner fails", async () => {
    const { projectsRoot } = await setup();
    await expect(new EpisodeVideoMergeService(projectsRoot, runner({ noOutput: true })).merge("long", 1)).rejects.toMatchObject({ response: { code: "LONG_EPISODE_MERGE_FAILED" } });
    const project = JSON.parse(await fs.readFile(path.join(projectsRoot, "long", "long_story", "Episode01", "project.json"), "utf8")) as { state: string; errors: string[] }; expect(project.state).toBe("failed"); expect(project.errors).toContain("Episode video rendering failed.");
    await expect(fs.stat(path.join(projectsRoot, "long", "long_story", "Episode01", "videos", "scene1.mp4"))).resolves.toBeTruthy();
    // A second attempt is allowed, and fails for the reason it actually fails for rather than being refused
    // as not-allowed. This line used to assert the refusal, which pinned the dead end as intended behaviour:
    // the merge is the only thing that writes `failed`, nothing was published when it did, and the approved
    // clips are still on disk one line above — there was never anything to do from there except try again.
    await expect(new EpisodeVideoMergeService(projectsRoot, runner({ unavailable: true })).merge("long", 1)).rejects.toMatchObject({ response: { code: "LONG_EPISODE_FFMPEG_UNAVAILABLE" } });
    // And it succeeds once the thing that broke is working, which is the whole point of letting it start.
    await expect(new EpisodeVideoMergeService(projectsRoot, runner()).merge("long", 1)).resolves.toMatchObject({ episode: { status: "completed" } });
  });

  it("reports unavailable and invalid probe errors without moving an approved Episode to rendering", async () => {
    const { projectsRoot } = await setup();
    await expect(new EpisodeVideoMergeService(projectsRoot, runner({ unavailable: true })).merge("long", 1)).rejects.toMatchObject({ response: { code: "LONG_EPISODE_FFMPEG_UNAVAILABLE" } });
    await expect(new EpisodeVideoMergeService(projectsRoot, runner({ invalidProbe: true })).merge("long", 1)).rejects.toMatchObject({ response: { code: "LONG_EPISODE_MERGE_CLIPS_INVALID" } });
    const project = JSON.parse(await fs.readFile(path.join(projectsRoot, "long", "long_story", "Episode01", "project.json"), "utf8")) as { state: string }; expect(project.state).toBe("videos_approved");
  });

  it("leaves placeholder narration out of the finished video", async () => {
    // 🔴 The original symptom. With no TTS credential the app writes four bytes of MP3 header so the pipeline
    // can be walked, and the merge asked only whether the file had a size — so silence went into finished
    // videos as though it were a voice, with the screen reporting narration the whole time. Nothing audible
    // changes by leaving it out; what changes is that the app stops presenting it as something it produced.
    const { projectsRoot } = await setup();
    const episodeDirectory = path.join(projectsRoot, "long", "long_story", "Episode01");
    const narrationFile = path.join(episodeDirectory, "narration", "scene2.mp3");
    await fs.mkdir(path.dirname(narrationFile), { recursive: true });
    await fs.writeFile(narrationFile, Buffer.from([0xff, 0xfb, 0x90, 0x00]));
    await fs.writeFile(
      path.join(episodeDirectory, "narration_generation_records.json"),
      JSON.stringify([{ scene_number: 2, narration: "line", checkpoint: "completed", adapter: "local-fake-tts-adapter", tts_api_calls: 0 }]),
      "utf8",
    );
    const projects = new LongProjectsService(projectsRoot);
    await projects.updateSettings("long", { settings: { ...settings, narrationEnabled: true } });

    const calls: string[][] = [];
    await new EpisodeVideoMergeService(projectsRoot, runner({}, calls)).merge("long", 1);

    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls).toHaveLength(6);
    // Every scene, including the one with a placeholder on disk, gets generated silence rather than that file.
    for (const call of normalizeCalls) {
      expect(call).not.toContain(narrationFile);
      expect(call).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    }
  });

  it("mixes in a scene's generated narration audio when narrationEnabled is on, and falls back to silence for the rest", async () => {
    const { projectsRoot } = await setup();
    const narrationFile = path.join(projectsRoot, "long", "long_story", "Episode01", "narration", "scene2.mp3");
    await fs.mkdir(path.dirname(narrationFile), { recursive: true });
    await fs.writeFile(narrationFile, Buffer.from("fake narration audio"));
    const projects = new LongProjectsService(projectsRoot);
    await projects.updateSettings("long", { settings: { ...settings, narrationEnabled: true } });

    const calls: string[][] = [];
    await new EpisodeVideoMergeService(projectsRoot, runner({}, calls)).merge("long", 1);
    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls).toHaveLength(6);
    expect(normalizeCalls[1]).toContain(narrationFile);
    for (const [index, call] of normalizeCalls.entries()) {
      if (index === 1) continue;
      expect(call).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    }
  });

  it("does not burn in any subtitle when subtitlesEnabled is off, even for a scene with real narration audio", async () => {
    const { projectsRoot } = await setup();
    const narrationFile = path.join(projectsRoot, "long", "long_story", "Episode01", "narration", "scene1.mp3");
    await fs.mkdir(path.dirname(narrationFile), { recursive: true });
    await fs.writeFile(narrationFile, Buffer.from("fake narration audio"));
    const projects = new LongProjectsService(projectsRoot);
    await projects.updateSettings("long", { settings: { ...settings, narrationEnabled: true } }); // subtitlesEnabled stays off

    const calls: string[][] = [];
    await new EpisodeVideoMergeService(projectsRoot, runner({}, calls)).merge("long", 1);
    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls[0]!.find((arg) => arg.includes("subtitles="))).toBeUndefined();
  });

  it("burns in a subtitle for a scene with narration text when subtitlesEnabled is on, independent of whether narration audio exists", async () => {
    const assFiles = new Map<string, string>();
    const { projectsRoot } = await setup();
    // The pipeline is already past script_review by this point (setup() runs it all the way to videos_approved),
    // so scripts.update() would reject the edit — write the stored narration text directly, same as the "requires
    // one persisted current job" test above edits generated_video_reviews.json directly.
    const episodeProjectFile = path.join(projectsRoot, "long", "long_story", "Episode01", "project.json");
    const stored = JSON.parse(await fs.readFile(episodeProjectFile, "utf8")) as { script: { scenes: Array<Record<string, unknown>> } };
    stored.script.scenes[0]!.narration = "장면 1 내레이션";
    await fs.writeFile(episodeProjectFile, JSON.stringify(stored, null, 2), "utf8");
    const projects = new LongProjectsService(projectsRoot);
    await projects.updateSettings("long", { settings: { ...settings, subtitlesEnabled: true } }); // narrationEnabled stays off — captions-only

    const calls: string[][] = [];
    await new EpisodeVideoMergeService(projectsRoot, runner({}, calls, assFiles)).merge("long", 1);
    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls[0]!.find((arg) => arg.includes("subtitles="))).toBeDefined();
    expect(normalizeCalls[0]).toContain("anullsrc=channel_layout=stereo:sample_rate=48000"); // no audio was ever generated
    expect(assFiles.get("scene1.ass")).toContain("장면 1 내레이션");
  });

  it("contains no provider or network client", async () => {
    // "runway" itself is allowed to appear as the execution_mode data tag a video record may already carry
    // (stamped upstream by episode-videos.service.ts once a scene's real generation succeeded) — this file only
    // ever reads already-downloaded local mp4 bytes off disk, regardless of how they got there. What must never
    // appear is an actual provider SDK/domain reference or a live network call.
    // Resolved from this file rather than process.cwd(): run from the repo root, that path does not exist and
    // the guard fails on a missing file instead of on the thing it guards.
    const source = await fs.readFile(new URL("./episode-video-merge.service.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/openai|runwayml\.com|runway-video-adapter|fetch\s*\(/i);
  });

  it("refuses to merge a paid run whose clips are placeholders, while the local fake path still merges", async () => {
    // What the real cycle left behind: records saying runway, reviews approved, and six 32-byte files. The old
    // check was "larger than zero bytes", which a bare header satisfies — so this would have concatenated the
    // stubs and published the result as the final video. Costs nothing, which is exactly why it is easy to
    // press and why the output is believed.
    const { projectsRoot } = await setup();
    const merge = new EpisodeVideoMergeService(projectsRoot, runner({}, []));
    const records = path.join(projectsRoot, "long", "long_story", "Episode01", "video_generation_records.json");
    const stored = JSON.parse(await fs.readFile(records, "utf8")) as Record<string, unknown>[];
    await fs.writeFile(records, JSON.stringify(stored.map((item) => ({ ...item, execution_mode: "runway" }))), "utf8");

    await expect(merge.merge("long", 1)).rejects.toMatchObject({ response: { code: "LONG_EPISODE_MERGE_CLIPS_INVALID" } });

    // The same clips under the local fake path are not a problem: there a placeholder is what the path writes.
    await fs.writeFile(records, JSON.stringify(stored), "utf8");
    await expect(new EpisodeVideoMergeService(projectsRoot, runner({}, [])).merge("long", 1)).resolves.toBeTruthy();
  });
});

describe("EpisodeVideoMergeService — audio", () => {
  /** A library holding one CC BY track, and a runner that records what ffmpeg was asked to do. */
  async function withTrack() {
    const audioRunner: MediaCommandRunner = async (arguments_) => {
      if ([...arguments_][0] === "ffprobe") return { stdout: JSON.stringify({ streams: [{ codec_type: "audio" }], format: { duration: "10.0" } }), stderr: "" };
      throw new Error("unexpected audio command");
    };
    const library = new AudioLibraryService(root!, audioRunner);
    const uploaded = await library.upload(
      { buffer: Buffer.from("fake mp3 bytes"), originalname: "bgm.mp3", mimetype: "audio/mpeg" },
      { licenseKind: "cc-by", attributionRequired: true, attributionText: "Music by Jane Doe" },
    );
    const calls: string[][] = [];
    const mergeRunner: MediaCommandRunner = async (arguments_) => {
      const args = [...arguments_];
      calls.push(args);
      if (args[0] === "ffprobe") return { stdout: JSON.stringify({ streams: [{ codec_type: "video" }], format: { duration: "30.0" } }), stderr: "" };
      await fs.writeFile(args.at(-1)!, "rendered");
      return { stdout: "", stderr: "" };
    };
    return { library, uploaded, mergeRunner, calls };
  }

  it("puts music under an Episode that has no narration, and remembers the credit it owes", async () => {
    // The credit is the point. An Episode built on a CC BY track had nowhere to record that, so the publish
    // screen — which shipped first — had nothing to show and would have published it uncredited (D-003).
    const { projectsRoot } = await setup();
    const { library, uploaded, mergeRunner } = await withTrack();
    const service = new EpisodeVideoMergeService(projectsRoot, mergeRunner, library);

    const result = await service.merge("long", 1, { audio: { mode: "bgm", trackId: uploaded.track.trackId } });

    expect(result.finalVideoPath).toBe("videos/final/instagram_reel.mp4");
    const { episode } = await new EpisodeScriptsService(projectsRoot).get("long", 1);
    expect(episode.usedAudio).toMatchObject({
      mode: "bgm", trackId: uploaded.track.trackId, attributionRequired: true, attributionText: "Music by Jane Doe",
    });
  });

  // 캡틴D puts music on Episodes, so a control that only worked on short projects would not work where it is
  // used. Same field, same refusal, same code — one sentence serves both screens (Cowork Round 456 asked).
  it("starts an Episode's music where it was asked to, and refuses a start past the end with the track's length", async () => {
    const { projectsRoot } = await setup();
    const { library, uploaded, mergeRunner, calls } = await withTrack();

    await new EpisodeVideoMergeService(projectsRoot, mergeRunner, library)
      .merge("long", 1, { audio: { mode: "bgm", trackId: uploaded.track.trackId, startSeconds: 4 } });

    const mix = calls.find((args) => args.includes("-stream_loop"))!;
    expect(mix.indexOf("-ss")).toBeLessThan(mix.indexOf("-stream_loop"));
    expect(mix[mix.indexOf("-ss") + 1]).toBe("4.000");

    const { projectsRoot: second } = await setup();
    const again = await withTrack();
    await expect(new EpisodeVideoMergeService(second, again.mergeRunner, again.library)
      .merge("long", 1, { audio: { mode: "bgm", trackId: again.uploaded.track.trackId, startSeconds: 30 } }))
      .rejects.toMatchObject({ response: { code: "AUDIO_START_OUT_OF_RANGE", details: { durationSeconds: 10 } } });
  });

  it("plays that music at the level it was uploaded, since there is no voice for it to sit under", async () => {
    const { projectsRoot } = await setup();
    const { library, uploaded, mergeRunner, calls } = await withTrack();

    await new EpisodeVideoMergeService(projectsRoot, mergeRunner, library).merge("long", 1, { audio: { mode: "bgm", trackId: uploaded.track.trackId } });

    const mix = calls.find((args) => args.includes("-stream_loop"));
    expect(mix).toBeDefined();
    expect(mix!.join(" ")).toContain("volume=1");
  });

  it("refuses narration for an Episode that has none, rather than rendering something else", async () => {
    const { projectsRoot } = await setup();

    await expect(new EpisodeVideoMergeService(projectsRoot, runner({})).merge("long", 1, { audio: { mode: "narration" } }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("refuses music with no track named", async () => {
    const { projectsRoot } = await setup();

    await expect(new EpisodeVideoMergeService(projectsRoot, runner({})).merge("long", 1, { audio: { mode: "bgm" } }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("merges silently and mixes nothing when no audio is asked for at all", async () => {
    const { projectsRoot } = await setup();
    const calls: string[][] = [];
    await new EpisodeVideoMergeService(projectsRoot, runner({}, calls)).merge("long", 1);

    expect(calls.some((args) => args.includes("-stream_loop"))).toBe(false);
  });
});

describe("EpisodeVideoMergeService — the cut it replaces", () => {
  /**
   * Re-merging overwrote the finished video in place. The previous cut may already have been watched,
   * approved, or been one press away from being published — and it was simply gone, with no way to get back to
   * it. Archiving costs a local file copy.
   */
  it("keeps the previous final video when a second merge replaces it", async () => {
    const { projectsRoot } = await setup();
    const service = new EpisodeVideoMergeService(projectsRoot, runner({}));
    const final = path.join(projectsRoot, "long", "long_story", "Episode01", "videos", "final");

    await service.merge("long", 1);
    const first = await fs.readFile(path.join(final, "instagram_reel.mp4"));
    // What a clip restore leaves behind: the Episode is mergeable again and the old cut is still on disk.
    const episodeFile = path.join(projectsRoot, "long", "long_story", "Episode01", "project.json");
    const stored = JSON.parse(await fs.readFile(episodeFile, "utf8")) as Record<string, unknown>;
    await fs.writeFile(episodeFile, JSON.stringify({ ...stored, state: "videos_approved", final_video_path: null }));
    await service.merge("long", 1);

    expect(Buffer.from(await fs.readFile(path.join(final, "history", "instagram_reel_v001.mp4"))).equals(first)).toBe(true);
  });

  /**
   * The version numbers are read off the directory, so a listing that fails must not read as "none".
   *
   * It did: any failure came back as an empty list, the next number restarted at v001, and the copy landed on
   * top of a cut that was already there — a cut merged from paid Runway clips. The short project's own history
   * listing was fixed for exactly this reason (docs/06_DECISIONS.md D-036); the Episode kept the permissive
   * copy.
   *
   * The failure is injected rather than staged with real files. Putting a file where the directory belongs
   * makes readdir fail, but it also makes the write fail, so the merge is refused either way and the test
   * passes for both implementations — measured, that version of this test stayed green against the defect.
   */
  it("refuses to renumber when it cannot read what is already archived, instead of writing over v001", async () => {
    const { projectsRoot } = await setup();
    const final = path.join(projectsRoot, "long", "long_story", "Episode01", "videos", "final");
    const episodeFile = path.join(projectsRoot, "long", "long_story", "Episode01", "project.json");
    const remergeable = async () => {
      const stored = JSON.parse(await fs.readFile(episodeFile, "utf8")) as Record<string, unknown>;
      await fs.writeFile(episodeFile, JSON.stringify({ ...stored, state: "videos_approved", final_video_path: null }));
    };
    await new EpisodeVideoMergeService(projectsRoot, runner({})).merge("long", 1);
    const firstCut = await fs.readFile(path.join(final, "instagram_reel.mp4"));
    await remergeable();
    await new EpisodeVideoMergeService(projectsRoot, runner({})).merge("long", 1);
    const archived = await fs.readFile(path.join(final, "history", "instagram_reel_v001.mp4"));
    expect(Buffer.from(archived).equals(firstCut)).toBe(true);
    await remergeable();

    const blind = new EpisodeVideoMergeService(projectsRoot, runner({}), undefined, undefined,
      async () => { throw Object.assign(new Error("locked"), { code: "EACCES" }); });
    await expect(blind.merge("long", 1)).rejects.toMatchObject({ response: { code: expect.stringMatching(/STORAGE_ERROR|MERGE_FAILED/) } });

    // v001 is still the first cut, not a copy written over it by a numbering that started again.
    expect(Buffer.from(await fs.readFile(path.join(final, "history", "instagram_reel_v001.mp4"))).equals(firstCut)).toBe(true);
    expect((await fs.readdir(path.join(final, "history"))).filter((name) => name.endsWith(".mp4"))).toHaveLength(1);
  });

  it("archives nothing on a first merge, because there is no previous cut to keep", async () => {
    const { projectsRoot } = await setup();
    await new EpisodeVideoMergeService(projectsRoot, runner({})).merge("long", 1);

    await expect(fs.readdir(path.join(projectsRoot, "long", "long_story", "Episode01", "videos", "final", "history")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("EpisodeVideoMergeService — the path a person can open", () => {
  /**
   * `finalVideoPath` is the same string on both merge responses and means a different origin on each: the short
   * project's is relative to the project, the Episode's to the Episode. The desktop bridge resolves everything
   * against the project folder, so handing the Episode's value over names
   * `<projectId>/videos/final/instagram_reel.mp4` — nothing at all, or for an id that is also a short project,
   * somebody else's finished video.
   *
   * Composed here rather than in the screen: the Episode's directory layout has one home in this codebase, and
   * a screen assembling `long_story/EpisodeNN/...` would be a second copy of it in the place least able to
   * notice when it stops matching disk.
   */
  it("returns the merged file addressed from the project root as well as from the Episode", async () => {
    const { projectsRoot } = await setup();

    const result = await new EpisodeVideoMergeService(projectsRoot, runner({})).merge("long", 1);

    expect(result.finalVideoPath).toBe("videos/final/instagram_reel.mp4");
    expect(result.openablePath).toBe("long_story/Episode01/videos/final/instagram_reel.mp4");
    // Forward slashes on the wire, whatever this machine's separator is: the screen passes it through untouched.
    expect(result.openablePath).not.toContain("\\");
    // And the Episode carries both too, so a reload can still open it.
    expect(result.episode.openablePath).toBe("long_story/Episode01/videos/final/instagram_reel.mp4");
  });
});
