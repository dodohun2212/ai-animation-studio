import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { API_ROUTES, type SceneNumber } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";

/**
 * One short project taken from nothing to approved videos, over a real running app.
 *
 * The twin of long-project-flow.app-module.integration.test.ts, and written because the short side is where the
 * long side's code came from: a defect found on one has been in the other every time this session. The short
 * side's existing HTTP tests each boot the app for one area — story, images, videos — so nothing walked the
 * whole order, which is where a step that no longer hands the next one what it expects would show.
 *
 * Every URL is built by `API_ROUTES`, the same builders the frontend uses, while the controllers spell their
 * paths out by hand. Nothing else compares the two.
 *
 * No credential is configured, so every generation step takes its local-fake path and no provider is called.
 */

const PROJECT_ID = "short_flow";
const SCENES = [1, 2, 3, 4, 5, 6] as readonly SceneNumber[];

let root: string | undefined;
let app: INestApplication | undefined;
let base = "";
const previous: Record<string, string | undefined> = {};

function setEnv(name: string, value: string): void {
  if (!(name in previous)) previous[name] = process.env[name];
  process.env[name] = value;
}

afterEach(async () => {
  await app?.close(); app = undefined;
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
    delete previous[name];
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

async function boot(): Promise<void> {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "short-flow-http-"));
  const templateRoot = path.join(root, "prompts", "story");
  await fs.mkdir(templateRoot, { recursive: true });
  await fs.writeFile(path.join(templateRoot, "story_generation.txt"), "topic=$topic", "utf8");

  setEnv("LEARNING_DATA_ROOT", root);
  setEnv("PROMPTS_ROOT", path.join(root, "prompts"));
  // The empty temporary root on purpose: with no stored credential every step takes its local-fake path, which
  // is what keeps this test from ever reaching a paid provider.
  setEnv("PROVIDER_SETTINGS_ROOT", root);
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
}

