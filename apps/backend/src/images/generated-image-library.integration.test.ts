import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { API_ROUTES, WorkflowState, type GeneratedEpisodeImageSummary, type GeneratedImageSummary } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { PLACEHOLDER_PNG } from "./placeholder-image.js";

/**
 * The listing of generated scene images, over a running app.
 *
 * Over HTTP because the point of this feature is a link that works: each row is meant to be played back
 * through the content route that already serves that image, and `/images/generated` sits in the same
 * controller as `/projects/:projectId/images/:sceneNumber/content`. Route ordering in this repo has been wrong
 * twice, both times invisible to a service test.
 */

/**
 * A structurally valid PNG that is bigger than the placeholder.
 *
 * Not the placeholder with bytes glued on: the app's own validator refuses anything after IEND, and it is
 * right to — that is not a PNG. So the padding goes in as a `tEXt` chunk before IEND, which the parser skips
 * and which leaves the file decodable. The first version of this fixture failed for exactly the reason it
 * should have.
 */
const REAL_PNG = (() => {
  const iend = PLACEHOLDER_PNG.subarray(PLACEHOLDER_PNG.length - 12);
  const withoutIend = PLACEHOLDER_PNG.subarray(0, PLACEHOLDER_PNG.length - 12);
    // An ancillary chunk the validator skips; its contents are never parsed, only its length is.
  const payload = Buffer.alloc(256, 0x61);
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write("tEXt", 4, "ascii");
  payload.copy(chunk, 8);
  return Buffer.concat([withoutIend, chunk, iend]);
})();

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

async function boot() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "generated-images-"));
  const projectsRoot = path.join(root, "projects");
  previousLearningData = process.env.LEARNING_DATA_ROOT; process.env.LEARNING_DATA_ROOT = root;
  previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT; process.env.PROVIDER_SETTINGS_ROOT = root;
  return { projectsRoot, projects: new LocalProjectRepository(projectsRoot) };
}

