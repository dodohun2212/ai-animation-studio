import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { API_ROUTES } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { approveEpisodeMappingReview } from "./episode-mapping-test-fixtures.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { EpisodeVideosService } from "./episode-videos.service.js";
import { LongProjectsService } from "./long-projects.service.js";

/**
 * An address for the Episode's merged final video, driven over a running app.
 *
 * Over HTTP rather than through the service, and that is not a precaution — it caught the bug. `videos/final/
 * content` and `videos/:sceneNumber/content` are the same shape to a router, so which one answers is decided by
 * registration order, which no service test can see. Declared in the merge controller the route lost: every
 * request came back as an invalid scene number, because "final" is not one. Moving it into the videos
 * controller above the scene route is what fixed it.
 *
 * The hole this closes: the merge screen printed the file path as text, in React state, so a reload left a
 * finished Episode video with no address anywhere in the app. The short project has had `videoFinalContent`
 * since its merge screen existed.
 */

const settings = {
  title: "Final", logline: "l", overview: "o", genre: "g", tone: "t", theme: "th",
  episodeCount: 1, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const,
  audience: "a", notes: "n", startingState: "s", midpoint: "m", endingDirection: "e",
  storyFlowSummary: "f", narrationEnabled: false, subtitlesEnabled: false,
};

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

async function bootMergedEpisode() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-final-content-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings });
  const outline = await projects.preview("long");
  await projects.approve("long", { approved: true, prompt: outline.preview.prompt, promptSha256: outline.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot);
  await scripts.generate("long", 1, { userRequestId: "episode-final-content-script-1" });
  await scripts.approve("long", 1, { approved: true });
  await approveEpisodeMappingReview(projectsRoot, root, "long", 1);
  const images = new EpisodeImagesService(projectsRoot);
  await images.generate("long", 1, { approved: true });
  for (const scene of [1, 2, 3, 4, 5, 6]) await images.approve("long", 1, String(scene), { approved: true });

  previousLearningData = process.env.LEARNING_DATA_ROOT; process.env.LEARNING_DATA_ROOT = root;
  previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT; process.env.PROVIDER_SETTINGS_ROOT = root;
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  const finalFile = path.join(projectsRoot, "long", "long_story", "Episode01", "videos", "final", "instagram_reel.mp4");
  return { base, projectsRoot, finalFile, videos: new EpisodeVideosService(projectsRoot) };
}

const url = (base: string) => base + API_ROUTES.longEpisodeFinalVideoContent("long", 1);

describe.sequential("an Episode's final video has an address", () => {
  it("serves the merged file at its own route rather than letting the scene route claim it", async () => {
    const { base, finalFile } = await bootMergedEpisode();
    await fs.mkdir(path.dirname(finalFile), { recursive: true });
    // Stands in for a real merge: the point under test is the route and the size rule, not ffmpeg.
    await fs.writeFile(finalFile, Buffer.alloc(4096, 7));

    const response = await fetch(url(base));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("video/mp4");
    expect(Number(response.headers.get("content-length"))).toBe(4096);
    // Proof the scene route did not answer: it would have called "final" an invalid scene number.
    expect((await response.arrayBuffer()).byteLength).toBe(4096);
  });

  it("refuses a file no larger than a placeholder clip instead of drawing a black box called the final video", async () => {
    const { base, finalFile } = await bootMergedEpisode();
    await fs.mkdir(path.dirname(finalFile), { recursive: true });
    // A merged file cannot be smaller than the clips that went into it, so this size means stubs were
    // concatenated — the same claim the 32-byte scene files were making on disk.
    await fs.writeFile(finalFile, Buffer.alloc(32, 0));

    const response = await fetch(url(base));

    expect(response.status).toBe(409);
    expect((await response.json() as { code: string }).code).toBe("LONG_EPISODE_MERGE_CLIPS_INVALID");
  });

  it("says so when nothing has been merged yet, rather than answering with an empty body", async () => {
    const { base } = await bootMergedEpisode();

    const response = await fetch(url(base));

    expect(response.status).toBe(409);
    expect((await response.json() as { code: string }).code).toBe("LONG_EPISODE_MERGE_CLIPS_INVALID");
  });

  it("still refuses an Episode that does not exist", async () => {
    const { base } = await bootMergedEpisode();

    const response = await fetch(base + API_ROUTES.longEpisodeFinalVideoContent("long", 9));

    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
