import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { EpisodeAssetMappingsService } from "./episode-asset-mappings.service.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { EpisodeVideoMergeService } from "./episode-video-merge.service.js";
import { EpisodeVideosService } from "./episode-videos.service.js";
import { LongProjectsService } from "./long-projects.service.js";
import { OrphanedEpisodeGenerationRecoveryService } from "./orphaned-episode-generation-recovery.service.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 3, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

async function episodeFile(projectsRoot: string, projectId: string, episodeNumber: number): Promise<string> {
  return path.join(projectsRoot, projectId, "long_story", `Episode${String(episodeNumber).padStart(2, "0")}`, "project.json");
}
async function outlinesFile(projectsRoot: string, projectId: string): Promise<string> {
  return path.join(projectsRoot, projectId, "long_story", "episode_outlines.json");
}
/** Directly overwrites just the on-disk status, in both files that must agree — the same "hand-construct the crashed state" approach the short-project recovery test uses (createStoredProject + a direct workflow_state override), since a real local-fake generation loop runs start-to-finish inside one awaited call and never actually leaves a test able to observe it mid-flight. */
async function forceEpisodeStatus(projectsRoot: string, projectId: string, episodeNumber: number, state: string): Promise<void> {
  const episodePath = await episodeFile(projectsRoot, projectId, episodeNumber);
  const episode = JSON.parse(await fs.readFile(episodePath, "utf8")) as Record<string, unknown>;
  episode.state = state;
  await fs.writeFile(episodePath, JSON.stringify(episode, null, 2), "utf8");
  const outlinesPath = await outlinesFile(projectsRoot, projectId);
  const outlines = JSON.parse(await fs.readFile(outlinesPath, "utf8")) as Record<string, unknown>[];
  outlines[episodeNumber - 1]!.status = state;
  await fs.writeFile(outlinesPath, JSON.stringify(outlines, null, 2), "utf8");
}
async function readEpisodeState(projectsRoot: string, projectId: string, episodeNumber: number): Promise<{ state: unknown; outlineStatus: unknown; errors: unknown }> {
  const episode = JSON.parse(await fs.readFile(await episodeFile(projectsRoot, projectId, episodeNumber), "utf8")) as Record<string, unknown>;
  const outlines = JSON.parse(await fs.readFile(await outlinesFile(projectsRoot, projectId), "utf8")) as Record<string, unknown>[];
  return { state: episode.state, outlineStatus: outlines[episodeNumber - 1]!.status, errors: episode.errors };
}

/** Advances one Episode through script + asset-mapping approval — the common prefix every generating state needs. */
async function toAssetMappingApproved(projectsRoot: string, episodeNumber: number): Promise<void> {
  const scripts = new EpisodeScriptsService(projectsRoot);
  await scripts.generate("long", episodeNumber, {});
  await scripts.approve("long", episodeNumber, { approved: true });
  const mappings = new EpisodeAssetMappingsService(projectsRoot, new LocalAssetsRepository(path.dirname(projectsRoot)));
  const mapping = await mappings.begin("long", episodeNumber, { textOnlyConfirmed: true });
  await mappings.approve("long", episodeNumber, { approved: true, scriptFingerprint: mapping.review.scriptFingerprint });
}
async function toWaitingForVideoConfirmation(projectsRoot: string, episodeNumber: number): Promise<void> {
  const images = new EpisodeImagesService(projectsRoot);
  await images.generate("long", episodeNumber, { approved: true });
  for (const number of [1, 2, 3, 4, 5, 6] as const) await images.approve("long", episodeNumber, String(number), { approved: true });
}
async function toVideosApproved(projectsRoot: string, episodeNumber: number): Promise<void> {
  const videos = new EpisodeVideosService(projectsRoot);
  const preview = await videos.preview("long", episodeNumber);
  const started = await videos.start("long", episodeNumber, { approved: true, confirmationId: preview.confirmationId, userRequestId: `request_${episodeNumber}`, prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });
  await videos.run("long", episodeNumber, started.jobId);
  for (const number of [1, 2, 3, 4, 5, 6] as const) await videos.approve("long", episodeNumber, started.jobId, String(number), { approved: true });
}

async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "orphan-episode-recovery-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings });
  const outline = await projects.preview("long");
  await projects.approve("long", { approved: true, prompt: outline.preview.prompt, promptSha256: outline.preview.promptSha256 });
  return { projectsRoot, service: new OrphanedEpisodeGenerationRecoveryService(projectsRoot) };
}

