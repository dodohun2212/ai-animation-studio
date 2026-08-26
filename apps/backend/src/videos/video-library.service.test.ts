import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";

import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { RunwayBudget } from "../providers/runway-budget.js";
import { VideoLibraryService } from "./video-library.service.js";

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
});
