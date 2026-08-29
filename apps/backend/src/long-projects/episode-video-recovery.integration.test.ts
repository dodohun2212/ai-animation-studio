import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { API_ROUTES } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../app.module.js";
import { approveEpisodeMappingReview } from "./episode-mapping-test-fixtures.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { EpisodeVideosService } from "./episode-videos.service.js";
import { LongProjectsService } from "./long-projects.service.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { PLACEHOLDER_MP4 } from "../videos/placeholder-clip.js";

/**
 * The recovery route, driven through a real router with the exact body the client sends.
 *
 * This is the button 캡틴D is about to press on six clips that were paid for and then overwritten with 32-byte
 * stubs, and its whole promise is that pressing it costs nothing. The service has its own tests; what they
 * cannot see is everything between the URL and the service — whether `generations/:jobId/recovery` is reached
 * at all rather than being swallowed by the sibling `generations/:jobId` route, and whether the approval body
 * arrives parsed. Both are exactly the kind of gap that has produced a route that could not succeed for any
 * input (Story Bible search) and a route nothing reached (the current-job lookup).
 *
 * No paid call is made: `fetch` is stubbed, Runway hosts answer from fixtures, and the test's own requests to
 * the app pass through to the real implementation. The strongest assertion here is a negative one — recovery
 * must never touch the task-creation endpoint, because that is the $0.25-a-scene difference between fetching
 * work already paid for and buying it again.
 */

const settings = {
  title: "Recovery", logline: "l", overview: "o", genre: "g", tone: "t", theme: "th",
  episodeCount: 1, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const,
  audience: "a", notes: "n", startingState: "s", midpoint: "m", endingDirection: "e",
  storyFlowSummary: "f", narrationEnabled: false, subtitlesEnabled: false,
};

const REAL_CLIP = Buffer.concat([PLACEHOLDER_MP4, Buffer.alloc(4096, 9)]);

let root: string | undefined;
let app: INestApplication | undefined;
let previousLearningData: string | undefined;
let previousSettingsRoot: string | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.close(); app = undefined;
  if (previousLearningData === undefined) delete process.env.LEARNING_DATA_ROOT; else process.env.LEARNING_DATA_ROOT = previousLearningData;
  previousLearningData = undefined;
  if (previousSettingsRoot === undefined) delete process.env.PROVIDER_SETTINGS_ROOT; else process.env.PROVIDER_SETTINGS_ROOT = previousSettingsRoot;
  previousSettingsRoot = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

/**
 * Runway answers from fixtures; anything aimed at the app under test goes to the real fetch.
 *
 * `runwayCalls` records every Runway URL so the test can assert what was *not* called.
 */
function stubRunway(outputBody: Buffer | null, runwayCalls: string[]): void {
  const real = globalThis.fetch;
  // `vi.fn`, not a plain function: no-test-network.guard.ts refuses any Runway call whose fetch is not a
  // vitest mock, because a real key on disk plus a real fetch is how D-016's unexplained charges happened.
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("runwayml.com")) return real(input as RequestInfo, init);
    runwayCalls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/v1/tasks/")) {
      return new Response(JSON.stringify({ status: "SUCCEEDED", output: ["https://cdn.runwayml.com/clip.mp4"] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("cdn.runwayml.com")) {
      if (outputBody === null) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(outputBody), { status: 200 });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }));
}

