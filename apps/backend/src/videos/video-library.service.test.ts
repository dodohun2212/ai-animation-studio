import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";

import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { RunwayBudget } from "../providers/runway-budget.js";
import { VideoLibraryService } from "./video-library.service.js";
import { PLACEHOLDER_MP4 } from "./placeholder-clip.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "video-library-")); roots.push(root);
  const projectsRoot = path.join(root, "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const budget = new RunwayBudget(root);
  return { root, projectsRoot, projects, budget, service: new VideoLibraryService(projects, projectsRoot, budget) };
}

async function createProjectWithVideos(projectsRoot: string, projects: LocalProjectRepository, id: string, options: { scenes?: number[]; finalVideo?: boolean; state?: WorkflowState } = {}) {
  const project = createStoredProject(id, `topic ${id}`, "2026-08-23T00:00:00.000Z");
  project.workflow_state = options.state ?? WorkflowState.Completed;
  await projects.create(project);
  const runwayDir = path.join(projectsRoot, id, "videos", "runway");
  await fs.mkdir(runwayDir, { recursive: true });
  for (const scene of options.scenes ?? [1, 2, 3, 4, 5, 6]) {
    await fs.writeFile(path.join(runwayDir, `scene${scene}.mp4`), Buffer.from(`scene-${scene}-current`));
  }
  if (options.finalVideo) {
    const finalDir = path.join(projectsRoot, id, "videos", "final");
    await fs.mkdir(finalDir, { recursive: true });
    await fs.writeFile(path.join(finalDir, "instagram_reel.mp4"), Buffer.from("final-current"));
    const updated = await projects.findById(id);
    updated.final_video_path = "videos/final/instagram_reel.mp4";
    await projects.save(updated);
  }
  return project;
}

/**
 * Lays an Episode on disk the way the Episode services do — same directory names, since the library reads
 * them through the same path helpers.
 */
async function createEpisodeWithVideos(projectsRoot: string, projectId: string, episodeNumber: number, options: { scenes?: number[]; finalVideo?: boolean; paid?: boolean; title?: string; updatedAt?: string; usedAudio?: Record<string, unknown> } = {}) {
  const storyRoot = path.join(projectsRoot, projectId, "long_story");
  const directory = path.join(storyRoot, `Episode${String(episodeNumber).padStart(2, "0")}`);
  await fs.mkdir(path.join(directory, "videos"), { recursive: true });
  await fs.writeFile(path.join(storyRoot, "project.json"), JSON.stringify({ title: `story ${projectId}`, aspect_ratio: "9:16" }));
  const outlines = Array.from({ length: episodeNumber }, (_unused, index) => ({ episode_number: index + 1, title: `outline ${index + 1}` }));
  await fs.writeFile(path.join(storyRoot, "episode_outlines.json"), JSON.stringify(outlines));
  await fs.writeFile(path.join(directory, "project.json"), JSON.stringify({
    number: episodeNumber, state: "videos_review", approved: true, script: {}, script_revision: 1,
    scene_count: 6, title: options.title ?? `episode ${episodeNumber}`, updated_at: options.updatedAt ?? "2026-08-24T00:00:00.000Z",
    ...(options.usedAudio ? { used_audio: options.usedAudio } : {}),
  }));
  await fs.writeFile(path.join(directory, "video_generation_records.json"), JSON.stringify(
    (options.scenes ?? [1, 2, 3, 4, 5, 6]).map((scene) => ({ scene_number: scene, job_id: "job", status: "succeeded", execution_mode: options.paid ? "runway" : "local_fake_no_provider" })),
  ));
  for (const scene of options.scenes ?? [1, 2, 3, 4, 5, 6]) {
    await fs.writeFile(path.join(directory, "videos", `scene${scene}.mp4`), Buffer.concat([PLACEHOLDER_MP4, Buffer.alloc(512, scene)]));
  }
  if (options.finalVideo) {
    await fs.mkdir(path.join(directory, "videos", "final"), { recursive: true });
    await fs.writeFile(path.join(directory, "videos", "final", "instagram_reel.mp4"), Buffer.concat([PLACEHOLDER_MP4, Buffer.alloc(4096, 7)]));
  }
  return directory;
}

