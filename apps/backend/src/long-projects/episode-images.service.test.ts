import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeAssetMappingsService } from "./episode-asset-mappings.service.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { LongProjectsService } from "./long-projects.service.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, platform: "YouTube Shorts" as const, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-images-")); const projectsRoot = path.join(root, "projects"); const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings }); const preview = await projects.preview("long"); await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot); await scripts.generate("long", 1, {}); await scripts.approve("long", 1, { approved: true });
  const mappings = new EpisodeAssetMappingsService(projectsRoot, new LocalAssetsRepository(root)); const mapping = await mappings.begin("long", 1, { textOnlyConfirmed: true }); await mappings.approve("long", 1, { approved: true, scriptFingerprint: mapping.review.scriptFingerprint });
  return { images: new EpisodeImagesService(projectsRoot), projectsRoot };
}
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("EpisodeImagesService", () => {
  it("requires exact approval and a current approved mapping before locally generating six images", async () => {
    const { images, projectsRoot } = await setup();
    await expect(images.generate("long", 1, {} as never)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(images.generate("long", 1, { approved: true, extra: true } as never)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const generated = await images.generate("long", 1, { approved: true });
    expect(generated).toMatchObject({ episode: { status: "images_review" }, generatedSceneNumbers: [1, 2, 3, 4, 5, 6], reusedSceneNumbers: [] });
    await expect(fs.access(path.join(projectsRoot, "long", "long_story", "Episode01", "images", "scene6.png"))).resolves.toBeUndefined();
    await expect(images.generate("long", 1, { approved: true })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_IMAGES_NOT_ALLOWED" } });
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

  it("rejects stale mapping and damaged images without replacing valid review state", async () => {
    const { images, projectsRoot } = await setup(); const episode = path.join(projectsRoot, "long", "long_story", "Episode01", "project.json"); const stored = JSON.parse(await fs.readFile(episode, "utf8")); stored.script.scenes[0].description = "changed"; await fs.writeFile(episode, JSON.stringify(stored), "utf8");
    await expect(images.generate("long", 1, { approved: true })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_IMAGES_NOT_ALLOWED" } });
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
