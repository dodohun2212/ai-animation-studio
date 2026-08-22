import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";

import { MediaToolError, type MediaCommandRunner } from "./ffmpeg-merge.service.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
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
});