async function start(): Promise<string> {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  return `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
}

async function shortProjectWithImages(projectsRoot: string, projects: LocalProjectRepository, id: string, scenes: number[], bytes: Buffer = REAL_PNG) {
  const project = createStoredProject(id, `topic ${id}`, "2026-08-23T00:00:00.000Z");
  project.workflow_state = WorkflowState.ImagesReady;
  await projects.create(project);
  const directory = path.join(projectsRoot, id, "images");
  await fs.mkdir(directory, { recursive: true });
  for (const scene of scenes) await fs.writeFile(path.join(directory, `scene${scene}.png`), bytes);
  return directory;
}

async function episodeWithImages(projectsRoot: string, projectId: string, episodeNumber: number, scenes: number[], bytes: Buffer = REAL_PNG) {
  const storyRoot = path.join(projectsRoot, projectId, "long_story");
  const directory = path.join(storyRoot, `Episode${String(episodeNumber).padStart(2, "0")}`);
  await fs.mkdir(path.join(directory, "images"), { recursive: true });
  await fs.writeFile(path.join(storyRoot, "project.json"), JSON.stringify({ title: `story ${projectId}`, aspect_ratio: "9:16" }));
  await fs.writeFile(path.join(storyRoot, "episode_outlines.json"), JSON.stringify(
    Array.from({ length: episodeNumber }, (_unused, index) => ({ episode_number: index + 1, title: `outline ${index + 1}` })),
  ));
  await fs.writeFile(path.join(directory, "project.json"), JSON.stringify({
    number: episodeNumber, state: "images_review", approved: true, script: {}, script_revision: 1,
    scene_count: 6, title: `첫 번째 밤 ${episodeNumber}`, updated_at: "2026-08-24T00:00:00.000Z",
  }));
  for (const scene of scenes) await fs.writeFile(path.join(directory, "images", `scene${scene}.png`), bytes);
  return directory;
}

const listUrl = (base: string) => base + API_ROUTES.generatedImages;

describe.sequential("the generated image listing", () => {
  it("lists images from both project kinds, in separate arrays, newest first", async () => {
    const { projectsRoot, projects } = await boot();
    await shortProjectWithImages(projectsRoot, projects, "short_one", [1, 2]);
    await episodeWithImages(projectsRoot, "story_one", 1, [3]);
    const base = await start();

    const response = await fetch(listUrl(base));

    expect(response.status).toBe(200);
    const body = await response.json() as { projects: GeneratedImageSummary[]; episodes: GeneratedEpisodeImageSummary[] };
    expect(body.projects.map((row) => `${row.projectId}/${row.sceneNumber}`).sort()).toEqual(["short_one/1", "short_one/2"]);
    expect(body.projects[0]).toMatchObject({ projectTitle: "topic short_one", bytes: REAL_PNG.length });
    expect(body.episodes).toHaveLength(1);
    expect(body.episodes[0]).toMatchObject({ projectId: "story_one", episodeNumber: 1, sceneNumber: 3, projectTitle: "story story_one", episodeTitle: "첫 번째 밤 1" });
    // The timestamp is the file's own, which is what makes it usable as a cache-buster after a regeneration.
    expect(Date.parse(body.projects[0]!.updatedAt)).toBeGreaterThan(0);
  });

  it("leaves out the local fake's placeholder, which is not a picture anyone is looking for", async () => {
    const { projectsRoot, projects } = await boot();
    await shortProjectWithImages(projectsRoot, projects, "short_two", [1], PLACEHOLDER_PNG);
    await shortProjectWithImages(projectsRoot, projects, "short_three", [1]);
    await episodeWithImages(projectsRoot, "story_two", 1, [1], PLACEHOLDER_PNG);
    const base = await start();

    const body = await (await fetch(listUrl(base))).json() as { projects: GeneratedImageSummary[]; episodes: GeneratedEpisodeImageSummary[] };

    expect(body.projects.map((row) => row.projectId)).toEqual(["short_three"]);
    expect(body.episodes).toEqual([]);
  });

  it("hands back rows whose images the existing content routes actually serve", async () => {
    // The whole point of the listing is a link that works, so it is followed here rather than assumed.
    const { projectsRoot, projects } = await boot();
    await shortProjectWithImages(projectsRoot, projects, "short_four", [2]);
    await episodeWithImages(projectsRoot, "story_three", 1, [2]);
    const base = await start();

    const body = await (await fetch(listUrl(base))).json() as { projects: GeneratedImageSummary[]; episodes: GeneratedEpisodeImageSummary[] };
    const shortRow = body.projects[0]!;
    const episodeRow = body.episodes[0]!;

    const shortImage = await fetch(base + API_ROUTES.imageContent(shortRow.projectId, shortRow.sceneNumber));
    expect(shortImage.status).toBe(200);
    expect(Buffer.from(await shortImage.arrayBuffer()).equals(REAL_PNG)).toBe(true);

    const episodeImage = await fetch(base + API_ROUTES.longEpisodeImageContent(episodeRow.projectId, episodeRow.episodeNumber, episodeRow.sceneNumber));
    expect(episodeImage.status).toBe(200);
  });

  it("answers with empty lists rather than failing when nothing has been generated", async () => {
    await boot();
    const base = await start();

    expect(await (await fetch(listUrl(base))).json()).toEqual({ projects: [], episodes: [] });
  });

  it("keeps listing the rest when one story's stored files cannot be read", async () => {
    const { projectsRoot, projects } = await boot();
    await shortProjectWithImages(projectsRoot, projects, "short_five", [1]);
    const brokenRoot = path.join(projectsRoot, "story_broken", "long_story");
    await fs.mkdir(brokenRoot, { recursive: true });
    await fs.writeFile(path.join(brokenRoot, "project.json"), "{ not json");
    const base = await start();

    const body = await (await fetch(listUrl(base))).json() as { projects: GeneratedImageSummary[]; episodes: GeneratedEpisodeImageSummary[] };

    expect(body.projects.map((row) => row.projectId)).toEqual(["short_five"]);
    expect(body.episodes).toEqual([]);
  });
});
