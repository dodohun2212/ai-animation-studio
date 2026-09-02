import * as fs from "node:fs/promises";
import { ProjectsService } from "./projects.service.js";
import { createStoredProject } from "./project.mapper.js";
import { shortProjectAspectRatio } from "./project-aspect.js";
import type { ShortProjectSettings } from "@ai-animation-studio/shared";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PHOTO_CARD_QUOTE_MAX_LENGTH, WorkflowState } from "@ai-animation-studio/shared";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalProjectRepository } from "./projects.repository.js";
import { PhotoCardService } from "./photo-card.service.js";
import { LocalVideoMergeService } from "../videos/video-merge.service.js";
import { MediaToolError, type MediaCommandRunner } from "../videos/ffmpeg-merge.service.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
let root: string | undefined;
afterEach(async () => { vi.unstubAllGlobals(); if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

function runner(calls: string[][], writtenAss: Map<string, string> = new Map()): MediaCommandRunner {
  return async (args) => {
    const list = [...args]; calls.push(list);
    if (list[0] === "ffprobe") return { stdout: JSON.stringify({ streams: [{ codec_type: "video" }], format: { duration: "5" } }), stderr: "" };
    const output = list.at(-1)!;
    // The merge deletes its working directory afterwards, so a subtitle file can only be read from inside the
    // run that wrote it - same reason video-merge.service.test.ts captures them here rather than after.
    const directory = path.dirname(output);
    for (const name of (await fs.readdir(directory).catch(() => [] as string[])).filter((item) => item.endsWith(".ass"))) {
      writtenAss.set(name, await fs.readFile(path.join(directory, name), "utf8"));
    }
    await fs.writeFile(output, Buffer.from("rendered"));
    return { stdout: "", stderr: "" };
  };
}

async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "photo-card-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const assets = new LocalAssetsRepository(root);
  const asset = await assets.create({ buffer: PNG, originalname: "quote.png", mimetype: "image/png" }, { assetType: "general_reference", displayName: "배경" });
  // The settings routes are exercised through the service that serves them, so the round trip below is the one
  // a screen actually makes rather than a direct call to the mapper.
  const service = new ProjectsService(projects, assets);
  return {
    root, projectsRoot, projects, assets, asset,
    service: new PhotoCardService(projects, assets, projectsRoot),
    settingsOf: async (id: string) => (await service.getProjectSettings(id)).settings,
    // `durationSeconds` is derived and deliberately not accepted back — the screen builds this payload from its
    // fields rather than echoing the response, and so does this.
    saveSettings: async (id: string, settings: ShortProjectSettings) => {
      const { durationSeconds: _derived, ...editable } = settings;
      return service.updateProjectSettings(id, { settings: editable as unknown as ShortProjectSettings });
    },
  };
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

  /**
   * The card's own subtitle layout, asserted on the file the merge actually writes.
   *
   * Everything about that layout can be right in subtitle-file.ts and never reach a card: the branch is chosen
   * at the burn site, from the field that marks a still. So this reads the .ass the merge wrote, which is the
   * only place the two meet — 캡틴D's complaint was about a rendered video, not about a function.
   */
  it("burns the card's text in the card's own layout, not the scene caption's", async () => {
    const { projectsRoot, projects, service, asset } = await setup();
    vi.stubGlobal("fetch", () => { throw new Error("a photo card must not reach a provider"); });
    await service.create({ ...body(asset.asset_id), quote: "불광불급\n미치지 않으면 미치지 못한다" });
    const written = new Map<string, string>();

    await new LocalVideoMergeService(projects, projectsRoot, runner([], written)).merge("card_one");

    const ass = [...written.values()][0]!;
    expect(ass).toContain("Noto Serif KR");
    expect(ass).toContain("\\pos(");
    // Above the middle of the frame, which is the whole reason this layout exists.
    const y = Number(/\\pos\(\d+,(\d+)\)/.exec(ass)![1]);
    expect(y).toBeLessThan(1920 * 0.5);
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

  /**
   * The limit is one number in two places — the screen's counter and this refusal — so the pair is written in
   * terms of the shared constant rather than the digit. Measured: with only the tests that existed before, an
   * injection that moved the server's own check off `PHOTO_CARD_QUOTE_MAX_LENGTH` stayed green, which is exactly
   * the silent drift publishing the constant was meant to prevent.
   */
  it("takes a quote of exactly the shared limit and refuses one character more", async () => {
    const { service, asset } = await setup();
    vi.stubGlobal("fetch", () => { throw new Error("a photo card must not reach a provider"); });

    const atLimit = "가".repeat(PHOTO_CARD_QUOTE_MAX_LENGTH);
    const created = await service.create({ ...body(asset.asset_id), quote: atLimit });
    expect(created.project.topic).toBe(atLimit);

    await expect(service.create({ ...body(asset.asset_id), projectId: "card_two", quote: `${atLimit}가` }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });


  /**
   * A photo card has one scene, and everything that walks "this project's scenes" counts from this number.
   *
   * `MIN_SCENE_COUNT` is two, so reading the card's own `scene_count: 1` through the ordinary floor rejected it
   * as invalid and substituted the default of six. Measured end to end on a card made from a real Library
   * picture: its settings answered six scenes and thirty seconds for a one-scene five-second card.
   *
   * The round trip is half the test. The scene count is locked once a project has scenes, so a save must carry
   * back exactly what the read gave — if only the read had moved, the one number nobody chose would be the one
   * number that could not be saved.
   */
  it("reports one scene and one clip's worth of seconds, and takes that same count back", async () => {
    const { projects, service, asset, settingsOf, saveSettings } = await setup();
    vi.stubGlobal("fetch", () => { throw new Error("a photo card must not reach a provider"); });
    await service.create(body(asset.asset_id));

    const settings = await settingsOf("card_one");
    expect(settings.sceneCount).toBe(1);
    expect(settings.durationSeconds).toBe(5);

    await saveSettings("card_one", settings);
    expect((await settingsOf("card_one")).sceneCount).toBe(1);
    expect((await projects.findById("card_one")).scenes).toHaveLength(1);
  });

  it("still refuses an ordinary project made with a single scene", async () => {
    // The counterpart. The floor moves for a photo card; the gate that stops every short project from being
    // made as one scene does not, and widening the read must not have widened that.
    const { saveSettings, settingsOf, projects } = await setup();
    const ordinary = createStoredProject("ordinary_one", "보통 프로젝트", "2026-08-30T00:00:00.000Z");
    ordinary.scenes = [{ number: 1, description: "s1" }, { number: 2, description: "s2" }];
    ordinary.lore_context = { scene_count: 2, clip_duration_seconds: 5 };
    await projects.create(ordinary);

    const settings = await settingsOf("ordinary_one");
    expect(settings.sceneCount).toBe(2);
    await expect(saveSettings("ordinary_one", { ...settings, sceneCount: 1 }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });


  /**
   * The orientation has to reach the thing that renders, and the only way to know is to ask the renderer.
   *
   * `projects/project-aspect.ts` exists because five readers all read `style_profile.aspect`, a field nothing
   * has ever written, so a project set to landscape came out vertical anyway. Its doc comment says so. Writing
   * the card's choice to that same field was the identical defect approached from the other side, and it was
   * live: measured end to end through the merge, a 16:9 card produced a 1080x1920 file.
   *
   * So this asserts what the merge is actually handed, through the same helper every other reader uses. A test
   * that read the stored field back would have passed while the video came out the wrong shape — it would have
   * been checking that the service wrote what the service wrote.
   */
  it("stores the orientation where everything that renders reads it", async () => {
    const { projects, service, asset } = await setup();
    vi.stubGlobal("fetch", () => { throw new Error("a photo card must not reach a provider"); });

    await service.create({ ...body(asset.asset_id), aspectRatio: "16:9" });
    expect(shortProjectAspectRatio(await projects.findById("card_one"))).toBe("16:9");

    await service.create({ ...body(asset.asset_id), projectId: "card_two", aspectRatio: "9:16" });
    expect(shortProjectAspectRatio(await projects.findById("card_two"))).toBe("9:16");
  });

});
