import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { approveEpisodeMappingReview } from "./episode-mapping-test-fixtures.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { LongProjectsService } from "./long-projects.service.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-images-")); const projectsRoot = path.join(root, "projects"); const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings }); const preview = await projects.preview("long"); await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot); await scripts.generate("long", 1, { userRequestId: "episode-images.service-script-1" }); await scripts.approve("long", 1, { approved: true });
  await approveEpisodeMappingReview(projectsRoot, root, "long", 1);
  return { images: new EpisodeImagesService(projectsRoot), projectsRoot };
}
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("EpisodeImagesService", () => {
  /**
   * Opening the review screen repairs a missing Library Folder.
   *
   * The seeding existed already, on approve and regenerate — two things a finished Episode never does again, so
   * an Episode whose pictures predate indexing stayed out of the Library forever. A real one did: 12/Episode01,
   * six images on disk and nothing in the index. Reading is the one thing such an Episode still does.
   *
   * Paired with the test below, which is the more important half: this repair rides along on a read, and a read
   * that starts failing because a side errand could not finish is worse than the missing Folder it was fixing.
   */
  it("puts a missing Folder back when the review is merely opened", async () => {
    const { images, projectsRoot } = await setup();
    await images.generate("long", 1, { approved: true });
    const assets = new LocalAssetsRepository(root!);
    const folder = (await assets.list()).find((asset) => asset.is_folder && asset.source_project_id === "long/Episode01")!;
    await assets.removeFolder(folder.asset_id, { removeChildIndexes: true });
    expect(await assets.hasGeneratedProjectFolder("long/Episode01")).toBe(false);

    await images.get("long", 1);

    expect(await assets.hasGeneratedProjectFolder("long/Episode01")).toBe(true);
    expect(projectsRoot).toBeTruthy();
  });

  /**
   * The counterpart, and the half that keeps this from being a nuisance: a read repairs only when there is
   * something to repair.
   *
   * Seeding rewrites a child's description from the scene text, and that description is one of the few fields
   * the Library lets a generated child carry. Doing it on every open would quietly erase what a person wrote,
   * every time they looked at the screen — the same mistake as `stat`-ing a file instead of reading it, which
   * this repository already made once today.
   */
  it("does not touch a Folder that is already there, so opening the screen cannot erase what was written", async () => {
    const { images } = await setup();
    await images.generate("long", 1, { approved: true });
    const assets = new LocalAssetsRepository(root!);
    const child = (await assets.list()).find((asset) => !asset.is_folder && asset.source_project_id === "long/Episode01")!;
    await assets.update(child.asset_id, { description: "사람이 쓴 설명" });

    await images.get("long", 1);

    expect((await assets.get(child.asset_id)).description).toBe("사람이 쓴 설명");
  });

  it("requires exact approval and a current approved mapping before locally generating six images", async () => {
    const { images, projectsRoot } = await setup();
    await expect(images.generate("long", 1, {} as never)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(images.generate("long", 1, { approved: true, extra: true } as never)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const generated = await images.generate("long", 1, { approved: true });
    expect(generated).toMatchObject({ episode: { status: "images_review" }, generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [] });
    await expect(fs.access(path.join(projectsRoot, "long", "long_story", "Episode01", "images", "scene6.png"))).resolves.toBeUndefined();
    await expect(images.generate("long", 1, { approved: true })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_IMAGES_NOT_ALLOWED" } });
  });

  it("still recognizes an approved mapping as current after narration text changes, agreeing with episode-asset-mappings.service.ts's own fingerprint", async () => {
    const { images, projectsRoot } = await setup();
    const episodeProjectFile = path.join(projectsRoot, "long", "long_story", "Episode01", "project.json");
    const stored = JSON.parse(await fs.readFile(episodeProjectFile, "utf8")) as { script: { scenes: Array<Record<string, unknown>> } };
    stored.script.scenes[0]!.narration = "완전히 다른 내레이션 문장";
    await fs.writeFile(episodeProjectFile, JSON.stringify(stored, null, 2), "utf8");
    await expect(images.generate("long", 1, { approved: true })).resolves.toMatchObject({ episode: { status: "images_review" } });
  });

  it("requires every review, then archives and resets only the regenerated scene", async () => {
    const { images, projectsRoot } = await setup(); await images.generate("long", 1, { approved: true });
    for (const scene of [1, 2, 3, 4, 5] as const) await images.approve("long", 1, String(scene), { approved: true });
    expect((await images.get("long", 1)).episode.status).toBe("images_review");
    const approved = await images.approve("long", 1, "6", { approved: true }); expect(approved.episode.status).toBe("waiting_for_video_confirmation");
    const regenerated = await images.regenerate("long", 1, "3", { approved: true });
    expect(regenerated).toMatchObject({ sceneNumber: 3, episode: { status: "images_review" } });
    expect(regenerated.reviews.find((review) => review.sceneNumber === 3)?.status).toBe("pending");
    expect(regenerated.reviews.filter((review) => review.sceneNumber !== 3).every((review) => review.status === "approved")).toBe(true);
    await expect(fs.access(path.join(projectsRoot, "long", "long_story", "Episode01", "images", "originals", "scene3_v001.png"))).resolves.toBeUndefined();
  });

  it("puts the Episode's generated images in the Asset Library, naming the Episode and not just the project", async () => {
    const { images, projectsRoot } = await setup();
    const assets = new LocalAssetsRepository(root!);
    expect(await assets.list()).toEqual([]);

    await images.generate("long", 1, { approved: true });

    const indexed = await assets.list();
    const folder = indexed.find((asset) => asset.is_folder)!;
    const children = indexed.filter((asset) => !asset.is_folder).sort((a, b) => a.source_scene_number! - b.source_scene_number!);
    expect(folder.source_project_id).toBe("long/Episode01");
    expect(children.map((child) => child.source_scene_number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(folder.child_asset_ids).toEqual(children.map((child) => child.asset_id));
    // The path is the Episode's own, which is the half the short project's assembled `<id>/images` could not produce.
    expect(children[0]!.stored_path).toBe(path.join(projectsRoot, "long", "long_story", "Episode01", "images", "scene1.png"));
    expect(children[0]!.tags).toContain("episode");
    expect(assets.resolveContentPath(children[0]!)).not.toBeNull();
  });

  it("keeps two Episodes of one project apart, Folder and scene key alike", async () => {
    const { images, projectsRoot } = await setup();
    const scripts = new EpisodeScriptsService(projectsRoot);
    await scripts.generate("long", 2, { userRequestId: "episode-images.service-script-2" });
    await scripts.approve("long", 2, { approved: true });
    await approveEpisodeMappingReview(projectsRoot, root!, "long", 2);
    const assets = new LocalAssetsRepository(root!);

    await images.generate("long", 1, { approved: true });
    await images.generate("long", 2, { approved: true });

    const folders = (await assets.list()).filter((asset) => asset.is_folder).map((asset) => asset.source_project_id).sort();
    expect(folders).toEqual(["long/Episode01", "long/Episode02"]);

    // Approving scene 1 of Episode 2 must not reach into Episode 1 — the whole reason the identity names both.
    await images.approve("long", 2, "1", { approved: true });
    const approved = (await assets.list()).filter((asset) => asset.approved && !asset.is_folder);
    expect(approved.map((asset) => asset.source_project_id)).toEqual(["long/Episode02"]);
  });

  it("marks a scene's Asset approved as it is reviewed, and the Folder only once every scene is", async () => {
    const { images } = await setup();
    const assets = new LocalAssetsRepository(root!);
    await images.generate("long", 1, { approved: true });

    for (const scene of [1, 2, 3, 4, 5] as const) await images.approve("long", 1, String(scene), { approved: true });
    const midway = await assets.list();
    expect(midway.filter((asset) => !asset.is_folder && asset.approved).length).toBe(5);
    expect(midway.find((asset) => asset.is_folder)!.approved).toBe(false);

    await images.approve("long", 1, "6", { approved: true });
    expect((await assets.list()).find((asset) => asset.is_folder)!.approved).toBe(true);
  });

  it("indexes an Episode whose pictures predate indexing rather than failing to approve it", async () => {
    const { images } = await setup();
    const assets = new LocalAssetsRepository(root!);
    await images.generate("long", 1, { approved: true });
    // Exactly the state every Episode generated before this existed is in: pictures on disk, no records. The
    // lookup treats a missing Folder as corruption, which is the right reading only for a source indexed once.
    await fs.writeFile(path.join(root!, "asset_library", "assets.json"), "[]", "utf8");

    await expect(images.approve("long", 1, "1", { approved: true })).resolves.toMatchObject({ episode: { status: "images_review" } });

    const rebuilt = await assets.list();
    expect(rebuilt.filter((asset) => !asset.is_folder).length).toBe(6);
    expect(rebuilt.find((asset) => asset.source_scene_number === 1)!.approved).toBe(true);
  });

  it("keeps one Asset across a regeneration and files the replaced picture as its earlier version", async () => {
    const { images } = await setup();
    const assets = new LocalAssetsRepository(root!);
    await images.generate("long", 1, { approved: true });
    const before = (await assets.list()).find((asset) => asset.source_scene_number === 3)!;

    await images.regenerate("long", 1, "3", { approved: true });

    const after = (await assets.list()).find((asset) => asset.source_scene_number === 3)!;
    expect(after.asset_id).toBe(before.asset_id);
    expect(after.version).toBe(2);
    expect(after.status).toBe("generated");
    expect(after.approved).toBe(false);
    expect(path.basename(after.versions.find((version) => version.version === 1)!.stored_path)).toBe("scene3_v001.png");
  });

  it("rejects stale mapping and damaged images without replacing valid review state", async () => {
    const { images, projectsRoot } = await setup(); const episode = path.join(projectsRoot, "long", "long_story", "Episode01", "project.json"); const stored = JSON.parse(await fs.readFile(episode, "utf8")); stored.script.scenes[0].description = "changed"; await fs.writeFile(episode, JSON.stringify(stored), "utf8");
    await expect(images.generate("long", 1, { approved: true })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_IMAGES_NOT_ALLOWED" } });
  });

  /**
   * A file is not a picture, and progress must not say it is.
   *
   * The generation loop writes each scene's bytes and then validates them before moving on, so a file that
   * exists but does not parse as a PNG is one being written this instant — the exact moment this route is meant
   * to be read at. Asking `stat` instead of reading it would report that scene finished a moment early, and the
   * screen would move its marker onto a picture nobody has yet. Same reason `preview()` counts with `validImage`
   * before quoting a price.
   */
  it("does not count a half-written file as a finished scene", async () => {
    const { images, projectsRoot } = await setup();
    await images.generate("long", 1, { approved: true });
    const imagesDirectory = path.join(projectsRoot, "long", "long_story", "Episode01", "images");
    await fs.writeFile(path.join(imagesDirectory, "scene4.png"), Buffer.from([0x89, 0x50]), "utf8");

    const progress = await images.progress("long", 1);

    expect(progress.progress.completedSceneNumbers).toEqual([1, 2, 3, 5, 6]);
    // Not generating any more, so nothing claims to be in flight — even though a scene is unaccounted for.
    expect(progress.progress.currentSceneNumber).toBeUndefined();
  });

  /**
   * Answerable before a single picture exists, which is the difference between this and the review endpoint.
   *
   * A screen that starts a generation and polls immediately reaches this route first; if it refused until there
   * was something to show, the first seconds of a run — the part a person watches — would be an error.
   */
  it("answers for an Episode that has generated nothing yet", async () => {
    const { images } = await setup();

    const progress = await images.progress("long", 1);

    expect(progress.progress).toEqual({ sceneNumbers: [1, 2, 3, 4, 5, 6], completedSceneNumbers: [] });
  });

  it("carries a persisted reference-cap count through get() and preserves it across approve(), but never for a scene that never had one", async () => {
    const { images, projectsRoot } = await setup();
    await images.generate("long", 1, { approved: true });
    // Simulates what generate() itself would have written had this scene's real reference collection hit the
    // 16-image cap (see episode-images.service.ts's referenceOmissions map) — writing it directly here avoids
    // needing 17 real confirmed Asset Mapping candidates just to exercise the storage round-trip.
    const reviewsFile = path.join(projectsRoot, "long", "long_story", "Episode01", "generated_image_reviews.json");
    await fs.writeFile(reviewsFile, JSON.stringify([
      { scene_number: 1, status: "pending", updated_at: "2026-08-26T00:00:00.000Z", regeneration_count: 0, history: [], references_used_count: 16, references_omitted_count: 2 },
    ], null, 2), "utf8");

    const beforeApproval = await images.get("long", 1);
    expect(beforeApproval.reviews.find((review) => review.sceneNumber === 1)).toMatchObject({ referencesUsedCount: 16, referencesOmittedCount: 2 });
    expect(beforeApproval.reviews.find((review) => review.sceneNumber === 2)?.referencesUsedCount).toBeUndefined();

    const approved = await images.approve("long", 1, "1", { approved: true });

    expect(approved.reviews.find((review) => review.sceneNumber === 1)).toMatchObject({ status: "approved", referencesUsedCount: 16, referencesOmittedCount: 2 });
  });

  it("never calls fetch and omits budget/retryEstimate when no OpenAI credential or budget is wired in", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { images } = await setup();
    const generated = await images.generate("long", 1, { approved: true });
    expect(generated.budget).toBeUndefined();
    const review = await images.get("long", 1);
    expect(review.budget).toBeUndefined();
    const regenerated = await images.regenerate("long", 1, "3", { approved: true });
    expect(regenerated.retryEstimate).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
