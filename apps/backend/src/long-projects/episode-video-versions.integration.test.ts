import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { API_ROUTES, type SceneNumber, type VideoVersionSummary } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { approveEpisodeMappingReview } from "./episode-mapping-test-fixtures.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { EpisodeVideosService } from "./episode-videos.service.js";
import { LongProjectsService } from "./long-projects.service.js";
import { PLACEHOLDER_MP4 } from "../videos/placeholder-clip.js";

/**
 * Past copies of an Episode scene's clip — listed, played, restored — over a running app.
 *
 * These files already existed. Regenerating a scene has always archived the clip it displaced, under a name
 * (`scene{n}_{timestamp}.mp4`) that nothing in the app could parse, so paid clips accumulated on disk with no
 * way to list, play or restore them. The write now uses the short project's `scene{n}_v{NNN}.mp4` and these
 * are the readers.
 *
 * Over HTTP because the routes sit under `videos/` beside `:sceneNumber/content`, `final/content` and
 * `generations/...`, and which of those claims a path is decided by registration order. That has already been
 * wrong once in this controller, and no service test can see it.
 */

const settings = {
  title: "Versions", logline: "l", overview: "o", genre: "g", tone: "t", theme: "th",
  episodeCount: 1, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const,
  audience: "a", notes: "n", startingState: "s", midpoint: "m", endingDirection: "e",
  storyFlowSummary: "f", narrationEnabled: false, subtitlesEnabled: false,
};

/** Distinguishable real clips: the assertions are about which bytes came back, not merely that some did. */
const clip = (fill: number, size = 2048) => Buffer.concat([PLACEHOLDER_MP4, Buffer.alloc(size, fill)]);

let root: string | undefined;
let app: INestApplication | undefined;
let previousLearningData: string | undefined;
let previousSettingsRoot: string | undefined;

afterEach(async () => {
  await app?.close(); app = undefined;
  if (previousLearningData === undefined) delete process.env.LEARNING_DATA_ROOT; else process.env.LEARNING_DATA_ROOT = previousLearningData;
  previousLearningData = undefined;
  if (previousSettingsRoot === undefined) delete process.env.PROVIDER_SETTINGS_ROOT; else process.env.PROVIDER_SETTINGS_ROOT = previousSettingsRoot;
  previousSettingsRoot = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

async function bootEpisodeWithClips() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-versions-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings });
  const outline = await projects.preview("long");
  await projects.approve("long", { approved: true, prompt: outline.preview.prompt, promptSha256: outline.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot);
  await scripts.generate("long", 1, { userRequestId: "episode-versions-script-1" });
  await scripts.approve("long", 1, { approved: true });
  await approveEpisodeMappingReview(projectsRoot, root, "long", 1);
  const images = new EpisodeImagesService(projectsRoot);
  await images.generate("long", 1, { approved: true });
  for (const scene of [1, 2, 3, 4, 5, 6]) await images.approve("long", 1, String(scene), { approved: true });

  const videos = new EpisodeVideosService(projectsRoot);
  const preview = await videos.preview("long", 1);
  const started = await videos.start("long", 1, {
    approved: true,
    confirmationId: preview.confirmationId,
    userRequestId: "versions_1",
    prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })),
  });
  await videos.run("long", 1, started.jobId);

  previousLearningData = process.env.LEARNING_DATA_ROOT; process.env.LEARNING_DATA_ROOT = root;
  previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT; process.env.PROVIDER_SETTINGS_ROOT = root;
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  const episodeDirectory = path.join(projectsRoot, "long", "long_story", "Episode01");
  return { base, projectsRoot, episodeDirectory, videos };
}

/** Stands in for regeneration having happened twice: two archived copies plus the clip in use. */
async function layHistory(episodeDirectory: string, scene: SceneNumber): Promise<void> {
  const videos = path.join(episodeDirectory, "videos");
  await fs.mkdir(path.join(videos, "history"), { recursive: true });
  await fs.writeFile(path.join(videos, "history", `scene${scene}_v001.mp4`), clip(1));
  await fs.writeFile(path.join(videos, "history", `scene${scene}_v002.mp4`), clip(2));
  await fs.writeFile(path.join(videos, `scene${scene}.mp4`), clip(3));
}

const versionsUrl = (base: string, scene: SceneNumber | "final") => base + API_ROUTES.longEpisodeVideoVersions("long", 1, scene);
const contentUrl = (base: string, scene: SceneNumber | "final", version: string) => base + API_ROUTES.longEpisodeVideoVersionContent("long", 1, scene, version);
const restoreUrl = (base: string, scene: SceneNumber | "final", version: string) => base + API_ROUTES.longEpisodeVideoVersionRestore("long", 1, scene, version);