async function bootWithStubbedClips() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-recovery-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings });
  const outline = await projects.preview("long");
  await projects.approve("long", { approved: true, prompt: outline.preview.prompt, promptSha256: outline.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot);
  await scripts.generate("long", 1, { userRequestId: "episode-recovery-script-1" });
  await scripts.approve("long", 1, { approved: true });
  await approveEpisodeMappingReview(projectsRoot, root, "long", 1);
  const images = new EpisodeImagesService(projectsRoot);
  await images.generate("long", 1, { approved: true });
  for (const scene of [1, 2, 3, 4, 5, 6]) await images.approve("long", 1, String(scene), { approved: true });

  previousLearningData = process.env.LEARNING_DATA_ROOT; process.env.LEARNING_DATA_ROOT = root;
  previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT; process.env.PROVIDER_SETTINGS_ROOT = root;
  await new ProviderSettingsService(new ProviderSettingsRepository(root)).save("runway", { value: "key_test_runway_1234567890" });

  const videos = new EpisodeVideosService(projectsRoot);
  const preview = await videos.preview("long", 1);
  const started = await videos.start("long", 1, {
    approved: true,
    confirmationId: preview.confirmationId,
    userRequestId: "recovery_integration_1",
    prompts: preview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })),
  });
  await videos.run("long", 1, started.jobId);

  // Reproduce the incident on disk: the run succeeded and was billed as Runway, and every clip on disk is the
  // 32-byte header the success path used to write instead of the downloaded bytes.
  const episodeDirectory = path.join(projectsRoot, "long", "long_story", "Episode01");
  const recordsFile = path.join(episodeDirectory, "video_generation_records.json");
  const records = JSON.parse(await fs.readFile(recordsFile, "utf8")) as Array<Record<string, unknown>>;
  for (const record of records) {
    record.execution_mode = "runway";
    record.status = "succeeded";
    record.runway_task_id = `task_${String(record.scene_number)}`;
  }
  await fs.writeFile(recordsFile, JSON.stringify(records));
  for (const scene of [1, 2, 3, 4, 5, 6]) {
    await fs.writeFile(path.join(episodeDirectory, "videos", `scene${scene}.mp4`), PLACEHOLDER_MP4);
  }

  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  return { base, episodeDirectory, jobId: started.jobId };
}

const post = (base: string, jobId: string, body: unknown) =>
  fetch(base + API_ROUTES.longEpisodeVideoRecovery("long", 1, jobId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe.sequential("recovering Episode clips already paid for", () => {
  it("reaches its own route, writes the downloaded bytes over the stubs, and never asks Runway to make anything", async () => {
    const runwayCalls: string[] = [];
    const { base, episodeDirectory, jobId } = await bootWithStubbedClips();
    stubRunway(REAL_CLIP, runwayCalls);

    // The body the client actually sends — see recoverLongEpisodeVideos in longProjectsApi.ts.
    const response = await post(base, jobId, { approved: true });

    expect(response.status).toBe(201);
    const body = await response.json() as { recoveredSceneNumbers: number[]; unrecoverableScenes: unknown[] };
    expect(body.recoveredSceneNumbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect(body.unrecoverableScenes).toEqual([]);

    for (const scene of [1, 2, 3, 4, 5, 6]) {
      const written = await fs.readFile(path.join(episodeDirectory, "videos", `scene${scene}.mp4`));
      expect(written.length).toBe(REAL_CLIP.length);
    }
    // The whole promise of this button. Creating a task is what costs money; fetching a finished one does not.
    expect(runwayCalls.filter((call) => call.includes("image_to_video"))).toEqual([]);
    expect(runwayCalls.filter((call) => call.includes("/v1/tasks/")).length).toBe(6);
  });

  it("refuses a request that does not carry the approval, without calling Runway at all", async () => {
    const runwayCalls: string[] = [];
    const { base, jobId } = await bootWithStubbedClips();
    stubRunway(REAL_CLIP, runwayCalls);

    const response = await post(base, jobId, {});

    expect(response.status).toBe(400);
    expect(runwayCalls).toEqual([]);
  });

  it("names the scenes it could not fetch instead of writing a header over them again", async () => {
    const runwayCalls: string[] = [];
    const { base, episodeDirectory, jobId } = await bootWithStubbedClips();
    // An expired output URL: the task still reports success, the download does not arrive.
    stubRunway(null, runwayCalls);

    const response = await post(base, jobId, { approved: true });

    expect(response.status).toBe(201);
    const body = await response.json() as { recoveredSceneNumbers: number[]; unrecoverableScenes: Array<{ sceneNumber: number }> };
    expect(body.recoveredSceneNumbers).toEqual([]);
    expect(body.unrecoverableScenes.map((scene) => scene.sceneNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    // Unchanged, not re-stubbed: a failed recovery must leave the evidence of the failure exactly as it was.
    const untouched = await fs.readFile(path.join(episodeDirectory, "videos", "scene1.mp4"));
    expect(untouched.length).toBe(PLACEHOLDER_MP4.length);
    expect(runwayCalls.filter((call) => call.includes("image_to_video"))).toEqual([]);
  });
});