describe("VideoLibraryService.list", () => {
  it("lists only projects with at least one video, with correct counts and cost totals", async () => {
    const { projectsRoot, projects, budget, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "with_videos", { scenes: [1, 2, 3], finalVideo: true });
    const never = createStoredProject("never_generated", "no videos yet", "2026-08-23T00:00:00.000Z");
    await projects.create(never);
    await budget.record("with_videos", 1, "video", true, 0.25);
    await budget.record("with_videos", 2, "video", true, 0.25);

    const result = await service.list();

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({
      projectId: "with_videos", topic: "topic with_videos", sceneCount: 6, videosReadyCount: 3,
      finalVideoAvailable: true, totalActualCostUsd: 0.5,
    });
  });

  it("includes a project with only a final video and zero scene videos", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "final_only", { scenes: [], finalVideo: true });

    const result = await service.list();

    expect(result.projects).toEqual([expect.objectContaining({ projectId: "final_only", videosReadyCount: 0, finalVideoAvailable: true })]);
  });

  it("reports zero cost for a project that never used a real Runway credential", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "local_fake", { scenes: [1] });

    const result = await service.list();

    expect(result.projects[0]?.totalActualCostUsd).toBe(0);
  });

  it("sorts newest updatedAt first", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "older", { scenes: [1] });
    const older = await projects.findById("older"); older.updated_at = "2026-08-20T00:00:00.000Z"; await projects.save(older);
    await createProjectWithVideos(projectsRoot, projects, "newer", { scenes: [1] });
    const newer = await projects.findById("newer"); newer.updated_at = "2026-08-25T00:00:00.000Z"; await projects.save(newer);

    const result = await service.list();

    expect(result.projects.map((item) => item.projectId)).toEqual(["newer", "older"]);
  });

  it("carries attributionRequired/attributionText from usedAudio, trimmed to just those two fields", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "credited", { scenes: [1], finalVideo: true });
    const project = await projects.findById("credited");
    project.used_audio = { mode: "narration+bgm", track_id: "TRACK-1", attribution_required: true, attribution_text: "Music by Jane Doe" };
    await projects.save(project);

    const result = await service.list();

    expect(result.projects[0]).toMatchObject({ attributionRequired: true, attributionText: "Music by Jane Doe" });
  });

  it("omits attributionRequired/attributionText entirely when usedAudio is absent", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "uncredited", { scenes: [1], finalVideo: true });

    const result = await service.list();

    expect(result.projects[0]).not.toHaveProperty("attributionRequired");
    expect(result.projects[0]).not.toHaveProperty("attributionText");
  });
});

describe("VideoLibraryService.versions", () => {
  it("lists the current scene version plus history, newest first", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [1] });
    const history = path.join(projectsRoot, "p1", "videos", "history");
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(path.join(history, "scene1_v001.mp4"), Buffer.from("v1"));
    await fs.writeFile(path.join(history, "scene1_v002.mp4"), Buffer.from("v2-longer"));

    const result = await service.versions("p1", "1");

    expect(result.versions.map((item) => item.versionId)).toEqual(["current", "v002", "v001"]);
    expect(result.versions[0]).toMatchObject({ isCurrent: true });
    expect(result.versions[1]).toMatchObject({ isCurrent: false, bytes: 9 });
  });

  it("lists final video versions the same way, under the instagram_reel_v naming", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [], finalVideo: true });
    const history = path.join(projectsRoot, "p1", "videos", "final", "history");
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(path.join(history, "instagram_reel_v001.mp4"), Buffer.from("old-final"));

    const result = await service.versions("p1", "final");

    expect(result.versions.map((item) => item.versionId)).toEqual(["current", "v001"]);
  });

  it("rejects a scene number outside this project's own scene count", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [1] });

    await expect(service.versions("p1", "99")).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("lists history even when the current file is missing", async () => {
    const { projectsRoot, projects, service } = await setup();
    const project = createStoredProject("p1", "topic", "2026-08-23T00:00:00.000Z");
    await projects.create(project);
    const history = path.join(projectsRoot, "p1", "videos", "history");
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(path.join(history, "scene1_v001.mp4"), Buffer.from("v1"));

    const result = await service.versions("p1", "1");

    expect(result.versions).toEqual([expect.objectContaining({ versionId: "v001", isCurrent: false })]);
  });
});

