import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { API_ROUTES, type SceneNumber } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";

/**
 * One Long Project Episode taken from nothing to approved videos, over a real running app.
 *
 * The service tests already walk this order — EpisodeVideoMergeService's own setup does exactly these steps —
 * so what this adds is the layer between them. Every URL here is built by `API_ROUTES`, the same builders the
 * frontend calls, while the controllers spell their paths out by hand in their decorators. Nothing else compares
 * the two, and a service can be entirely correct while the route that reaches it has moved (D-024). That gap is
 * not hypothetical here: Episode image generation once read mappings in a format nothing wrote any more, and
 * every service test passed throughout.
 *
 * No credential is configured, so every generation step takes its local-fake path and no provider is called.
 */

const PROJECT_ID = "long_flow";
const SETTINGS = {
  title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "",
  episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const,
  audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "",
  narrationEnabled: false, subtitlesEnabled: false,
};
const SCENES = [1, 2, 3, 4, 5, 6] as readonly SceneNumber[];

let root: string | undefined;
let app: INestApplication | undefined;
let base = "";
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

async function boot(): Promise<void> {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "long-flow-http-"));
  previousLearningData = process.env.LEARNING_DATA_ROOT; process.env.LEARNING_DATA_ROOT = root;
  // Pointed at the empty temporary root on purpose: with no stored credential every step takes its local-fake
  // path, which is what keeps this test from ever reaching a paid provider.
  previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT; process.env.PROVIDER_SETTINGS_ROOT = root;
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
}