/** Fails naming the route, because a wiring mistake shows up as a 404 several steps before the assertion that cares. */
async function call<T>(method: "GET" | "POST" | "PATCH", route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${route}`, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (response.status >= 400) throw new Error(`${method} ${route} → ${response.status} ${await response.text()}`);
  return await response.json() as T;
}

const SETTLED = new Set(["succeeded", "failed", "interrupted"]);

async function waitForVideos(jobId: string): Promise<{ status: string }> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const progress = await call<{ status: string }>("GET", API_ROUTES.videoProgress(PROJECT_ID, jobId));
    if (SETTLED.has(progress.status)) return progress;
    if (Date.now() > deadline) throw new Error(`video job stayed ${progress.status}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.sequential("short project flow over HTTP", () => {
  it("carries one project from an empty topic to approved videos through the routes the frontend calls", async () => {
    await boot();

    await call("POST", API_ROUTES.projects, { projectId: PROJECT_ID, topic: "등대지기" });
    await call("PATCH", API_ROUTES.projectSettings(PROJECT_ID), {
      settings: {
        projectName: "short flow", topic: "등대지기", genre: "", mood: "", character: "", lore: "", fullStory: "",
        sceneCount: 6, clipDurationSeconds: 5, additionalNotes: "", styleNotes: {},
        narrationEnabled: false, subtitlesEnabled: false,
      },
    });

    const { preview } = await call<{ preview: { originalPrompt: string; originalPromptSha256: string } }>(
      "POST", API_ROUTES.storyPromptPreview(PROJECT_ID));
    await call("POST", API_ROUTES.storyPromptApproval(PROJECT_ID),
      { approved: true, prompt: preview.originalPrompt, originalPromptSha256: preview.originalPromptSha256 });

    // Images will not start until a mapping review is approved, and that review needs something mapped.
    const { asset } = await call<{ asset: { assetId: string } }>(
      "POST", API_ROUTES.createAssetFolder, { assetType: "character", displayName: "등대지기" });
    await call("POST", API_ROUTES.projectAssetMappings(PROJECT_ID),
      { assetId: asset.assetId, usageRole: "character", sceneScope: { kind: "all" } });
    const { review } = await call<{ review: { scriptFingerprint: string } }>(
      "POST", API_ROUTES.projectAssetMappingReview(PROJECT_ID),
      { scriptRevision: 1, legacyConfirmed: true });
    await call("POST", `${API_ROUTES.projectAssetMappingReview(PROJECT_ID)}/approve`,
      { scriptFingerprint: review.scriptFingerprint });

    await call("POST", API_ROUTES.imageGeneration(PROJECT_ID), { approved: true });
    for (const scene of SCENES) {
      await call("POST", API_ROUTES.imageReviewApproval(PROJECT_ID, scene), { approved: true });
    }

    // The short side names this `previews`, the Episode side names it `scenes`. Both carry the same pair, and the
    // difference is only visible here — each side's own tests read whichever name that side uses.
    const videoPreview = await call<{ confirmationId: string; previews: Array<{ sceneNumber: SceneNumber; prompt: string }> }>(
      "POST", API_ROUTES.videoPreview(PROJECT_ID), {});
    const started = await call<{ jobId: string }>("POST", API_ROUTES.videoGeneration(PROJECT_ID), {
      approved: true,
      confirmationId: videoPreview.confirmationId,
      userRequestId: "short_flow_request_1",
      prompts: videoPreview.previews.map(({ sceneNumber, prompt }) => ({ sceneNumber, prompt })),
    });

    expect((await waitForVideos(started.jobId)).status).toBe("succeeded");

    // A settled job is not the same fact as a project ready to be reviewed. This route starts the run and
    // returns, so the workflow state lands after the job's own status does — the Episode twin failed exactly
    // here, intermittently and only under load, by approving too early.
    expect(await waitForWorkflowState("REVIEWING_VIDEOS")).toBe("REVIEWING_VIDEOS");

    for (const scene of SCENES) {
      await call("POST", API_ROUTES.videoReviewApproval(PROJECT_ID, started.jobId, scene), { approved: true });
    }

    // The state on disk, not only what the route said: a response can be assembled from values that were never
    // stored, and the two disagreeing is the failure this walk exists to catch.
    const stored = JSON.parse(await fs.readFile(
      path.join(root!, "projects", PROJECT_ID, "project.json"), "utf8")) as { workflow_state: string };
    expect(stored.workflow_state).toBe("VIDEOS_APPROVED");

    // Nothing was spent getting here. An absent ledger is the evidence that "no credential" was honoured all the
    // way down rather than only at the first step.
    await expect(fs.access(path.join(root!, "api_budget_usage.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(path.join(root!, "runway_budget_usage.json"))).rejects.toMatchObject({ code: "ENOENT" });
  }, 120_000);

  it("hands a never-reviewed project the owner's current script revision, which is the only value the screen can send", async () => {
    // The mapping screen begins a review with `review?.scriptRevision ?? 0` — it has no other source for the
    // number, and the server refuses anything that does not equal the owner's. So a project that has never had a
    // review must still read back the owner's current revision, or the first press of 검토 시작 would be refused
    // with no value the screen could reach. That it works rests entirely on this, and nothing else states it.
    await boot();
    await call("POST", API_ROUTES.projects, { projectId: PROJECT_ID, topic: "등대지기" });
    const { preview } = await call<{ preview: { originalPrompt: string; originalPromptSha256: string } }>(
      "POST", API_ROUTES.storyPromptPreview(PROJECT_ID));
    await call("POST", API_ROUTES.storyPromptApproval(PROJECT_ID),
      { approved: true, prompt: preview.originalPrompt, originalPromptSha256: preview.originalPromptSha256 });

    // Read before anything is mapped: creating a mapping stamps the owner's revision onto the stored review, so
    // asking afterwards would prove nothing about the case this is about.
    const read = await call<{ review: { scriptRevision: number } }>("GET", API_ROUTES.projectAssetMappingReview(PROJECT_ID));
    expect(read.review.scriptRevision).toBeGreaterThan(0);

    const begun = await fetch(`${base}${API_ROUTES.projectAssetMappingReview(PROJECT_ID)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scriptRevision: read.review.scriptRevision, textOnlyConfirmed: true }),
    });
    expect(begun.status).toBe(201);
  }, 60_000);
});

async function waitForWorkflowState(target: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const { project } = await call<{ project: { workflowState: string } }>("GET", API_ROUTES.project(PROJECT_ID));
    if (project.workflowState === target) return project.workflowState;
    if (Date.now() > deadline) return project.workflowState;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