describe("VideoLibraryService.content", () => {
  it("streams the current file's path", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [1] });

    const result = await service.content("p1", "1", "current");

    expect(await fs.readFile(result.path, "utf8")).toBe("scene-1-current");
  });

  it("streams a historical version's path", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [1] });
    const history = path.join(projectsRoot, "p1", "videos", "history");
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(path.join(history, "scene1_v001.mp4"), Buffer.from("archived"));

    const result = await service.content("p1", "1", "v001");

    expect(await fs.readFile(result.path, "utf8")).toBe("archived");
  });

  it("rejects a version that does not exist", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [1] });

    await expect(service.content("p1", "1", "v001")).rejects.toMatchObject({ response: { code: "VIDEO_LIBRARY_CONTENT_UNAVAILABLE" } });
  });

  it("rejects a malformed versionId", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [1] });

    await expect(service.content("p1", "1", "not-a-version")).rejects.toMatchObject({ response: { code: "VIDEO_LIBRARY_VERSION_NOT_FOUND" } });
  });
});

describe("VideoLibraryService.restore", () => {
  it("requires explicit approval", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [1] });
    const history = path.join(projectsRoot, "p1", "videos", "history");
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(path.join(history, "scene1_v001.mp4"), Buffer.from("archived"));

    await expect(service.restore("p1", "1", "v001", {})).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("rejects restoring the version that is already current", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [1] });

    await expect(service.restore("p1", "1", "current", { approved: true })).rejects.toMatchObject({ response: { code: "VIDEO_LIBRARY_RESTORE_NOT_ALLOWED" } });
  });

  it("rejects a version that does not exist", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [1] });

    await expect(service.restore("p1", "1", "v001", { approved: true })).rejects.toMatchObject({ response: { code: "VIDEO_LIBRARY_VERSION_NOT_FOUND" } });
  });

  it("archives the displaced current file (never deletes it) and promotes the chosen version to current", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [1] });
    const history = path.join(projectsRoot, "p1", "videos", "history");
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(path.join(history, "scene1_v001.mp4"), Buffer.from("older-version"));

    await service.restore("p1", "1", "v001", { approved: true });

    const currentFile = path.join(projectsRoot, "p1", "videos", "runway", "scene1.mp4");
    expect(await fs.readFile(currentFile, "utf8")).toBe("older-version");
    const versions = await service.versions("p1", "1");
    // The pre-restore current ("scene-1-current") now lives as v002 — nothing was deleted.
    expect(versions.versions.map((item) => item.versionId)).toEqual(["current", "v002", "v001"]);
    const v002 = await service.content("p1", "1", "v002");
    expect(await fs.readFile(v002.path, "utf8")).toBe("scene-1-current");
  });

  it("clears finalVideoPath and reopens VideosApproved when a Completed project's scene is restored", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [1], finalVideo: true, state: WorkflowState.Completed });
    const history = path.join(projectsRoot, "p1", "videos", "history");
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(path.join(history, "scene1_v001.mp4"), Buffer.from("older-version"));

    const result = await service.restore("p1", "1", "v001", { approved: true });

    expect(result.project.finalVideoPath).toBeUndefined();
    expect(result.project.workflowState).toBe(WorkflowState.VideosApproved);
    // The final video's own bytes are untouched — only the project's pointer to it is cleared.
    await expect(fs.readFile(path.join(projectsRoot, "p1", "videos", "final", "instagram_reel.mp4"))).resolves.toBeDefined();
  });

  it("leaves workflowState untouched when restoring a scene on a project with no final video", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [1], finalVideo: false, state: WorkflowState.ReviewingVideos });
    const history = path.join(projectsRoot, "p1", "videos", "history");
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(path.join(history, "scene1_v001.mp4"), Buffer.from("older-version"));

    const result = await service.restore("p1", "1", "v001", { approved: true });

    expect(result.project.workflowState).toBe(WorkflowState.ReviewingVideos);
  });

  it("restores an old final video, archiving the current one first", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [], finalVideo: true });
    const history = path.join(projectsRoot, "p1", "videos", "final", "history");
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(path.join(history, "instagram_reel_v001.mp4"), Buffer.from("older-final"));

    const result = await service.restore("p1", "final", "v001", { approved: true });

    expect(result.project.finalVideoPath).toBe("videos/final/instagram_reel.mp4");
    expect(await fs.readFile(path.join(projectsRoot, "p1", "videos", "final", "instagram_reel.mp4"), "utf8")).toBe("older-final");
    const versions = await service.versions("p1", "final");
    expect(versions.versions.map((item) => item.versionId)).toEqual(["current", "v002", "v001"]);
  });

  it("clears usedAudio on a scene restore, since it invalidates the final video entirely", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [1], finalVideo: true, state: WorkflowState.Completed });
    const project = await projects.findById("p1");
    project.used_audio = { mode: "narration+bgm", track_id: "TRACK-1", attribution_required: true, attribution_text: "Music by Jane Doe" };
    await projects.save(project);
    const history = path.join(projectsRoot, "p1", "videos", "history");
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(path.join(history, "scene1_v001.mp4"), Buffer.from("older-version"));

    await service.restore("p1", "1", "v001", { approved: true });

    expect((await projects.findById("p1")).used_audio).toBeNull();
  });

  it("clears usedAudio on a final-version restore too, since per-version audio was never recorded", async () => {
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [], finalVideo: true });
    const project = await projects.findById("p1");
    project.used_audio = { mode: "silent" };
    await projects.save(project);
    const history = path.join(projectsRoot, "p1", "videos", "final", "history");
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(path.join(history, "instagram_reel_v001.mp4"), Buffer.from("older-final"));

    await service.restore("p1", "final", "v001", { approved: true });

    expect((await projects.findById("p1")).used_audio).toBeNull();
  });

  it("costs nothing — never touches the Runway budget ledger", async () => {
    const { projectsRoot, projects, budget, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "p1", { scenes: [1] });
    const history = path.join(projectsRoot, "p1", "videos", "history");
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(path.join(history, "scene1_v001.mp4"), Buffer.from("older-version"));

    await service.restore("p1", "1", "v001", { approved: true });

    expect(await budget.spentThisMonth()).toBe(0);
  });

  it("does not count a paid run's placeholders as ready videos, while a local fake run still lists", async () => {
    // The third place this same test lived: "larger than zero bytes", which a bare ftyp header satisfies. With
    // six stubs on disk the library would have reported the batch finished and offered it for download — the
    // same false claim the merge screen and the review status were making.
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "stubbed");
    const placeholder = Buffer.from("000000186674797069736F6D0000020069736F6D69736F32617663316D703431", "hex");
    const directory = path.join(projectsRoot, "stubbed", "videos", "runway");
    await Promise.all([1, 2, 3, 4, 5, 6].map((scene) => fs.writeFile(path.join(directory, `scene${scene}.mp4`), placeholder)));

    const paid = await projects.findById("stubbed");
    paid.video_generation_records = [1, 2, 3, 4, 5, 6].map((scene) => ({ scene_number: scene, execution_mode: "runway", status: "succeeded" }));
    await projects.save(paid);
    expect((await service.list()).projects.find((row) => row.projectId === "stubbed")).toBeUndefined();

    // The same files from a run with no provider are that path's real output, and stay listed.
    const fake = await projects.findById("stubbed");
    fake.video_generation_records = [1, 2, 3, 4, 5, 6].map((scene) => ({ scene_number: scene, execution_mode: "local_fake_no_provider", status: "succeeded" }));
    await projects.save(fake);
    expect((await service.list()).projects.find((row) => row.projectId === "stubbed")?.videosReadyCount).toBe(6);
  });
});