describe.sequential("an Episode scene's past clips", () => {
  it("lists the clip in use and every archived copy, newest first", async () => {
    const { base, episodeDirectory } = await bootEpisodeWithClips();
    await layHistory(episodeDirectory, 2);

    const response = await fetch(versionsUrl(base, 2));

    expect(response.status).toBe(200);
    const { versions } = await response.json() as { versions: VideoVersionSummary[] };
    expect(versions.map((version) => version.versionId)).toEqual(["current", "v002", "v001"]);
    expect(versions.filter((version) => version.isCurrent).map((version) => version.versionId)).toEqual(["current"]);
    expect(versions.every((version) => version.bytes > PLACEHOLDER_MP4.length)).toBe(true);
  });

  it("answers with just the clip in use when nothing has been archived yet", async () => {
    const { base } = await bootEpisodeWithClips();

    const { versions } = await (await fetch(versionsUrl(base, 1))).json() as { versions: VideoVersionSummary[] };

    expect(versions.map((version) => version.versionId)).toEqual(["current"]);
  });

  it("plays a specific archived copy, and is not swallowed by the sibling routes under videos/", async () => {
    const { base, episodeDirectory } = await bootEpisodeWithClips();
    await layHistory(episodeDirectory, 2);

    const older = await fetch(contentUrl(base, 2, "v001"));

    expect(older.status).toBe(200);
    expect(older.headers.get("content-type")).toContain("video/mp4");
    // The bytes identify which copy answered: v001 is the 1-filled clip, not the 3-filled one in use.
    expect(Buffer.from(await older.arrayBuffer()).equals(clip(1))).toBe(true);
    expect(Buffer.from(await (await fetch(contentUrl(base, 2, "current"))).arrayBuffer()).equals(clip(3))).toBe(true);
  });

  it("refuses a version id it does not have, and a placeholder standing where a clip should be", async () => {
    const { base, episodeDirectory } = await bootEpisodeWithClips();
    await layHistory(episodeDirectory, 2);
    await fs.writeFile(path.join(episodeDirectory, "videos", "history", "scene2_v003.mp4"), PLACEHOLDER_MP4);

    expect((await fetch(contentUrl(base, 2, "v009"))).status).toBe(404);
    expect((await fetch(contentUrl(base, 2, "nonsense"))).status).toBe(404);
    // A header-sized file is not a clip. Serving it would draw a black box for someone deciding what to restore.
    expect((await fetch(contentUrl(base, 2, "v003"))).status).toBe(404);
  });

  it("makes an older copy current again, archiving the one it displaces so the restore is reversible", async () => {
    const { base, episodeDirectory } = await bootEpisodeWithClips();
    await layHistory(episodeDirectory, 2);

    const response = await fetch(restoreUrl(base, 2, "v001"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }),
    });

    expect(response.status).toBe(201);
    const inUse = await fs.readFile(path.join(episodeDirectory, "videos", "scene2.mp4"));
    expect(inUse.equals(clip(1))).toBe(true);
    // Nothing was deleted: the clip that had been in use is now v003.
    const archived = await fs.readFile(path.join(episodeDirectory, "videos", "history", "scene2_v003.mp4"));
    expect(archived.equals(clip(3))).toBe(true);
    const { versions } = await (await fetch(versionsUrl(base, 2))).json() as { versions: VideoVersionSummary[] };
    expect(versions.map((version) => version.versionId)).toEqual(["current", "v003", "v002", "v001"]);
  });

  it("voids the merged final video, because the scenes it was built from no longer match", async () => {
    const { base, episodeDirectory } = await bootEpisodeWithClips();
    await layHistory(episodeDirectory, 2);
    const episodeFile = path.join(episodeDirectory, "project.json");
    const stored = JSON.parse(await fs.readFile(episodeFile, "utf8")) as Record<string, unknown>;
    await fs.writeFile(episodeFile, JSON.stringify({ ...stored, state: "completed", final_video_path: "videos/final/instagram_reel.mp4" }));

    const response = await fetch(restoreUrl(base, 2, "v001"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }),
    });

    expect(response.status).toBe(201);
    const { episode } = await response.json() as { episode: { status: string } };
    expect(episode.status).toBe("videos_approved");
    const after = JSON.parse(await fs.readFile(episodeFile, "utf8")) as { final_video_path: unknown };
    expect(after.final_video_path).toBeNull();
  });

  it("still serves a scene clip after the Episode has been merged, rather than reading the finished Episode as corrupt", async () => {
    // Not really about versions — found by the restore test above, and kept here because this is where it was
    // caught. Five services each held their own copy of the Episode status list, and three stopped at
    // `interrupted`, so a merged Episode failed their stored-data validation: every scene player, the recovery
    // button and the script all answered 500 the moment a final video existed. The list now has one home.
    const { base, episodeDirectory } = await bootEpisodeWithClips();
    await layHistory(episodeDirectory, 2);
    const episodeFile = path.join(episodeDirectory, "project.json");
    const stored = JSON.parse(await fs.readFile(episodeFile, "utf8")) as Record<string, unknown>;
    await fs.writeFile(episodeFile, JSON.stringify({ ...stored, state: "completed", final_video_path: "videos/final/instagram_reel.mp4" }));

    expect((await fetch(base + API_ROUTES.longEpisodeVideoContent("long", 1, 2))).status).toBe(200);
    expect((await fetch(versionsUrl(base, 2))).status).toBe(200);
  });

  it("refuses a restore without the approval, and refuses restoring the clip already in use over itself", async () => {
    const { base, episodeDirectory } = await bootEpisodeWithClips();
    await layHistory(episodeDirectory, 2);

    const unapproved = await fetch(restoreUrl(base, 2, "v001"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    expect(unapproved.status).toBe(400);

    const itself = await fetch(restoreUrl(base, 2, "current"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }),
    });
    expect(itself.status).toBe(409);

    // Neither attempt touched the file in use.
    expect((await fs.readFile(path.join(episodeDirectory, "videos", "scene2.mp4"))).equals(clip(3))).toBe(true);
  });
});