/** Fails naming the route, because a wiring mistake shows up as a 404 several steps before the assertion that cares. */
async function call<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${route}`, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (response.status >= 400) throw new Error(`${method} ${route} → ${response.status} ${await response.text()}`);
  return await response.json() as T;
}

describe.sequential("Long Project Episode flow over HTTP", () => {
  it("carries one Episode from an empty project to approved videos through the routes the frontend calls", async () => {
    await boot();

    await call("POST", API_ROUTES.longProjects, { projectId: PROJECT_ID, settings: SETTINGS });

    const { preview } = await call<{ preview: { prompt: string; promptSha256: string } }>(
      "POST", API_ROUTES.longProjectOutlinePreview(PROJECT_ID));
    await call("POST", API_ROUTES.longProjectOutlineApproval(PROJECT_ID),
      { approved: true, prompt: preview.prompt, promptSha256: preview.promptSha256 });

    await call("POST", API_ROUTES.longEpisodeScriptGeneration(PROJECT_ID, 1), {});
    await call("POST", API_ROUTES.longEpisodeScriptApproval(PROJECT_ID, 1), { approved: true });

    // A mapping review has to be approved before images, and it needs something mapped. A Folder is the case
    // the Episode screen actually offers, and the one that used to be refused outright.
    const { asset } = await call<{ asset: { assetId: string } }>(
      "POST", "/assets/folders", { assetType: "character", displayName: "주인공" });
    const mappings = `${API_ROUTES.longProjects}/${PROJECT_ID}/episodes/1/assets/mappings`;
    await call("POST", mappings, { assetId: asset.assetId, usageRole: "character", sceneScope: { kind: "all" } });
    const { review } = await call<{ review: { scriptFingerprint: string } }>(
      "POST", `${mappings.replace("/mappings", "/mapping-review")}`, { scriptRevision: 1, legacyConfirmed: true });
    await call("POST", `${mappings.replace("/mappings", "/mapping-review")}/approve`, { scriptFingerprint: review.scriptFingerprint });

    await call("POST", API_ROUTES.longEpisodeImageGeneration(PROJECT_ID, 1), { approved: true });
    for (const scene of SCENES) {
      await call("POST", API_ROUTES.longEpisodeImageReviewApproval(PROJECT_ID, 1, scene), { approved: true });
    }

    const videoPreview = await call<{ confirmationId: string; scenes: Array<{ sceneNumber: SceneNumber; prompt: string }> }>(
      "GET", API_ROUTES.longEpisodeVideoPreview(PROJECT_ID, 1));
    const started = await call<{ jobId: string }>("POST", API_ROUTES.longEpisodeVideoGeneration(PROJECT_ID, 1), {
      approved: true,
      confirmationId: videoPreview.confirmationId,
      userRequestId: "flow_request_1",
      prompts: videoPreview.scenes.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })),
    });

    // The route starts the run and returns; the work continues behind it. Polling the progress route is what the
    // screen does, so it is also what proves the progress route reports this job rather than a stale one.
    const finished = await waitForVideos(started.jobId);
    expect(finished.status).toBe("succeeded");

    // A settled job is not the same fact as an Episode ready to be reviewed, and they land at different moments:
    // approving a scene right after the job said "succeeded" was refused as not allowed in the current state,
    // intermittently and only under load. The precondition for the next step is the Episode's own state, so that
    // is what to wait for.
    const ready = await waitForEpisodeState("videos_review");
    expect(ready).toBe("videos_review");

    for (const scene of SCENES) {
      await call("POST", API_ROUTES.longEpisodeVideoReviewApproval(PROJECT_ID, 1, started.jobId, scene), { approved: true });
    }

    const { episode } = await call<{ episode: { status: string; approved: boolean } }>(
      "GET", API_ROUTES.longEpisode(PROJECT_ID, 1));
    expect(episode.status).toBe("videos_approved");

    // The state on disk, not only what the route said: the two disagreeing is the failure this whole walk is
    // built to catch, and a response can be assembled from values that were never stored.
    const stored = JSON.parse(await fs.readFile(
      path.join(root!, "projects", PROJECT_ID, "long_story", "Episode01", "project.json"), "utf8")) as { state: string };
    expect(stored.state).toBe("videos_approved");
  }, 120_000);

  it("never spent anything getting there", async () => {
    await boot();
    await call("POST", API_ROUTES.longProjects, { projectId: PROJECT_ID, settings: SETTINGS });
    const { preview } = await call<{ preview: { prompt: string; promptSha256: string } }>(
      "POST", API_ROUTES.longProjectOutlinePreview(PROJECT_ID));
    await call("POST", API_ROUTES.longProjectOutlineApproval(PROJECT_ID),
      { approved: true, prompt: preview.prompt, promptSha256: preview.promptSha256 });
    await call("POST", API_ROUTES.longEpisodeScriptGeneration(PROJECT_ID, 1), {});

    // Two steps that each cost money when a credential is present. With none configured they take the fake path,
    // and the ledger file is how that is checked rather than assumed — an empty ledger is the only evidence that
    // "no credential" was honoured all the way down rather than somewhere along the way.
    await expect(fs.access(path.join(root!, "api_budget_usage.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(path.join(root!, "runway_budget_usage.json"))).rejects.toMatchObject({ code: "ENOENT" });
  }, 60_000);
});

/**
 * Polls until the job reaches a state it will not leave.
 *
 * Waiting on the states it might still be *in* is the version that fails on a busy machine: written that way it
 * listed "running" and "submitting", and under a full-suite load the first poll caught the job still at
 * "created" and it returned that as the answer. Terminal states are a closed set the contract names; the
 * in-progress ones are whatever is left, which is not something a test should be trying to enumerate.
 */
const SETTLED = new Set(["succeeded", "failed", "interrupted"]);

async function waitForVideos(jobId: string): Promise<{ status: string }> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const progress = await call<{ status: string }>("GET", API_ROUTES.longEpisodeVideoProgress(PROJECT_ID, 1, jobId));
    if (SETTLED.has(progress.status)) return progress;
    if (Date.now() > deadline) throw new Error(`video job stayed ${progress.status}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForEpisodeState(target: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const { episode } = await call<{ episode: { status: string } }>("GET", API_ROUTES.longEpisode(PROJECT_ID, 1));
    if (episode.status === target) return episode.status;
    if (Date.now() > deadline) return episode.status;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