describe("VideoLibraryService.list — Episodes", () => {
  it("lists an Episode's results in their own array, not mixed into the short projects", async () => {
    // Its own array on purpose: the Instagram post screen reads `projects` and publishes by short-project id,
    // so an Episode arriving there would be selectable and then unpublishable.
    const { projectsRoot, projects, service } = await setup();
    await createProjectWithVideos(projectsRoot, projects, "short_one");
    await createEpisodeWithVideos(projectsRoot, "story_one", 1, { finalVideo: true });

    const result = await service.list();

    expect(result.projects.map((row) => row.projectId)).toEqual(["short_one"]);
    expect(result.episodes.map((row) => `${row.projectId}/${row.episodeNumber}`)).toEqual(["story_one/1"]);
    expect(result.episodes[0]).toMatchObject({
      title: "episode 1", projectTitle: "story story_one", sceneCount: 6, videosReadyCount: 6,
      finalVideoAvailable: true, aspectRatio: "9:16",
    });
  });

  /**
   * The credit line belongs on the card someone comes back to. Publishing happens days after merging, and the
   * short row has carried these two fields for exactly that reason — an Episode built on a CC BY track was the
   * one kind of card that said nothing, while its own merge screen already knew.
   */
  it("carries the credit line an Episode's track requires, the same as a short project's card", async () => {
    const { projectsRoot, service } = await setup();
    await createEpisodeWithVideos(projectsRoot, "story_credit", 1, {
      finalVideo: true,
      usedAudio: { mode: "bgm", track_id: "t1", attribution_required: true, attribution_text: "Music by ○○○" },
    });

    expect((await service.list()).episodes[0]).toMatchObject({
      attributionRequired: true, attributionText: "Music by ○○○",
    });
  });

  it("says nothing about credit for an Episode that never merged with a track", async () => {
    // Absent, not `false`: "no track was used" and "we did not look" must not read the same, and a card that
    // asserts no credit is required is the one way this field could cause the failure it exists to prevent.
    const { projectsRoot, service } = await setup();
    await createEpisodeWithVideos(projectsRoot, "story_plain", 1, { finalVideo: true });

    const row = (await service.list()).episodes[0]!;
    expect(row.attributionRequired).toBeUndefined();
    expect(row.attributionText).toBeUndefined();
  });

  it("skips an Episode that never reached video generation, so the library stays a results archive", async () => {
    const { projectsRoot, service } = await setup();
    await createEpisodeWithVideos(projectsRoot, "story_two", 1, { scenes: [] });

    expect((await service.list()).episodes).toEqual([]);
  });

  it("does not count a paid Episode's placeholders as ready videos, while a local fake run still lists them", async () => {
    // The sixth place this same judgment lives. A stubbed paid run reporting six ready videos is the report
    // that had the batch looking finished while the downloaded bytes had been thrown away.
    const { projectsRoot, service } = await setup();
    const directory = await createEpisodeWithVideos(projectsRoot, "story_three", 1, { paid: true });
    for (const scene of [1, 2, 3]) await fs.writeFile(path.join(directory, "videos", `scene${scene}.mp4`), PLACEHOLDER_MP4);

    const paidRun = await service.list();
    expect(paidRun.episodes[0]?.videosReadyCount).toBe(3);

    // Same files, fake run: placeholders are its normal output, so all six are listed.
    await fs.writeFile(path.join(directory, "video_generation_records.json"), JSON.stringify(
      [1, 2, 3, 4, 5, 6].map((scene) => ({ scene_number: scene, job_id: "job", status: "succeeded", execution_mode: "local_fake_no_provider" })),
    ));
    expect((await service.list()).episodes[0]?.videosReadyCount).toBe(6);
  });

  it("reports what the Episode actually cost, read from the ledger under its own id", async () => {
    const { projectsRoot, budget, service } = await setup();
    await createEpisodeWithVideos(projectsRoot, "story_four", 2, { paid: true });
    await budget.record("story_four:episode2", 1, "video", true, 0.25);
    await budget.record("story_four:episode2", 2, "video", true, 0.25);
    // A different Episode's spend must not land on this row.
    await budget.record("story_four:episode1", 1, "video", true, 0.25);

    const [row] = (await service.list()).episodes;

    expect(row?.totalActualCostUsd).toBeCloseTo(0.5);
  });

  it("keeps listing the rest when one story's stored files cannot be read", async () => {
    const { projectsRoot, service } = await setup();
    await createEpisodeWithVideos(projectsRoot, "story_good", 1);
    const brokenRoot = path.join(projectsRoot, "story_broken", "long_story");
    await fs.mkdir(brokenRoot, { recursive: true });
    await fs.writeFile(path.join(brokenRoot, "project.json"), "{ not json");

    expect((await service.list()).episodes.map((row) => row.projectId)).toEqual(["story_good"]);
  });
});
