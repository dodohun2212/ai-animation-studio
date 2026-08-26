import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";

import { MediaToolError, type MediaCommandRunner } from "./ffmpeg-merge.service.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { AudioLibraryService } from "../audio/audio-library.service.js";
import { LocalVideoMergeService } from "./video-merge.service.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

function runner(options: { invalidProbe?: boolean; noOutput?: boolean; unavailable?: boolean } = {}, calls: string[][] = []): MediaCommandRunner {
  return async (arguments_) => {
    const args = [...arguments_]; calls.push(args);
    if (options.unavailable) throw new MediaToolError("unavailable", "not installed");
    if (args[0] === "ffprobe") return { stdout: JSON.stringify(options.invalidProbe ? { streams: [], format: { duration: "0" } } : { streams: [{ codec_type: "video" }], format: { duration: "5.0" } }), stderr: "" };
    const output = args.at(-1)!;
    if (!options.noOutput) await fs.writeFile(output, Buffer.from("rendered"));
    return { stdout: "", stderr: "" };
  };
}

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "video-merge-")); roots.push(root);
  const projectsRoot = path.join(root, "projects"); const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("video_merge", "topic", "2026-08-23T00:00:00.000Z");
  project.workflow_state = WorkflowState.VideosApproved;
  await projects.create(project);
  const directory = path.join(projectsRoot, project.project_id, "videos", "runway"); await fs.mkdir(directory, { recursive: true });
  await Promise.all([1, 2, 3, 4, 5, 6].map((scene) => fs.writeFile(path.join(directory, `scene${scene}.mp4`), Buffer.from(`scene-${scene}`))));
  await fs.writeFile(path.join(projectsRoot, project.project_id, "generated_video_reviews.json"), JSON.stringify([1, 2, 3, 4, 5, 6].map((scene) => ({ scene_number: scene, status: "approved", updated_at: "2026-08-23T00:00:00.000Z" }))), "utf8");
  return { root, projectsRoot, projects };
}

