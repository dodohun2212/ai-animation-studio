import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { approveEpisodeMappingReview } from "./episode-mapping-test-fixtures.js";
import { EpisodeContinuityReferenceService } from "./episode-continuity-reference.service.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
const episode = (number: number, file: string) => path.join(root!, "projects", "long", "long_story", `Episode${String(number).padStart(2, "0")}`, file);
async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-continuity-reference-")); const projectsRoot = path.join(root, "projects"); const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings }); const preview = await projects.preview("long"); await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot); const images = new EpisodeImagesService(projectsRoot);
  for (const number of [1, 2]) { await scripts.generate("long", number, { userRequestId: "episode-continuity-reference.service-script-1" }); await scripts.approve("long", number, { approved: true }); await approveEpisodeMappingReview(projectsRoot, root, "long", number); }
  return { images, reference: new EpisodeContinuityReferenceService(projectsRoot) };
}
async function approveFirstEpisode(images: EpisodeImagesService) { await images.generate("long", 1, { approved: true }); for (const scene of [1, 2, 3, 4, 5, 6] as const) await images.approve("long", 1, String(scene), { approved: true }); }
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("EpisodeContinuityReferenceService", () => {
  it("reports null for Episode 1, then unavailable until the previous Episode has six approved valid images", async () => {
    const { images, reference } = await setup();
    await expect(reference.get("long", 1)).resolves.toEqual({ reference: null });
    await expect(reference.get("long", 2)).resolves.toEqual({ reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: false, unavailableReason: "not_finished" } });
    await approveFirstEpisode(images);
    await expect(reference.get("long", 2)).resolves.toEqual({ reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: true } });
    await fs.writeFile(episode(1, "images/scene6.png"), "not-an-image");
    // Every scene approved and the file unreadable is not "not finished yet": the record and the disk disagree.
    await expect(reference.get("long", 2)).resolves.toEqual({ reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: false, unavailableReason: "image_unreadable" } });
  });

  /**
   * The state an Episode ends its life in is the one this refused to carry forward.
   *
   * The list this replaced named six states and stopped at videos_approved, so an Episode that went on to render
   * and complete — every scene approved, final image on disk, nothing left to do — reported no reference at all.
   * 캡틴D's project 12 had three consecutive Episodes sitting exactly there, and every following Episode's
   * pictures were bought with nothing carried over from the one before. The more finished the Episode, the less
   * usable it was.
   *
   * Runs the real states an Episode reaches after its images: rendering and completed are the two the old list
   * forgot, and interrupted and failed are the two nobody would think to add — all four have their pictures.
   */
  it("carries the reference forward from an Episode that has gone on to render, complete, or fail", async () => {
    const { images, reference } = await setup();
    await approveFirstEpisode(images);
    const file = episode(1, "project.json");

    for (const state of ["waiting_for_video_confirmation", "videos_approved", "rendering", "completed", "interrupted", "failed"] as const) {
      const stored = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
      await fs.writeFile(file, JSON.stringify({ ...stored, state }, null, 2), "utf8");
      await expect(reference.get("long", 2)).resolves.toEqual({ reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: true } });
    }
  });

  /**
   * The other half: having reached a late state is not what makes a reference: the pictures do.
   *
   * Widening the gate would be worth nothing if it started answering `available: true` for an Episode whose
   * scenes are not all approved — the screen would promise a hand-off the generator then cannot make.
   */
  it("still refuses an Episode whose scenes are not all approved, however finished its state claims to be", async () => {
    const { images, reference } = await setup();
    await images.generate("long", 1, { approved: true });
    for (const scene of [1, 2, 3, 4, 5] as const) await images.approve("long", 1, String(scene), { approved: true });
    const file = episode(1, "project.json");
    const stored = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    await fs.writeFile(file, JSON.stringify({ ...stored, state: "completed" }, null, 2), "utf8");

    await expect(reference.get("long", 2)).resolves.toEqual({ reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: false, unavailableReason: "not_finished" } });
  });

  /**
   * "There is nothing to carry" and "I could not find out" stop being the same sentence.
   *
   * One catch used to hold every failure in this lookup, so unreadable storage came back as the same
   * `available: false` that a genuinely unfinished Episode does — and the screen turned that into *이전
   * 에피소드의 마지막 장면 자료가 아직 없어서…*, a reason nobody had checked. It still does not throw: this
   * screen is entitled to open when the Episode before it cannot be read. It just no longer claims to know why.
   */
  it("says it could not read the previous Episode rather than calling it unfinished", async () => {
    const { images, reference } = await setup();
    await approveFirstEpisode(images);
    await expect(reference.get("long", 2)).resolves.toMatchObject({ reference: { available: true } });

    await fs.writeFile(episode(1, "project.json"), "{ malformed");

    await expect(reference.get("long", 2)).resolves.toEqual({ reference: { previousEpisodeNumber: 1, sourceSceneNumber: 6, available: false, unavailableReason: "unreadable" } });
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
    const scripts = new EpisodeScriptsService(projectsRoot); const images = new EpisodeImagesService(projectsRoot); const reference = new EpisodeContinuityReferenceService(projectsRoot);

    await scripts.generate("long", 1, { userRequestId: "episode-continuity-reference.service-script-2" }); await scripts.approve("long", 1, { approved: true });
    await approveEpisodeMappingReview(projectsRoot, root, "long", 1);

    // Bump the project's own scene count before Episode 2 is ever created, so Episode 2 snapshots 8 while
    // Episode 1 keeps its already-snapshotted 4 — sourceSceneNumber must reflect Episode 1's own count.
    await projects.updateSettings("long", { settings: { ...settings, sceneCount: 8 } });
    await scripts.generate("long", 2, { userRequestId: "episode-continuity-reference.service-script-3" }); await scripts.approve("long", 2, { approved: true });
    await approveEpisodeMappingReview(projectsRoot, root, "long", 2);

    await images.generate("long", 1, { approved: true });
    for (const scene of [1, 2, 3, 4]) await images.approve("long", 1, String(scene), { approved: true });

    await expect(reference.get("long", 2)).resolves.toEqual({ reference: { previousEpisodeNumber: 1, sourceSceneNumber: 4, available: true } });
  });
});
