import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { EpisodeAssetMappingsService } from "./episode-asset-mappings.service.js";
import { EpisodeContinuityReferenceService } from "./episode-continuity-reference.service.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, platform: "YouTube Shorts" as const, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
const episode = (number: number, file: string) => path.join(root!, "projects", "long", "long_story", `Episode${String(number).padStart(2, "0")}`, file);
async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-continuity-reference-")); const projectsRoot = path.join(root, "projects"); const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings }); const preview = await projects.preview("long"); await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot); const mappings = new EpisodeAssetMappingsService(projectsRoot, new LocalAssetsRepository(root)); const images = new EpisodeImagesService(projectsRoot);
  for (const number of [1, 2]) { await scripts.generate("long", number, {}); await scripts.approve("long", number, { approved: true }); const review = await mappings.begin("long", number, { textOnlyConfirmed: true }); await mappings.approve("long", number, { approved: true, scriptFingerprint: review.review.scriptFingerprint }); }
  return { images, reference: new EpisodeContinuityReferenceService(projectsRoot) };
}
async function approveFirstEpisode(images: EpisodeImagesService) { await images.generate("long", 1, { approved: true }); for (const scene of [1, 2, 3, 4, 5, 6] as const) await images.approve("long", 1, String(scene), { approved: true }); }
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("EpisodeContinuityReferenceService", () => {
  it("reports null for Episode 1, then unavailable until the previous Episode has six approved valid images", async () => {
    const { images, reference } = await setup();
    await expect(reference.get("long", 1)).resolves.toEqual({ reference: null });
    await expect(reference.get("long", 2)).resolves.toEqual({ reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: false } });
    await approveFirstEpisode(images);
    await expect(reference.get("long", 2)).resolves.toEqual({ reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: true } });
    await fs.writeFile(episode(1, "images/scene6.png"), "not-an-image");
    await expect(reference.get("long", 2)).resolves.toEqual({ reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: false } });
  });

  it("treats malformed previous storage as unavailable and never returns a storage path", async () => {
    const { reference } = await setup(); await fs.writeFile(episode(1, "project.json"), "{ malformed");
    const result = await reference.get("long", 2);
    expect(result.reference).toMatchObject({ available: false, sourceSceneNumber: 6 });
    expect(JSON.stringify(result)).not.toContain(root!);
    await expect(reference.get("../long", 2)).rejects.toMatchObject({ response: { code: "UNSAFE_PROJECT_ID" } });
  });

  it("stores a safe continuity metadata entry only for Episode 2 Scene 1", async () => {
    const { images } = await setup(); await approveFirstEpisode(images);
    await images.generate("long", 2, { approved: true });
    const metadata = JSON.parse(await fs.readFile(episode(2, "image_generation_metadata.json"), "utf8"));
    expect(metadata).toEqual([{ scene_number: 1, continuity_reference: { previous_episode_number: 1, source_scene_number: 6, available: true } }]);
    await expect(fs.access(episode(1, "image_generation_metadata.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.stringify(metadata)).not.toContain(root!);
  });

  it("reports the previous Episode's own scene count as sourceSceneNumber, not a hardcoded 6", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-continuity-reference-scenecount-"));
    const projectsRoot = path.join(root, "projects"); const projects = new LongProjectsService(projectsRoot);
    await projects.create({ projectId: "long", settings: { ...settings, sceneCount: 4 } });
    const preview = await projects.preview("long"); await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
    const scripts = new EpisodeScriptsService(projectsRoot); const mappings = new EpisodeAssetMappingsService(projectsRoot, new LocalAssetsRepository(root)); const images = new EpisodeImagesService(projectsRoot); const reference = new EpisodeContinuityReferenceService(projectsRoot);

    await scripts.generate("long", 1, {}); await scripts.approve("long", 1, { approved: true });
    const review1 = await mappings.begin("long", 1, { textOnlyConfirmed: true }); await mappings.approve("long", 1, { approved: true, scriptFingerprint: review1.review.scriptFingerprint });

    // Bump the project's own scene count before Episode 2 is ever created, so Episode 2 snapshots 8 while
    // Episode 1 keeps its already-snapshotted 4 — sourceSceneNumber must reflect Episode 1's own count.
    await projects.updateSettings("long", { settings: { ...settings, sceneCount: 8 } });
    await scripts.generate("long", 2, {}); await scripts.approve("long", 2, { approved: true });
    const review2 = await mappings.begin("long", 2, { textOnlyConfirmed: true }); await mappings.approve("long", 2, { approved: true, scriptFingerprint: review2.review.scriptFingerprint });

    await images.generate("long", 1, { approved: true });
    for (const scene of [1, 2, 3, 4]) await images.approve("long", 1, String(scene), { approved: true });

    await expect(reference.get("long", 2)).resolves.toEqual({ reference: { previousEpisodeNumber: 1, sourceSceneNumber: 4, available: true } });
  });
});