describe("local FFmpeg video merge", () => {
  it("probes, portrait-normalizes, concatenates six approved clips, and persists a relative final path", async () => {
    const { projectsRoot, projects } = await setup(); const calls: string[][] = [];
    const result = await new LocalVideoMergeService(projects, projectsRoot, runner({}, calls)).merge("video_merge");
    expect(result.finalVideoPath).toBe("videos/final/instagram_reel.mp4");
    expect(result.project.workflowState).toBe(WorkflowState.Completed);
    expect(result.project.finalVideoPath).toBe("videos/final/instagram_reel.mp4");
    expect(JSON.stringify(result)).not.toContain(projectsRoot);
    expect(calls.filter((args) => args[0] === "ffprobe")).toHaveLength(6);
    expect(calls.filter((args) => args[0] === "ffmpeg")).toHaveLength(7);
    expect(calls.find((args) => args.includes("-vf"))!).toContain("scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p");
    expect(await fs.readFile(path.join(projectsRoot, "video_merge", "videos", "final", "instagram_reel.mp4"), "utf8")).toBe("rendered");
  });

  it("archives the previous final video before a second merge overwrites it, rather than losing it", async () => {
    const { projectsRoot, projects } = await setup();
    let round = 1;
    const runnerThatVariesOutput: MediaCommandRunner = async (arguments_) => {
      const args = [...arguments_];
      if (args[0] === "ffprobe") return { stdout: JSON.stringify({ streams: [{ codec_type: "video" }], format: { duration: "5.0" } }), stderr: "" };
      await fs.writeFile(args.at(-1)!, Buffer.from(`rendered-${round}`));
      return { stdout: "", stderr: "" };
    };
    const service = new LocalVideoMergeService(projects, projectsRoot, runnerThatVariesOutput);

    await service.merge("video_merge");
    // Simulate what video-library.service.ts's restore() does to reopen merging (a scene-version restore
    // clears finalVideoPath and reverts Completed -> VideosApproved) — this file only asserts the merge-side
    // archiving, not the restore-side state transition (covered by video-library.service.test.ts).
    const reopened = await projects.findById("video_merge");
    reopened.workflow_state = WorkflowState.VideosApproved;
    reopened.final_video_path = null;
    await projects.save(reopened);
    round = 2;

    await service.merge("video_merge");

    expect(await fs.readFile(path.join(projectsRoot, "video_merge", "videos", "final", "instagram_reel.mp4"), "utf8")).toBe("rendered-2");
    const historyDir = path.join(projectsRoot, "video_merge", "videos", "final", "history");
    const archived = await fs.readdir(historyDir);
    expect(archived).toEqual(["instagram_reel_v001.mp4"]);
    expect(await fs.readFile(path.join(historyDir, "instagram_reel_v001.mp4"), "utf8")).toBe("rendered-1");
  });

  it("serves the final merged video by canonical path once it exists, and rejects before that", async () => {
    const { projectsRoot, projects } = await setup();
    const service = new LocalVideoMergeService(projects, projectsRoot, runner({}));
    await expect(service.content("video_merge")).rejects.toMatchObject({ response: { code: "VIDEO_MERGE_CONTENT_UNAVAILABLE" } });
    await service.merge("video_merge");
    const content = await service.content("video_merge");
    expect(content).toEqual({ path: path.join(projectsRoot, "video_merge", "videos", "final", "instagram_reel.mp4") });
    await expect(fs.readFile(content.path, "utf8")).resolves.toBe("rendered");
  });

  it("uses the documented landscape normalization when the stored wizard aspect is 16:9", async () => {
    const { projectsRoot, projects } = await setup(); const project = await projects.findById("video_merge"); project.style_profile = { aspect: "16:9" }; await projects.save(project);
    const calls: string[][] = []; await new LocalVideoMergeService(projects, projectsRoot, runner({}, calls)).merge("video_merge");
    expect(calls.find((args) => args.includes("-vf"))!).toContain("scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p");
  });

  it("rejects invalid clips without changing the approved state, and reports a missing binary safely", async () => {
    const { projectsRoot, projects } = await setup();
    await expect(new LocalVideoMergeService(projects, projectsRoot, runner({ invalidProbe: true })).merge("video_merge")).rejects.toMatchObject({ response: { code: "VIDEO_MERGE_CLIPS_INVALID" } });
    expect((await projects.findById("video_merge")).workflow_state).toBe(WorkflowState.VideosApproved);
    await expect(new LocalVideoMergeService(projects, projectsRoot, runner({ unavailable: true })).merge("video_merge")).rejects.toMatchObject({ response: { code: "FFMPEG_UNAVAILABLE" } });
    expect((await projects.findById("video_merge")).workflow_state).toBe(WorkflowState.VideosApproved);
  });

  it("persists FAILED without deleting approved clips when output creation fails, and a new service instance can merge persisted state", async () => {
    const { projectsRoot, projects } = await setup();
    await expect(new LocalVideoMergeService(projects, projectsRoot, runner({ noOutput: true })).merge("video_merge")).rejects.toMatchObject({ response: { code: "VIDEO_MERGE_FAILED" } });
    const failed = await projects.findById("video_merge");
    expect(failed.workflow_state).toBe(WorkflowState.Failed); expect(failed.errors).toContain("Local video rendering failed.");
    await expect(fs.stat(path.join(projectsRoot, "video_merge", "videos", "runway", "scene1.mp4"))).resolves.toBeTruthy();
    failed.workflow_state = WorkflowState.VideosApproved; failed.errors = []; await projects.save(failed);
    await expect(new LocalVideoMergeService(new LocalProjectRepository(projectsRoot), projectsRoot, runner()).merge("video_merge")).resolves.toMatchObject({ finalVideoPath: "videos/final/instagram_reel.mp4" });
  });

  it("mixes in a scene's generated narration audio when it has one, and falls back to silence for the rest", async () => {
    const { projectsRoot, projects } = await setup();
    const narrationFile = path.join(projectsRoot, "video_merge", "narration", "scene2.mp3");
    await fs.mkdir(path.dirname(narrationFile), { recursive: true });
    await fs.writeFile(narrationFile, Buffer.from("fake narration audio"));
    const project = await projects.findById("video_merge");
    project.generated_narrations = [null, narrationFile, null, null, null, null];
    project.lore_context = { ...project.lore_context, narration_enabled: true };
    await projects.save(project);

    const calls: string[][] = [];
    await new LocalVideoMergeService(projects, projectsRoot, runner({}, calls)).merge("video_merge");
    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls).toHaveLength(6);
    expect(normalizeCalls[1]).toContain(narrationFile);
    expect(normalizeCalls[1]).toContain("[1:a]apad[aout]");
    for (const [index, call] of normalizeCalls.entries()) {
      if (index === 1) continue;
      expect(call).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    }
  });

  it("does not burn in any subtitle when subtitlesEnabled is off, even for a scene with real narration audio", async () => {
    const { projectsRoot, projects } = await setup();
    const narrationFile = path.join(projectsRoot, "video_merge", "narration", "scene1.mp3");
    await fs.mkdir(path.dirname(narrationFile), { recursive: true });
    await fs.writeFile(narrationFile, Buffer.from("fake narration audio"));
    const project = await projects.findById("video_merge");
    project.generated_narrations = [narrationFile];
    project.scenes = [1, 2, 3, 4, 5, 6].map((number) => ({ number, narration: `장면 ${number} 내레이션` }));
    await projects.save(project); // subtitlesEnabled defaults false — narrationEnabled was never set either, so there's no fallback to true

    const calls: string[][] = [];
    await new LocalVideoMergeService(projects, projectsRoot, runner({}, calls)).merge("video_merge");
    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls[0]!.find((arg) => arg.includes("subtitles="))).toBeUndefined();
  });

  it("burns in subtitles for every scene with narration text when subtitlesEnabled is on, independent of whether narration audio exists (captions-only mode)", async () => {
    const { projectsRoot, projects } = await setup();
    const narrationFile = path.join(projectsRoot, "video_merge", "narration", "scene1.mp3");
    await fs.mkdir(path.dirname(narrationFile), { recursive: true });
    await fs.writeFile(narrationFile, Buffer.from("fake narration audio"));
    const project = await projects.findById("video_merge");
    project.generated_narrations = [narrationFile]; // only scene 1 has audio
    project.lore_context = { ...project.lore_context, narration_enabled: true, subtitles_enabled: true };
    project.scenes = [1, 2, 3, 4, 5, 6].map((number) => ({ number, narration: number <= 2 ? `장면 ${number} 내레이션` : "" }));
    await projects.save(project);

    const calls: string[][] = [];
    await new LocalVideoMergeService(projects, projectsRoot, runner({}, calls)).merge("video_merge");
    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    // Scene 1: audio + subtitle. Scene 2: subtitle only, no audio (the captions-only case). Scenes 3-6: neither (no narration text).
    expect(normalizeCalls[0]!.find((arg) => arg.includes("subtitles="))).toBeDefined();
    expect(normalizeCalls[0]).toContain(narrationFile);
    expect(normalizeCalls[1]!.find((arg) => arg.includes("subtitles="))).toBeDefined();
    expect(normalizeCalls[1]).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    for (const call of normalizeCalls.slice(2)) {
      expect(call.find((arg) => arg.includes("subtitles="))).toBeUndefined();
    }
    const assContent = await fs.readFile(path.join(projectsRoot, "video_merge", "videos", "final", "normalized", "scene2.ass"), "utf8");
    expect(assContent).toContain("장면 2 내레이션");
  });

  it("never fails the merge over a missing or empty narration file — that scene just falls back to silence", async () => {
    const { projectsRoot, projects } = await setup();
    const project = await projects.findById("video_merge");
    const emptyNarration = path.join(projectsRoot, "video_merge", "narration", "scene1.mp3");
    await fs.mkdir(path.dirname(emptyNarration), { recursive: true });
    await fs.writeFile(emptyNarration, Buffer.alloc(0));
    project.generated_narrations = [emptyNarration, "C:/no/such/file/scene2.mp3"];
    project.lore_context = { ...project.lore_context, narration_enabled: true };
    await projects.save(project);

    const calls: string[][] = [];
    const result = await new LocalVideoMergeService(projects, projectsRoot, runner({}, calls)).merge("video_merge");
    expect(result.finalVideoPath).toBe("videos/final/instagram_reel.mp4");
    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls.every((call) => call.includes("anullsrc=channel_layout=stereo:sample_rate=48000"))).toBe(true);
  });

  it("falls back to silence for a scene with real narration audio once narrationEnabled is turned off, even though the old file is still on disk", async () => {
    const { projectsRoot, projects } = await setup();
    const narrationFile = path.join(projectsRoot, "video_merge", "narration", "scene1.mp3");
    await fs.mkdir(path.dirname(narrationFile), { recursive: true });
    await fs.writeFile(narrationFile, Buffer.from("fake narration audio"));
    const project = await projects.findById("video_merge");
    project.generated_narrations = [narrationFile];
    project.lore_context = { ...project.lore_context, narration_enabled: false };
    await projects.save(project);

    const calls: string[][] = [];
    await new LocalVideoMergeService(projects, projectsRoot, runner({}, calls)).merge("video_merge");
    const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
    expect(normalizeCalls[0]).not.toContain(narrationFile);
    expect(normalizeCalls[0]).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
  });

  describe("audio request", () => {
    async function withNarration(projects: LocalProjectRepository, projectsRoot: string, enabled = true) {
      const narrationFile = path.join(projectsRoot, "video_merge", "narration", "scene1.mp3");
      await fs.mkdir(path.dirname(narrationFile), { recursive: true });
      await fs.writeFile(narrationFile, Buffer.from("fake narration audio"));
      const project = await projects.findById("video_merge");
      project.generated_narrations = [narrationFile];
      project.lore_context = { ...project.lore_context, narration_enabled: enabled };
      await projects.save(project);
      return narrationFile;
    }

    it("an explicit silent request overrides narrationEnabled=true", async () => {
      const { projectsRoot, projects } = await setup();
      const narrationFile = await withNarration(projects, projectsRoot, true);
      const calls: string[][] = [];
      await new LocalVideoMergeService(projects, projectsRoot, runner({}, calls)).merge("video_merge", { audio: { mode: "silent" } });
      const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
      expect(normalizeCalls[0]).not.toContain(narrationFile);
      expect(normalizeCalls[0]).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    });

    it("an explicit narration request overrides narrationEnabled=false, since the caller is choosing it deliberately", async () => {
      const { projectsRoot, projects } = await setup();
      const narrationFile = await withNarration(projects, projectsRoot, false);
      const calls: string[][] = [];
      await new LocalVideoMergeService(projects, projectsRoot, runner({}, calls)).merge("video_merge", { audio: { mode: "narration" } });
      const normalizeCalls = calls.filter((args) => args[0] === "ffmpeg" && args.includes("-vf"));
      expect(normalizeCalls[0]).toContain(narrationFile);
    });

    it("rejects an explicit narration request when the project has no narration audio at all", async () => {
      const { projectsRoot, projects } = await setup();
      await expect(new LocalVideoMergeService(projects, projectsRoot, runner()).merge("video_merge", { audio: { mode: "narration" } }))
        .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    });

    it("rejects an unknown audio.mode value", async () => {
      const { projectsRoot, projects } = await setup();
      await expect(new LocalVideoMergeService(projects, projectsRoot, runner()).merge("video_merge", { audio: { mode: "loud" } }))
        .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    });

    it("rejects narration+bgm without a trackId", async () => {
      const { projectsRoot, projects } = await setup();
      await withNarration(projects, projectsRoot, true);
      await expect(new LocalVideoMergeService(projects, projectsRoot, runner()).merge("video_merge", { audio: { mode: "narration+bgm" } }))
        .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    });

    it("rejects a volume or fadeSeconds outside their valid range", async () => {
      const { projectsRoot, projects } = await setup();
      await expect(new LocalVideoMergeService(projects, projectsRoot, runner()).merge("video_merge", { audio: { mode: "silent", volume: 1.5 } }))
        .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
      await expect(new LocalVideoMergeService(projects, projectsRoot, runner()).merge("video_merge", { audio: { mode: "silent", fadeSeconds: -1 } }))
        .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    });

    it("rejects narration+bgm when no AudioLibraryService is configured", async () => {
      const { projectsRoot, projects } = await setup();
      await withNarration(projects, projectsRoot, true);
      await expect(new LocalVideoMergeService(projects, projectsRoot, runner()).merge("video_merge", { audio: { mode: "narration+bgm", trackId: "TRACK-MISSING" } }))
        .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    });

    it("mixes in a real BGM track from the audio library, keeping narration in the base merge", async () => {
      const { projectsRoot, projects, root } = await setup();
      await withNarration(projects, projectsRoot, true);
      const audioRunner: MediaCommandRunner = async (arguments_) => {
        const args = [...arguments_];
        if (args[0] === "ffprobe") return { stdout: JSON.stringify({ streams: [{ codec_type: "audio" }], format: { duration: "10.0" } }), stderr: "" };
        throw new Error("unexpected audio command");
      };
      const audioLibrary = new AudioLibraryService(root, audioRunner);
      const uploaded = await audioLibrary.upload(
        { buffer: Buffer.from("fake mp3 bytes"), originalname: "bgm.mp3", mimetype: "audio/mpeg" },
        { licenseKind: "self-made", attributionRequired: false },
      );

      const calls: string[][] = [];
      const mergeRunner: MediaCommandRunner = async (arguments_) => {
        const args = [...arguments_];
        calls.push(args);
        if (args[0] === "ffprobe") {
          // First call in merge() probes each scene clip (needs a video stream); mixBackgroundMusic() later
          // probes the already-merged final video's duration (needs only format.duration).
          return { stdout: JSON.stringify({ streams: [{ codec_type: "video" }], format: { duration: "30.0" } }), stderr: "" };
        }
        const output = args.at(-1)!;
        await fs.writeFile(output, Buffer.from("rendered"));
        return { stdout: "", stderr: "" };
      };
      const service = new LocalVideoMergeService(projects, projectsRoot, mergeRunner, audioLibrary);

      const result = await service.merge("video_merge", { audio: { mode: "narration+bgm", trackId: uploaded.track.trackId, volume: 0.4, fadeSeconds: 3 } });

      expect(result.finalVideoPath).toBe("videos/final/instagram_reel.mp4");
      const bgmMixCall = calls.find((args) => args[0] === "ffmpeg" && args.includes("-stream_loop"));
      expect(bgmMixCall).toBeDefined();
      expect(bgmMixCall!.join(" ")).toContain("volume=0.4");
      // -stream_loop -1 is the bgm input's own option, so it must sit right before that -i, not the video input's.
      const bgmInputIndex = bgmMixCall!.indexOf("-stream_loop");
      expect(bgmMixCall![bgmInputIndex + 2]).toBe("-i");
    });
  });
});
