import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { API_ROUTES } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { LongProjectsService } from "./long-projects.service.js";
import { StoryBibleService } from "./story-bible.service.js";

/**
 * The two Story Bible routes no screen reaches yet, driven over HTTP at the exact URL the client builds.
 *
 * Both ends of `search` looked finished: the client wraps it, the service filters correctly, and the service's
 * own tests pass. Nothing in between ever ran, and in between is where the two halves disagreed about where
 * the search text lives — the URL carries it as `?query=`, the handler read it as a path parameter of a path
 * that has no such segment. Every call was a 400, and it typechecked.
 *
 * So these tests go through a real router: a service call would prove nothing about the wiring, which is the
 * only part that was broken.
 */

const settings = {
  title: "Bible", logline: "l", overview: "o", genre: "g", tone: "t", theme: "th",
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

async function bootWithSecrets() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "story-bible-http-"));
  const projectsRoot = path.join(root, "projects");
  await new LongProjectsService(projectsRoot).create({ projectId: "long", settings });
  const bible = new StoryBibleService(projectsRoot);
  const kept = await bible.create("long", "secrets", { item: { name: "붉은 편지", description: "형이 숨긴 유언" } });
  await bible.create("long", "secrets", { item: { name: "푸른 열쇠", description: "지하실 문" } });

  previousLearningData = process.env.LEARNING_DATA_ROOT; process.env.LEARNING_DATA_ROOT = root;
  previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT; process.env.PROVIDER_SETTINGS_ROOT = root;
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  return { base: `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`, keptId: kept.item.id };
}

describe.sequential("the Story Bible over HTTP", () => {
  it("searches by the text the client actually puts in the URL", async () => {
    const { base } = await bootWithSecrets();

    // Built by the shared route builder, not hand-written: a test that spells the URL itself would keep
    // passing after the client started sending a different one.
    const response = await fetch(base + API_ROUTES.longProjectStoryBibleSearch("long", "secrets", "붉은"));

    expect(response.status).toBe(200);
    const body = await response.json() as { items: Array<{ name: string }> };
    expect(body.items.map((item) => item.name)).toEqual(["붉은 편지"]);
  });

  it("matches the description too, and answers an empty list rather than an error when nothing matches", async () => {
    const { base } = await bootWithSecrets();

    const byDescription = await fetch(base + API_ROUTES.longProjectStoryBibleSearch("long", "secrets", "지하실"));
    expect((await byDescription.json() as { items: Array<{ name: string }> }).items.map((item) => item.name)).toEqual(["푸른 열쇠"]);

    // Nothing found is an answer, not a failure — a screen showing "no results" needs a 200 to show it.
    const noMatch = await fetch(base + API_ROUTES.longProjectStoryBibleSearch("long", "secrets", "존재하지 않는 말"));
    expect(noMatch.status).toBe(200);
    expect((await noMatch.json() as { items: unknown[] }).items).toEqual([]);
  });

  it("still refuses a collection it does not have", async () => {
    const { base } = await bootWithSecrets();

    const response = await fetch(`${base}${API_ROUTES.longProjects}/long/story-bible/nonsense/search?query=x`);

    expect(response.status).toBe(400);
  });

  it("duplicates an item at the route the client builds", async () => {
    const { base, keptId } = await bootWithSecrets();

    const response = await fetch(base + API_ROUTES.longProjectStoryBibleDuplicate("long", "secrets", keptId), { method: "POST" });

    expect(response.status).toBe(201);
    const body = await response.json() as { item: { id: string; name: string } };
    expect(body.item.id).not.toBe(keptId);
    expect(body.item.name).toContain("붉은 편지");
  });
});
