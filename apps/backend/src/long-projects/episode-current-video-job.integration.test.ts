import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeVideosService } from "./episode-videos.service.js";
import { approveEpisodeMappingReview } from "./episode-mapping-test-fixtures.js";
import { LongProjectsService } from "./long-projects.service.js";

/**
 * Finding the way back to a video generation after a reload.
 *
 * Driven over a running app rather than the service alone, because the route sits under the same path prefix as
 * `generations/:jobId` — "current" is a job id as far as a router is concerned, and which of the two wins is
 * decided by registration order, not by anything visible in either handler.
 */

const settings = {
  title: "Resume", logline: "l", overview: "o", genre: "g", tone: "t", theme: "th",
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

async function bootEpisodeReadyForVideo() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-current-job-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings });
  const preview = await projects.preview("long");
  await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot);
  await scripts.generate("long", 1, { userRequestId: "episode-current-video-job.integration-script-1" });
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
  return { base, projectsRoot, videos: new EpisodeVideosService(projectsRoot) };
}

const currentJobUrl = (base: string) => `${base}/long-projects/long/episodes/1/videos/generations/current`;

describe.sequential("an Episode's current video job", () => {
  it("is reachable at its own route, not swallowed by the one that takes a job id", async () => {
    // If `generations/:jobId` claimed this path first, the answer would be a job-not-found error rather than a
    // report of no job — and the screen would show a failure where the truth is "nothing is running".
    const { base } = await bootEpisodeReadyForVideo();

    const response = await fetch(currentJobUrl(base));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobId: null });
  });

  it("hands back the job a reloaded screen would otherwise have lost", async () => {
    const { base, videos } = await bootEpisodeReadyForVideo();
    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, {
      approved: true,
      confirmationId: preview.confirmationId,
      userRequestId: "resume_1",
      prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })),
    });

    // The id existed only in the tab that started it. This is the whole point: ask the server instead.
    const { jobId } = await (await fetch(currentJobUrl(base))).json() as { jobId: string | null };
    expect(jobId).toBe(started.jobId);

    // And it is a usable id — the progress route the screen already has takes it from here.
    const progress = await fetch(`${base}/long-projects/long/episodes/1/videos/generations/${jobId}`);
    expect(progress.status).toBe(200);
  });

  it("still reports the job once generation has finished, so a reload during review keeps its subject", async () => {
    const { base, videos } = await bootEpisodeReadyForVideo();
    const preview = await videos.preview("long", 1);
    const started = await videos.start("long", 1, {
      approved: true,
      confirmationId: preview.confirmationId,
      userRequestId: "resume_2",
      prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })),
    });
    await videos.progress("long", 1, started.jobId);

    expect(await (await fetch(currentJobUrl(base))).json()).toEqual({ jobId: started.jobId });
  });
});
