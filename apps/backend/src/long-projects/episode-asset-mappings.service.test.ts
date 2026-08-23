import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { EpisodeAssetMappingsService } from "./episode-asset-mappings.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, episodeDurationSeconds: 30, platform: "YouTube Shorts" as const, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "" };
const digest = "a".repeat(64);
async function setup(withAsset = false) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-mapping-")); const projectsRoot = path.join(root, "projects"); const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings }); const preview = await projects.preview("long"); await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot); await scripts.generate("long", 1, {}); await scripts.approve("long", 1, { approved: true });
  if (withAsset) {
    await fs.mkdir(path.join(root, "asset_library"), { recursive: true });
    await fs.writeFile(path.join(root, "asset_library", "assets.json"), JSON.stringify([{ asset_id: "ASSET-CHAR-1", asset_type: "character", display_name: "Hero", description: "", stored_path: "hero.png", original_filename: "hero.png", content_sha256: digest, tags: [], aliases: [], enabled: true, approved: true, face_baseline: false, character_key: null, version: 1, versions: [{ version: 1, stored_path: "hero.png", content_sha256: digest, created_at: new Date().toISOString(), notes: "" }], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), notes: "", legacy_asset_ids: [], status: "manual", source_project_id: "", source_scene_number: null, reference_images: [{ role: "thumbnail", path: "hero.png", content_sha256: digest, original_filename: "hero.png" }, { role: "front", path: "hero.png", content_sha256: digest, original_filename: "hero.png" }], reference_roles: ["thumbnail", "front"], is_folder: false, parent_folder_id: "", child_asset_ids: [], thumbnail_asset_id: "", role: "", sort_order: 0 }]), "utf8");
    const biblePath = path.join(projectsRoot, "long", "long_story", "story_bible.json"); const bible = JSON.parse(await fs.readFile(biblePath, "utf8")); bible.characters.push({ character_id: "CHAR-1", name: "Hero", asset_link: { asset_id: "ASSET-CHAR-1", version_policy: "pinned_version", pinned_version: 1, episode_scope: { mode: "episode", episode: 1 } } }); await fs.writeFile(biblePath, JSON.stringify(bible), "utf8");
  }
  return new EpisodeAssetMappingsService(projectsRoot, new LocalAssetsRepository(root));
}
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("EpisodeAssetMappingsService", () => {
  it("collects in-scope Bible Assets, requires confirmation, and persists an approved review", async () => {
    const subject = await setup(true); const started = await subject.begin("long", 1, {});
    expect(started.review).toMatchObject({ status: "waiting", scriptRevision: 1, candidates: [{ assetId: "ASSET-CHAR-1", usageRole: "character", status: "suggested", userConfirmed: false }] });
    await expect(subject.approve("long", 1, { approved: true, scriptFingerprint: started.review.scriptFingerprint })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_MAPPING_UNCONFIRMED" } });
    const candidate = started.review.candidates[0]!; const updated = await subject.update("long", 1, candidate.mappingId, { decision: "confirm" });
    const approved = await subject.approve("long", 1, { approved: true, scriptFingerprint: updated.review.scriptFingerprint });
    expect(approved).toMatchObject({ review: { status: "approved" }, episode: { status: "asset_mapping_approved" } });
    await expect(fs.access(path.join(root!, "projects", "long", "long_story", "Episode01", "asset_mappings.json"))).resolves.toBeUndefined();
    expect((await new EpisodeAssetMappingsService(path.join(root!, "projects"), new LocalAssetsRepository(root!)).get("long", 1)).review.status).toBe("approved");
  });

  it("requires explicit text-only confirmation with no candidates and rejects stale scripts", async () => {
    const subject = await setup(); expect((await subject.get("long", 1)).review).toMatchObject({ mappingRevision: 0, scriptRevision: 0, candidates: [] }); const started = await subject.begin("long", 1, {});
    await expect(subject.approve("long", 1, { approved: true, scriptFingerprint: started.review.scriptFingerprint })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_MAPPING_UNCONFIRMED" } });
    const episodePath = path.join(root!, "projects", "long", "long_story", "Episode01", "project.json"); const episode = JSON.parse(await fs.readFile(episodePath, "utf8")); episode.script.scenes[0].description = "changed without refreshing review"; await fs.writeFile(episodePath, JSON.stringify(episode), "utf8");
    await expect(subject.approve("long", 1, { approved: true, scriptFingerprint: started.review.scriptFingerprint })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_MAPPING_STALE" } });
    const clean = await setup(); const textOnly = await clean.begin("long", 1, { textOnlyConfirmed: true });
    await expect(clean.approve("long", 1, { approved: true, scriptFingerprint: textOnly.review.scriptFingerprint })).resolves.toMatchObject({ episode: { status: "asset_mapping_approved" } });
  });

  it("previews deterministic per-scene automatic selections and reruns them only in mapping review states", async () => {
    const subject = await setup(true); const assetPath = path.join(root!, "asset_library", "assets.json"); const assets = JSON.parse(await fs.readFile(assetPath, "utf8")); assets[0].display_name = "Nia"; await fs.writeFile(assetPath, JSON.stringify(assets), "utf8"); const episodePath = path.join(root!, "projects", "long", "long_story", "Episode01", "project.json"); const episode = JSON.parse(await fs.readFile(episodePath, "utf8"));
    episode.script.scenes[0].description = "Nia enters the room"; await fs.writeFile(episodePath, JSON.stringify(episode), "utf8");
    const started = await subject.begin("long", 1, {}); const summary = await subject.automaticReferenceSummary("long", 1);
    expect(summary.summary).toEqual(expect.objectContaining({ candidateAssetIds: ["ASSET-CHAR-1"], selectedAssetIdsByScene: expect.objectContaining({ 1: ["ASSET-CHAR-1"], 2: [] }), estimatedImageApiCalls: 6 }));
    const confirmed = await subject.update("long", 1, started.review.candidates[0]!.mappingId, { decision: "confirm" }); await subject.approve("long", 1, { approved: true, scriptFingerprint: confirmed.review.scriptFingerprint });
    const rerun = await subject.rerun("long", 1);
    expect(rerun).toMatchObject({ review: { status: "waiting", mappingRevision: expect.any(Number) }, episode: { status: "waiting_for_asset_mapping_review" } });
    expect(rerun.review.mappingRevision).toBeGreaterThan(confirmed.review.mappingRevision);
  });

  it("does not import or call providers, network, or FFmpeg", async () => {
    const source = await fs.readFile(path.join(process.cwd(), "src", "long-projects", "episode-asset-mappings.service.ts"), "utf8");
    expect(source).not.toMatch(/openai|runway|ffmpeg|child_process|fetch\s*\(/i);
  });
});
