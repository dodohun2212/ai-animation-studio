import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalProjectRepository } from "./projects.repository.js";
import { PhotoCardService } from "./photo-card.service.js";
import { LocalVideoMergeService } from "../videos/video-merge.service.js";
import { MediaToolError, type MediaCommandRunner } from "../videos/ffmpeg-merge.service.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
let root: string | undefined;
afterEach(async () => { vi.unstubAllGlobals(); if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

function runner(calls: string[][]): MediaCommandRunner {
  return async (args) => {
    const list = [...args]; calls.push(list);
    if (list[0] === "ffprobe") return { stdout: JSON.stringify({ streams: [{ codec_type: "video" }], format: { duration: "5" } }), stderr: "" };
    await fs.writeFile(list.at(-1)!, Buffer.from("rendered"));
    return { stdout: "", stderr: "" };
  };
}

async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "photo-card-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const assets = new LocalAssetsRepository(root);
  const asset = await assets.create({ buffer: PNG, originalname: "quote.png", mimetype: "image/png" }, { assetType: "general_reference", displayName: "배경" });
  return { root, projectsRoot, projects, assets, asset, service: new PhotoCardService(projects, assets, projectsRoot) };
}

const body = (assetId: string) => ({ projectId: "card_one", assetId, quote: "오늘의 문장", clipDurationSeconds: 5 as const, aspectRatio: "9:16" as const });

describe("PhotoCardService", () => {
  /**
   * The whole promise of this feature is that it costs nothing, and that promise does not rest on what happens
   * to be wired up — it rests on one line. Image generation reuses a scene only when the project's own record
   * already points at that exact file, so copying the picture into place without writing `generated_images`
   * would leave a "free" card that pays for an image the first time anyone opens generation.
   *
   * The fetch stub throws rather than returning a canned response: a test that lets a paid call succeed quietly
   * is measuring nothing.
   */
  it("records the picture as the scene's image, so nothing downstream has a reason to buy one", async () => {
    const { projectsRoot, service, asset } = await setup();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("A PAID REQUEST WAS SENT"); }));

    const created = await service.create(body(asset.asset_id));

    const destination = path.join(projectsRoot, "card_one", "images", "scene1.png");
    await expect(fs.stat(destination)).resolves.toBeTruthy();
    const stored = await new LocalProjectRepository(projectsRoot).findById("card_one");
    expect(stored.generated_images[0]).toBe(destination);
    expect(stored.lore_context.photo_card).toBe(true);
    expect(created.project.photoCard).toBe(true);
    expect(created.project.workflowState).toBe(WorkflowState.VideosApproved);
  });

  /**
   * A card reaches a final video without ever being a video run.
   *
   * No scene reviews are written and none are demanded — writing one that says a scene was reviewed is exactly
   * the dressing-up this design exists to avoid. What the merge asks a card for is its picture, and it holds it
   * rather than playing it.
   */
  it("merges into a final video from the picture alone, with no reviews file and no provider call", async () => {
    const { root: used, projectsRoot, projects, service, asset } = await setup();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("A PAID REQUEST WAS SENT"); }));
    await service.create(body(asset.asset_id));
    await expect(fs.stat(path.join(projectsRoot, "card_one", "generated_video_reviews.json"))).rejects.toMatchObject({ code: "ENOENT" });
    const calls: string[][] = [];

    const merged = await new LocalVideoMergeService(projects, projectsRoot, runner(calls)).merge("card_one");

    expect(merged.finalVideoPath).toBeTruthy();
    expect(calls.some((args) => args[0] === "ffprobe")).toBe(false);
    const normalize = calls.find((args) => args[0] === "ffmpeg" && args.includes("-vf"))!;
    expect(normalize).toContain("-loop");
    expect(normalize[normalize.indexOf("-vf") + 1]).toContain("zoompan");
    expect(used).toBeTruthy();
  });

  /** The counterpart: an ordinary project still needs its clips and its approved reviews. */
  it("leaves an ordinary project's merge demanding clips and reviews", async () => {
    const { projectsRoot, projects } = await setup();
    const ordinary = (await import("./project.mapper.js")).createStoredProject("ordinary", "topic", "2026-08-23T00:00:00.000Z");
    ordinary.workflow_state = WorkflowState.VideosApproved;
    await projects.create(ordinary);

    await expect(new LocalVideoMergeService(projects, projectsRoot, runner([])).merge("ordinary"))
      .rejects.toMatchObject({ response: { code: "VIDEO_MERGE_CLIPS_INVALID" } });
  });

  it("refuses a picture the Library cannot hand over", async () => {
    const { service } = await setup();
    await expect(service.create(body("ASSET-GENERAL-DOESNOTEXIST"))).rejects.toMatchObject({ response: { code: "PHOTO_CARD_ASSET_UNUSABLE" } });
  });
});