describe("OrphanedEpisodeGenerationRecoveryService", () => {
  it("reverts every orphaned Episode generating state to the state its own service already treats as the retry point, preserving already-generated results", async () => {
    const { projectsRoot, service } = await setup();

    // Episode 1: crashed mid image generation.
    await toAssetMappingApproved(projectsRoot, 1);
    await forceEpisodeStatus(projectsRoot, "long", 1, "generating_images");

    // Episode 2: crashed after submitting video generation but before the run loop produced anything — a real,
    // naturally reachable on-disk shape (start() persists videos_generating without run() ever being called).
    await toAssetMappingApproved(projectsRoot, 2);
    await toWaitingForVideoConfirmation(projectsRoot, 2);
    const videos = new EpisodeVideosService(projectsRoot);
    const preview2 = await videos.preview("long", 2);
    await videos.start("long", 2, { approved: true, confirmationId: preview2.confirmationId, userRequestId: "request_2", prompts: preview2.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })) });

    // Episode 3: crashed mid final render.
    await toAssetMappingApproved(projectsRoot, 3);
    await toWaitingForVideoConfirmation(projectsRoot, 3);
    await toVideosApproved(projectsRoot, 3);
    await forceEpisodeStatus(projectsRoot, "long", 3, "rendering");

    const recovered = await service.recoverAll();

    expect(recovered).toBe(3);
    const one = await readEpisodeState(projectsRoot, "long", 1);
    expect(one).toMatchObject({ state: "asset_mapping_approved", outlineStatus: "asset_mapping_approved" });
    const two = await readEpisodeState(projectsRoot, "long", 2);
    expect(two).toMatchObject({ state: "interrupted", outlineStatus: "interrupted" });
    const three = await readEpisodeState(projectsRoot, "long", 3);
    expect(three).toMatchObject({ state: "failed", outlineStatus: "failed" });
    expect(three.errors).toEqual(["Backend process exited while rendering. Recovered to a retryable state on restart."]);

    // Episode 3's fully-approved videos are untouched by the recovery pass.
    for (const number of [1, 2, 3, 4, 5, 6]) {
      await expect(fs.access(path.join(projectsRoot, "long", "long_story", "Episode03", "videos", `scene${number}.mp4`))).resolves.toBeUndefined();
    }
  });

  it("leaves Episodes outside a generating state untouched", async () => {
    const { projectsRoot, service } = await setup();
    await toAssetMappingApproved(projectsRoot, 1); // asset_mapping_approved — not a generating state.

    const recovered = await service.recoverAll();

    expect(recovered).toBe(0);
    expect((await readEpisodeState(projectsRoot, "long", 1)).state).toBe("asset_mapping_approved");
  });

  it("is idempotent — a second recovery pass finds nothing left to recover", async () => {
    const { projectsRoot, service } = await setup();
    await toAssetMappingApproved(projectsRoot, 1);
    await forceEpisodeStatus(projectsRoot, "long", 1, "generating_images");

    await service.recoverAll();
    const second = await service.recoverAll();

    expect(second).toBe(0);
  });

  it("leaves an Episode alone when the outline summary and its own detail file disagree, rather than guessing which is stale", async () => {
    const { projectsRoot, service } = await setup();
    await toAssetMappingApproved(projectsRoot, 1);
    // Only the outline summary claims "generating_images" — the Episode's own detail file still says
    // asset_mapping_approved, as if a previous partial write (or a hand-edited file) desynced the two.
    const outlinesPath = await outlinesFile(projectsRoot, "long");
    const outlines = JSON.parse(await fs.readFile(outlinesPath, "utf8")) as Record<string, unknown>[];
    outlines[0]!.status = "generating_images";
    await fs.writeFile(outlinesPath, JSON.stringify(outlines, null, 2), "utf8");

    const recovered = await service.recoverAll();

    expect(recovered).toBe(0);
    expect((await readEpisodeState(projectsRoot, "long", 1)).state).toBe("asset_mapping_approved");
  });

  it("skips a directory with no Long Project data without throwing", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "orphan-episode-recovery-mixed-"));
    const projectsRoot = path.join(root, "projects");
    await fs.mkdir(path.join(projectsRoot, "short_project"), { recursive: true });
    await fs.writeFile(path.join(projectsRoot, "short_project", "project.json"), JSON.stringify({ project_id: "short_project" }), "utf8");
    const service = new OrphanedEpisodeGenerationRecoveryService(projectsRoot);

    await expect(service.recoverAll()).resolves.toBe(0);
  });

  it("returns 0 without throwing when the projects directory does not exist yet", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "orphan-episode-recovery-empty-"));
    const service = new OrphanedEpisodeGenerationRecoveryService(path.join(root, "projects"));

    await expect(service.recoverAll()).resolves.toBe(0);
  });
});