describe.sequential("an Episode's past final videos", () => {
  /** A finished cut plus two older ones, the way re-merging twice would leave them. */
  async function layFinalHistory(episodeDirectory: string): Promise<void> {
    const final = path.join(episodeDirectory, "videos", "final");
    await fs.mkdir(path.join(final, "history"), { recursive: true });
    await fs.writeFile(path.join(final, "history", "instagram_reel_v001.mp4"), clip(1));
    await fs.writeFile(path.join(final, "history", "instagram_reel_v002.mp4"), clip(2));
    await fs.writeFile(path.join(final, "instagram_reel.mp4"), clip(3));
  }

  async function markCompleted(episodeDirectory: string): Promise<string> {
    const episodeFile = path.join(episodeDirectory, "project.json");
    const stored = JSON.parse(await fs.readFile(episodeFile, "utf8")) as Record<string, unknown>;
    await fs.writeFile(episodeFile, JSON.stringify({ ...stored, state: "completed", final_video_path: "videos/final/instagram_reel.mp4" }));
    return episodeFile;
  }

  it("lists the finished cut in use and every older one, on the same three routes as a scene", async () => {
    const { base, episodeDirectory } = await bootEpisodeWithClips();
    await layFinalHistory(episodeDirectory);
    await markCompleted(episodeDirectory);

    const { versions } = await (await fetch(versionsUrl(base, "final"))).json() as { versions: VideoVersionSummary[] };

    expect(versions.map((version) => version.versionId)).toEqual(["current", "v002", "v001"]);
  });

  it("plays an older cut, identified by its bytes rather than by the route answering at all", async () => {
    const { base, episodeDirectory } = await bootEpisodeWithClips();
    await layFinalHistory(episodeDirectory);
    await markCompleted(episodeDirectory);

    const older = await fetch(contentUrl(base, "final", "v001"));

    expect(older.status).toBe(200);
    expect(Buffer.from(await older.arrayBuffer()).equals(clip(1))).toBe(true);
  });

  /**
   * The opposite of a scene restore, on purpose.
   *
   * Restoring a *scene* clears the final video: the merge was built from clips that no longer match. Restoring
   * a *final video* is the merge — clearing it would throw away the very cut the person just chose, which is
   * the one outcome this feature exists to prevent.
   */
  it("makes an older cut current again and leaves the Episode finished, not un-merged", async () => {
    const { base, episodeDirectory } = await bootEpisodeWithClips();
    await layFinalHistory(episodeDirectory);
    const episodeFile = await markCompleted(episodeDirectory);

    const response = await fetch(restoreUrl(base, "final", "v001"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }),
    });

    expect(response.status).toBe(201);
    const { episode } = await response.json() as { episode: { status: string } };
    expect(episode.status).toBe("completed");
    const after = JSON.parse(await fs.readFile(episodeFile, "utf8")) as { final_video_path: unknown };
    expect(after.final_video_path).toBe("videos/final/instagram_reel.mp4");
    // The chosen cut is what the Episode now serves, and the one it displaced was kept — a restore is itself
    // reversible or it is just a different way of losing a cut.
    const final = path.join(episodeDirectory, "videos", "final");
    expect(Buffer.from(await fs.readFile(path.join(final, "instagram_reel.mp4"))).equals(clip(1))).toBe(true);
    expect(Buffer.from(await fs.readFile(path.join(final, "history", "instagram_reel_v003.mp4"))).equals(clip(3))).toBe(true);
  });
});
